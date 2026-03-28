export type VoiceType = {
  name: string;
  semitones: number;
};

export const VOICE_TYPES: VoiceType[] = [
  { name: "Soprano",  semitones: 8  },
  { name: "Mezzo",    semitones: 5  },
  { name: "Alto",     semitones: 2  },
  { name: "Tenor",    semitones: 0  },
  { name: "Baritone", semitones: -3 },
  { name: "Bass",     semitones: -7 },
];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private recordedBuffer: AudioBuffer | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private currentSource: AudioBufferSourceNode | null = null;
  private isProcessing: boolean = false;

  async init(): Promise<void> {
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    // analyser is NOT connected to destination
    // it is only used for visualisation
  }

  async requestMic(): Promise<void> {
    if (!this.ctx) await this.init();
    if (this.stream) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 44100,
      }
    });

    // Create mic source but do NOT connect to destination
    // Only connect to analyser for waveform drawing
    this.micSource = this.ctx!.createMediaStreamSource(this.stream);
    this.micSource.connect(this.analyser!);
    // analyser intentionally left disconnected from ctx.destination
  }

  startRecording(): void {
    if (!this.stream) throw new Error("Mic not initialized");
    if (this.isProcessing) return;

    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream);

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    this.mediaRecorder.onstop = () => this.processAudio();
    this.mediaRecorder.start();
  }

  stopRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.isProcessing = true;
      this.mediaRecorder.stop();
    }
  }

  private async processAudio(): Promise<void> {
    try {
      const blob = new Blob(this.chunks, { type: "audio/webm" });
      const arrayBuffer = await blob.arrayBuffer();
      this.recordedBuffer = await this.ctx!.decodeAudioData(arrayBuffer);
    } catch (e) {
      console.error("Failed to process audio:", e);
    } finally {
      this.isProcessing = false;
    }
  }

  stopPlayback(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch {}
      this.currentSource = null;
    }
  }

  playShifted(semitones: number, fineOffset: number = 0, onEnd?: () => void): void {
    if (!this.recordedBuffer || !this.ctx) return;

    // Stop previous playback first
    this.stopPlayback();

    const total = semitones + fineOffset;

    const source = this.ctx.createBufferSource();
    source.buffer = this.recordedBuffer;

    // detune shifts pitch in cents without changing speed
    // 100 cents = 1 semitone
    source.detune.value = total * 100;

    const gain = this.ctx.createGain();
    gain.gain.value = 1.0;

    // source → gain → destination (NOT through analyser)
    source.connect(gain);
    gain.connect(this.ctx.destination);

    // Separately tap into analyser for visualisation only
    source.connect(this.analyser!);

    source.start();
    this.currentSource = source;

    source.onended = () => {
      this.stopPlayback();
      onEnd?.();
    };
  }

  async exportShifted(semitones: number, fineOffset: number = 0): Promise<void> {
    if (!this.recordedBuffer) throw new Error("No recording found");

    const total = semitones + fineOffset;

    const offlineCtx = new OfflineAudioContext(
      this.recordedBuffer.numberOfChannels,
      this.recordedBuffer.length,
      this.recordedBuffer.sampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = this.recordedBuffer;
    source.detune.value = total * 100;
    source.connect(offlineCtx.destination);
    source.start();

    const renderedBuffer = await offlineCtx.startRendering();
    const wav = this.bufferToWav(renderedBuffer);
    const blob = new Blob([wav], { type: "audio/wav" });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `voice-shifted-${total > 0 ? "+" : ""}${total}st.wav`;
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

  isReady(): boolean {
    return !this.isProcessing;
  }

  getDuration(): number {
    return this.recordedBuffer?.duration ?? 0;
  }
}