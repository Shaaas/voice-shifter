import init, { VoiceShifter } from "./wasm/voice_core.js";
export type VoiceType = {
  name: string;
  semitones: number;
};

export type FormantProfile = {
  f1: number;
  f2: number;
  f3: number;
  gain: number;
};

export const VOICE_TYPES: VoiceType[] = [
  { name: "Soprano",  semitones: 4  },
  { name: "Mezzo",    semitones: 3  },
  { name: "Alto",     semitones: 2  },
  { name: "Tenor",    semitones: 0  },
  { name: "Baritone", semitones: -2 },
  { name: "Bass",     semitones: -3 },
];

export const FORMANT_PROFILES: Record<string, FormantProfile> = {
  Soprano:  { f1: 800,  f2: 1200, f3: 2800, gain: 1.1 },
  Mezzo:    { f1: 600,  f2: 1100, f3: 2600, gain: 1.1 },
  Alto:     { f1: 500,  f2: 1000, f3: 2500, gain: 1.0 },
  Tenor:    { f1: 400,  f2: 900,  f3: 2400, gain: 1.0 },
  Baritone: { f1: 350,  f2: 800,  f3: 2200, gain: 0.9 },
  Bass:     { f1: 300,  f2: 700,  f3: 2000, gain: 0.9 },
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private recordedBuffer: AudioBuffer | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private currentSource: AudioBufferSourceNode | null = null;
  private shifter: VoiceShifter | null = null;

  async init(): Promise<void> {
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
  }
  async initWasm(): Promise<void> {
  await init();
  this.shifter = new VoiceShifter(44100);
}

  async requestMic(): Promise<void> {
  if (!this.ctx) await this.init();
  if (this.stream) return;
  this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  // Do NOT connect mic source to analyser — this causes feedback through earphones
  // MediaRecorder reads directly from the stream, no audio graph connection needed
}

  startRecording(): void {
    if (!this.stream) throw new Error("Mic not initialized");
    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream);
    this.mediaRecorder.ondataavailable = (e) => this.chunks.push(e.data);
    this.mediaRecorder.onstop = () => this.processAudio();
    this.mediaRecorder.start();
  }

  stopRecording(): void {
    this.mediaRecorder?.stop();
  }

  private async processAudio(): Promise<void> {
    const blob = new Blob(this.chunks, { type: "audio/webm" });
    const arrayBuffer = await blob.arrayBuffer();
    this.recordedBuffer = await this.ctx!.decodeAudioData(arrayBuffer);
  }

  private buildFormantFilters(
    ctx: BaseAudioContext,
    profile: FormantProfile
  ): { input: AudioNode; output: GainNode } {
    const splitter = ctx.createGain();

    const f1 = ctx.createBiquadFilter();
    f1.type = "bandpass";
    f1.frequency.value = profile.f1;
    f1.Q.value = 5;

    const f2 = ctx.createBiquadFilter();
    f2.type = "bandpass";
    f2.frequency.value = profile.f2;
    f2.Q.value = 8;

    const f3 = ctx.createBiquadFilter();
    f3.type = "bandpass";
    f3.frequency.value = profile.f3;
    f3.Q.value = 10;

    const dry = ctx.createGain();
    dry.gain.value = 0.7;

    const g1 = ctx.createGain();
    g1.gain.value = 0.4;

    const g2 = ctx.createGain();
    g2.gain.value = 0.3;

    const g3 = ctx.createGain();
    g3.gain.value = 0.2;

    const merger = ctx.createGain();
    merger.gain.value = profile.gain;

    splitter.connect(dry);
    splitter.connect(f1);
    splitter.connect(f2);
    splitter.connect(f3);

    f1.connect(g1);
    f2.connect(g2);
    f3.connect(g3);

    dry.connect(merger);
    g1.connect(merger);
    g2.connect(merger);
    g3.connect(merger);

    return { input: splitter, output: merger };
  }

  playShifted(semitones: number, fineOffset: number = 0, voiceName: string = "Tenor"): void {
    if (!this.recordedBuffer || !this.ctx) return;

    if (this.currentSource) {
      this.currentSource.disconnect();
      this.currentSource.stop();
      this.currentSource = null;
    }

    const total = semitones + fineOffset;
    const profile = FORMANT_PROFILES[voiceName] ?? FORMANT_PROFILES["Tenor"];

    const source = this.ctx.createBufferSource();
    source.buffer = this.recordedBuffer;
    source.detune.value = total * 100;

    const formant = this.buildFormantFilters(this.ctx, profile);

    const gain = this.ctx.createGain();
    gain.gain.value = 1.2;

    // Clean signal chain
    source.connect(formant.input);
    formant.output.connect(gain);
    gain.connect(this.analyser!);
    this.analyser!.connect(this.ctx.destination);

    source.start();
    this.currentSource = source;

    source.onended = () => {
      if (this.currentSource === source) {
        this.currentSource = null;
      }
    };
  }
  playWithWasm(semitones: number, fineOffset: number = 0): void {
  if (!this.recordedBuffer || !this.ctx || !this.shifter) return;

  if (this.currentSource) {
    this.currentSource.disconnect();
    this.currentSource.stop();
    this.currentSource = null;
  }

  const total = semitones + fineOffset;
  this.shifter.set_pitch_semitones(total);

  // Get raw PCM samples from recorded buffer
  const inputData = this.recordedBuffer.getChannelData(0);

  // Process through Rust phase vocoder
  const outputData = this.shifter.process(inputData);

  // Create a new AudioBuffer from the processed samples
  const processedBuffer = this.ctx.createBuffer(
    1,
    outputData.length,
    this.recordedBuffer.sampleRate
  );
  processedBuffer.copyToChannel(outputData, 0);

  // Play the processed buffer
  const source = this.ctx.createBufferSource();
  source.buffer = processedBuffer;

  const gain = this.ctx.createGain();
  gain.gain.value = 1.2;

  source.connect(gain);
  gain.connect(this.analyser!);
  this.analyser!.connect(this.ctx.destination);

  source.start();
  this.currentSource = source;

  source.onended = () => {
    if (this.currentSource === source) {
      this.currentSource = null;
    }
  };
}

isWasmReady(): boolean {
  return this.shifter !== null;
}

  async exportShifted(semitones: number, fineOffset: number = 0, voiceName: string = "Tenor"): Promise<void> {
    if (!this.recordedBuffer) throw new Error("No recording found");

    const total = semitones + fineOffset;
    const profile = FORMANT_PROFILES[voiceName] ?? FORMANT_PROFILES["Tenor"];

    const offlineCtx = new OfflineAudioContext(
      this.recordedBuffer.numberOfChannels,
      this.recordedBuffer.length,
      this.recordedBuffer.sampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = this.recordedBuffer;
    source.detune.value = total * 100;

    const formant = this.buildFormantFilters(offlineCtx, profile);

    source.connect(formant.input);
    formant.output.connect(offlineCtx.destination);
    source.start();

    const renderedBuffer = await offlineCtx.startRendering();
    const wav = this.bufferToWav(renderedBuffer);
    const blob = new Blob([wav], { type: "audio/wav" });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voice-${voiceName.toLowerCase()}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private bufferToWav(buffer: AudioBuffer): ArrayBuffer {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length * numChannels * 2;
    const arrayBuffer = new ArrayBuffer(44 + length);
    const view = new DataView(arrayBuffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + length, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, length, true);

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
        view.setInt16(offset, sample * 0x7fff, true);
        offset += 2;
      }
    }

    return arrayBuffer;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  hasRecording(): boolean {
    return this.recordedBuffer !== null;
  }

  getDuration(): number {
    return this.recordedBuffer?.duration ?? 0;
  }
}