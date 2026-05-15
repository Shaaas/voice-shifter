import init, { VoiceShifter } from "./wasm/voice_core.js";

export type VoiceType = {
  name: string;
  semitones: number;
  range: string;
  minHz: number;
  maxHz: number;
};

export type FormantProfile = {
  f1: number; f1Q: number; f1g: number;
  f2: number; f2Q: number; f2g: number;
  f3: number; f3Q: number; f3g: number;
  gain: number;
};

export type Track = {
  id: string;
  voiceName: string;
  semitones: number;
  buffer: AudioBuffer;
  label: string;
  volume: number;
  duration: number;
};

export type DetectionResult = {
  voiceName: string;
  hz: number;
  confidence: number;
};

export const VOICE_TYPES: VoiceType[] = [
  { name: "Soprano",  semitones:  6, range: "C5-C6", minHz: 523, maxHz: 1047 },
  { name: "Mezzo",    semitones:  4, range: "A4-A5", minHz: 440, maxHz: 880  },
  { name: "Alto",     semitones:  2, range: "F4-F5", minHz: 349, maxHz: 698  },
  { name: "Tenor",    semitones:  0, range: "C4-C5", minHz: 262, maxHz: 523  },
  { name: "Baritone", semitones: -2, range: "G3-G4", minHz: 196, maxHz: 392  },
  { name: "Bass",     semitones: -4, range: "E2-E4", minHz: 82,  maxHz: 330  },
];

export const FORMANT_PROFILES: Record<string, FormantProfile> = {
  Soprano:  { f1: 820,  f1Q: 1.8, f1g: 0.22, f2: 1250, f2Q: 2.5, f2g: 0.18, f3: 2800, f3Q: 3.5, f3g: 0.10, gain: 1.05 },
  Mezzo:    { f1: 650,  f1Q: 1.8, f1g: 0.20, f2: 1100, f2Q: 2.5, f2g: 0.16, f3: 2600, f3Q: 3.5, f3g: 0.09, gain: 1.03 },
  Alto:     { f1: 550,  f1Q: 1.6, f1g: 0.18, f2: 1000, f2Q: 2.2, f2g: 0.14, f3: 2500, f3Q: 3.0, f3g: 0.08, gain: 1.00 },
  Tenor:    { f1: 430,  f1Q: 1.4, f1g: 0.16, f2:  900, f2Q: 2.0, f2g: 0.12, f3: 2400, f3Q: 2.8, f3g: 0.07, gain: 1.00 },
  Baritone: { f1: 360,  f1Q: 1.4, f1g: 0.16, f2:  820, f2Q: 2.0, f2g: 0.12, f3: 2200, f3Q: 2.8, f3g: 0.07, gain: 0.97 },
  Bass:     { f1: 300,  f1Q: 1.2, f1g: 0.14, f2:  720, f2Q: 1.8, f2g: 0.10, f3: 2000, f3Q: 2.5, f3g: 0.06, gain: 0.95 },
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private shifter: VoiceShifter | null = null;
  private tracks: Track[] = [];
  private activeSources: AudioBufferSourceNode[] = [];
  private voiceCounts: Record<string, number> = {};
  private previewBuffer: AudioBuffer | null = null;
  private previewSource: AudioBufferSourceNode | null = null;

  async init(): Promise<void> {
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
  }

  async initWasm(): Promise<void> {
    await init();
    this.shifter = new VoiceShifter(44100);
  }

  isWasmReady(): boolean { return this.shifter !== null; }

  async requestMic(): Promise<void> {
    if (!this.ctx) await this.init();
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 }
    });
  }

  getAnalyser(): AnalyserNode | null { return this.analyser; }

  async detectVoice(onProgress: (pct: number) => void): Promise<DetectionResult> {
    await this.requestMic();
    const DURATION = 3000;
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(this.stream!);
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.start();
    const start = Date.now();
    await new Promise<void>((resolve) => {
      const tick = () => {
        const elapsed = Date.now() - start;
        onProgress(Math.min(elapsed / DURATION, 1));
        if (elapsed < DURATION) requestAnimationFrame(tick);
        else resolve();
      };
      tick();
    });
    recorder.stop();
    await new Promise<void>((r) => { recorder.onstop = () => r(); });
    const blob = new Blob(chunks, { type: "audio/webm" });
    const ab = await blob.arrayBuffer();
    const buf = await this.ctx!.decodeAudioData(ab);
    const hz = this.estimateF0(buf);
    return this.classifyVoice(hz);
  }

  private estimateF0(buffer: AudioBuffer): number {
    const sr = buffer.sampleRate;
    const data = buffer.getChannelData(0);
    const chunkLen = Math.min(sr, data.length);
    const offset = Math.floor((data.length - chunkLen) / 2);
    const chunk = data.slice(offset, offset + chunkLen);
    const minPeriod = Math.floor(sr / 1000);
    const maxPeriod = Math.floor(sr / 50);
    const rms = Math.sqrt(chunk.reduce((s, v) => s + v * v, 0) / chunk.length);
    if (rms < 0.01) return 0;
    let bestCorr = -Infinity, bestPeriod = maxPeriod;
    for (let lag = minPeriod; lag <= maxPeriod; lag++) {
      let corr = 0;
      for (let i = 0; i < chunkLen - lag; i++) corr += chunk[i] * chunk[i + lag];
      corr /= (chunkLen - lag);
      if (corr > bestCorr) { bestCorr = corr; bestPeriod = lag; }
    }
    return sr / bestPeriod;
  }

  private classifyVoice(hz: number): DetectionResult {
    if (hz < 50) return { voiceName: "Tenor", hz: 0, confidence: 0 };
    let best = VOICE_TYPES[3], bestDist = Infinity;
    for (const v of VOICE_TYPES) {
      const mid = (v.minHz + v.maxHz) / 2;
      const dist = Math.abs(hz - mid);
      if (dist < bestDist) { bestDist = dist; best = v; }
    }
    const inRange = hz >= best.minHz && hz <= best.maxHz;
    const confidence = inRange ? 1.0 : Math.max(0, 1 - bestDist / (best.maxHz - best.minHz));
    return { voiceName: best.name, hz: Math.round(hz), confidence };
  }

  startRecording(): void {
    if (!this.stream) throw new Error("Mic not initialized");
    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(this.stream);
    this.mediaRecorder.ondataavailable = (e) => this.chunks.push(e.data);
    this.mediaRecorder.start();
  }

  stopRecording(): Promise<AudioBuffer> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) return reject(new Error("No recorder"));
      this.mediaRecorder.onstop = async () => {
        try {
          const blob = new Blob(this.chunks, { type: "audio/webm" });
          const ab = await blob.arrayBuffer();
          const buf = await this.ctx!.decodeAudioData(ab);
          this.previewBuffer = buf;
          resolve(buf);
        } catch (e) { reject(e); }
      };
      this.mediaRecorder.stop();
    });
  }

  hasPreview(): boolean { return this.previewBuffer !== null; }
  getDuration(): number { return this.previewBuffer?.duration ?? 0; }

  discardPreview(): void {
    this.stopPreview();
    this.previewBuffer = null;
  }

  private buildShiftedSource(ctx: BaseAudioContext, buffer: AudioBuffer, semitones: number): AudioBufferSourceNode {
    if (this.shifter && ctx instanceof AudioContext) {
      this.shifter.set_pitch_semitones(semitones);
      const input = buffer.getChannelData(0);
      const output = this.shifter.process(input);
      const processed = ctx.createBuffer(1, output.length, buffer.sampleRate);
      processed.copyToChannel(output, 0);
      const source = ctx.createBufferSource();
      source.buffer = processed;
      return source;
    }
    const source = (ctx as AudioContext).createBufferSource();
    source.buffer = buffer;
    source.detune.value = semitones * 100;
    source.playbackRate.value = Math.pow(2, -semitones / 12);
    return source;
  }

  previewVoice(semitones: number, voiceName: string): void {
    if (!this.previewBuffer || !this.ctx) return;
    this.stopPreview();
    const profile = FORMANT_PROFILES[voiceName] ?? FORMANT_PROFILES["Tenor"];
    const source = this.buildShiftedSource(this.ctx, this.previewBuffer, semitones);
    const formant = this.buildFormantFilters(this.ctx, profile);
    const reverb = this.buildReverb(this.ctx, 0.06);
    const gain = this.ctx.createGain();
    gain.gain.value = 1.0;
    source.connect(formant.input);
    formant.output.connect(reverb.input);
    reverb.output.connect(gain);
    gain.connect(this.analyser!);
    this.analyser!.connect(this.ctx.destination);
    source.start();
    this.previewSource = source;
    source.onended = () => { this.previewSource = null; };
  }

  stopPreview(): void {
    if (this.previewSource) {
      this.previewSource.disconnect();
      try { this.previewSource.stop(); } catch {}
      this.previewSource = null;
    }
  }

  saveTrack(voiceName: string, semitones: number): Track {
    if (!this.previewBuffer) throw new Error("No recording to save");
    this.voiceCounts[voiceName] = (this.voiceCounts[voiceName] ?? 0) + 1;
    const count = this.voiceCounts[voiceName];
    const track: Track = {
      id: `${voiceName}-${Date.now()}`,
      voiceName, semitones,
      buffer: this.previewBuffer,
      label: count === 1 ? voiceName : `${voiceName} #${count}`,
      volume: 1.0,
      duration: this.previewBuffer.duration,
    };
    this.tracks.push(track);
    this.previewBuffer = null;
    return track;
  }

  deleteTrack(id: string): void { this.tracks = this.tracks.filter(t => t.id !== id); }
  setTrackVolume(id: string, volume: number): void {
    const t = this.tracks.find(t => t.id === id);
    if (t) t.volume = Math.max(0, Math.min(1, volume));
  }
  getTracks(): Track[] { return [...this.tracks]; }

  playAll(): void {
    if (!this.ctx || this.tracks.length === 0) return;
    this.stopAll();
    const masterGain = Math.min(1.0, 1.0 / Math.sqrt(this.tracks.length));
    this.tracks.forEach(track => {
      const profile = FORMANT_PROFILES[track.voiceName] ?? FORMANT_PROFILES["Tenor"];
      const source = this.buildShiftedSource(this.ctx!, track.buffer, track.semitones);
      const formant = this.buildFormantFilters(this.ctx!, profile);
      const reverb = this.buildReverb(this.ctx!, 0.06);
      const gainNode = this.ctx!.createGain();
      gainNode.gain.value = track.volume * masterGain;
      source.connect(formant.input);
      formant.output.connect(reverb.input);
      reverb.output.connect(gainNode);
      gainNode.connect(this.analyser!);
      this.analyser!.connect(this.ctx!.destination);
      source.start();
      this.activeSources.push(source);
    });
  }

  stopAll(): void {
    this.activeSources.forEach(s => { s.disconnect(); try { s.stop(); } catch {} });
    this.activeSources = [];
  }

  async exportMix(): Promise<void> {
    if (this.tracks.length === 0) throw new Error("No tracks");
    const sr = this.tracks[0].buffer.sampleRate;
    const totalLength = Math.max(...this.tracks.map(t => t.buffer.length));
    const masterGain = Math.min(1.0, 1.0 / Math.sqrt(this.tracks.length));
    const offlineCtx = new OfflineAudioContext(1, totalLength, sr);
    for (const track of this.tracks) {
      const profile = FORMANT_PROFILES[track.voiceName] ?? FORMANT_PROFILES["Tenor"];
      const source = offlineCtx.createBufferSource();
      source.buffer = track.buffer;
      source.detune.value = track.semitones * 100;
      source.playbackRate.value = Math.pow(2, -track.semitones / 12);
      const formant = this.buildFormantFilters(offlineCtx, profile);
      const reverb = this.buildReverb(offlineCtx, 0.06);
      const gainNode = offlineCtx.createGain();
      gainNode.gain.value = track.volume * masterGain;
      source.connect(formant.input);
      formant.output.connect(reverb.input);
      reverb.output.connect(gainNode);
      gainNode.connect(offlineCtx.destination);
      source.start();
    }
    const rendered = await offlineCtx.startRendering();
    const wav = this.bufferToWav(rendered);
    const blob = new Blob([wav], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "polyphon-choir.wav";
    a.click(); URL.revokeObjectURL(url);
  }

  private buildFormantFilters(ctx: BaseAudioContext, p: FormantProfile): { input: AudioNode; output: GainNode } {
    const input = ctx.createGain();
    const mkF = (freq: number, Q: number, gainDb: number) => {
      const f = ctx.createBiquadFilter();
      f.type = "peaking"; f.frequency.value = freq; f.Q.value = Q; f.gain.value = gainDb * 12;
      return f;
    };
    const f1 = mkF(p.f1, p.f1Q, p.f1g);
    const f2 = mkF(p.f2, p.f2Q, p.f2g);
    const f3 = mkF(p.f3, p.f3Q, p.f3g);
    const shelf = ctx.createBiquadFilter();
    shelf.type = "highshelf"; shelf.frequency.value = 8000;
    shelf.gain.value = p.gain < 1.0 ? -2.5 : 0;
    const output = ctx.createGain(); output.gain.value = p.gain;
    input.connect(f1); f1.connect(f2); f2.connect(f3); f3.connect(shelf); shelf.connect(output);
    return { input, output };
  }

  private buildReverb(ctx: BaseAudioContext, wet: number = 0.06): { input: AudioNode; output: GainNode } {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const d1 = ctx.createDelay(0.5); d1.delayTime.value = 0.021;
    const d2 = ctx.createDelay(0.5); d2.delayTime.value = 0.036;
    const fb1 = ctx.createGain(); fb1.gain.value = 0.22;
    const fb2 = ctx.createGain(); fb2.gain.value = 0.18;
    const wetG = ctx.createGain(); wetG.gain.value = wet;
    input.connect(d1); input.connect(d2);
    d1.connect(fb1); fb1.connect(d1);
    d2.connect(fb2); fb2.connect(d2);
    d1.connect(wetG); d2.connect(wetG);
    wetG.connect(output); input.connect(output);
    return { input, output };
  }

  private bufferToWav(buffer: AudioBuffer): ArrayBuffer {
    const nc = buffer.numberOfChannels, sr = buffer.sampleRate;
    const len = buffer.length * nc * 2;
    const ab = new ArrayBuffer(44 + len);
    const v = new DataView(ab);
    const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, "RIFF"); v.setUint32(4, 36 + len, true);
    ws(8, "WAVE"); ws(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, nc, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * nc * 2, true);
    v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true);
    ws(36, "data"); v.setUint32(40, len, true);
    let o = 44;
    for (let i = 0; i < buffer.length; i++) {
      for (let ch = 0; ch < nc; ch++) {
        const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
        v.setInt16(o, s * 0x7fff, true); o += 2;
      }
    }
    return ab;
  }
}
