import { AudioEngine, VOICE_TYPES, VoiceType } from "./audio";

export class UI {
  private engine: AudioEngine;
  private selectedVoice: VoiceType = VOICE_TYPES[3]; // Tenor default
  private isRecording: boolean = false;
  private fineOffset: number = 0;
  private animFrame: number | null = null;

  constructor(engine: AudioEngine) {
    this.engine = engine;
  }

  render(): void {
    const app = document.getElementById("app")!;
    app.innerHTML = `
      <div class="container">
        <h1>Voice Shifter</h1>
        <p class="subtitle">Record your voice and hear it in any vocal register</p>

        <div class="voice-grid" id="voiceGrid"></div>

        <div class="controls">
          <button id="recBtn" class="btn">&#9679; Record</button>
          <button id="playBtn" class="btn" disabled>&#9654; Play</button>
          <button id="downloadBtn" class="btn" disabled>&#8595; Download</button>
        </div>

        <canvas id="visualizer" width="600" height="80"></canvas>

        <div class="slider-row">
          <label>Fine tune</label>
          <input type="range" id="fineSlider" min="-12" max="12" step="1" value="0" />
          <span id="fineVal">0 st</span>
        </div>

        <div id="status" class="status">Pick a voice type, then record.</div>
      </div>
    `;

    this.renderVoiceGrid();
    this.bindEvents();
  }

  private renderVoiceGrid(): void {
    const grid = document.getElementById("voiceGrid")!;
    VOICE_TYPES.forEach((v, i) => {
      const btn = document.createElement("button");
      btn.className = "voice-btn" + (i === 3 ? " active" : "");
      btn.id = `voice-${i}`;
      btn.innerHTML = `
        <span class="vname">${v.name}</span>
        <span class="vshift">${v.semitones > 0 ? "+" : ""}${v.semitones} st</span>
      `;
      btn.onclick = () => this.selectVoice(i);
      grid.appendChild(btn);
    });
  }

  private bindEvents(): void {
    document.getElementById("recBtn")!.onclick = () => this.toggleRecord();
    document.getElementById("playBtn")!.onclick = () => this.playShifted();
    document.getElementById("downloadBtn")!.onclick = () => this.downloadShifted();
    document.getElementById("fineSlider")!.oninput = (e) => {
      this.fineOffset = parseInt((e.target as HTMLInputElement).value);
      document.getElementById("fineVal")!.textContent = `${this.fineOffset > 0 ? "+" : ""}${this.fineOffset} st`;
    };
  }

  private selectVoice(i: number): void {
    this.selectedVoice = VOICE_TYPES[i];
    document.querySelectorAll(".voice-btn").forEach((b, j) => {
      b.classList.toggle("active", j === i);
    });
    this.setStatus(`Selected: ${this.selectedVoice.name}. ${this.engine.hasRecording() ? "Hit Play to hear the transformation." : "Record your voice to continue."}`);
  }

  private async toggleRecord(): Promise<void> {
    const btn = document.getElementById("recBtn")!;
    if (!this.isRecording) {
      try {
        await this.engine.requestMic();
        this.engine.startRecording();
        this.isRecording = true;
        btn.textContent = "⏹ Stop";
        btn.classList.add("recording");
        this.setStatus("Recording... click Stop when done.");
        this.drawVisualizer();
      } catch {
        this.setStatus("Microphone access denied.");
      }
    } else {
      this.engine.stopRecording();
      this.isRecording = false;
      btn.textContent = "⏺ Record";
      btn.classList.remove("recording");
      this.cancelVisualizer();

      setTimeout(() => {
        if (this.engine.hasRecording()) {
          const dur = this.engine.getDuration().toFixed(1);
          this.setStatus(`${dur}s recorded. Hit Play to hear it as ${this.selectedVoice.name}.`);
          (document.getElementById("playBtn") as HTMLButtonElement).disabled = false;
          (document.getElementById("downloadBtn") as HTMLButtonElement).disabled = false;
        }
      }, 300);
    }
  }

 private playShifted(): void {
  if (this.engine.isWasmReady()) {
    this.engine.playWithWasm(this.selectedVoice.semitones, this.fineOffset);
    this.setStatus(`Playing as ${this.selectedVoice.name} (WASM engine)...`);
  } else {
    this.engine.playShifted(
      this.selectedVoice.semitones,
      this.fineOffset,
      this.selectedVoice.name
    );
    this.setStatus(`Playing as ${this.selectedVoice.name}...`);
  }
  this.drawVisualizer();
}

  private async downloadShifted(): Promise<void> {
    try {
      this.setStatus("Rendering audio, please wait...");
      await this.engine.exportShifted(
        this.selectedVoice.semitones,
        this.fineOffset,
        this.selectedVoice.name
      );
      this.setStatus("Download started!");
    } catch (e) {
      this.setStatus("Export failed. Make sure you have a recording first.");
    }
  }

  private drawVisualizer(): void {
    const canvas = document.getElementById("visualizer") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const analyser = this.engine.getAnalyser();
    if (!analyser) return;

    const data = new Uint8Array(analyser.frequencyBinCount);

    const draw = () => {
      this.animFrame = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#7F77DD";
      ctx.lineWidth = 2;
      ctx.beginPath();
      const slice = canvas.width / data.length;
      data.forEach((v, i) => {
        const y = (v / 128) * (canvas.height / 2);
        i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * slice, y);
      });
      ctx.stroke();
    };
    draw();
  }

  private cancelVisualizer(): void {
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
  }

  private setStatus(msg: string): void {
    document.getElementById("status")!.textContent = msg;
  }
}