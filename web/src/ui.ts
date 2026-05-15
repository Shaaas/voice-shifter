import { AudioEngine, VOICE_TYPES, VoiceType, Track, DetectionResult } from "./audio";

type AppState = "detecting" | "idle" | "recording" | "preview" | "playing";

export class UI {
  private engine: AudioEngine;
  private detectedVoice: VoiceType = VOICE_TYPES[3];
  private targetVoice: VoiceType = VOICE_TYPES[0];
  private state: AppState = "detecting";
  private animFrame: number | null = null;
  private largeUI: boolean = false;

  constructor(engine: AudioEngine) { this.engine = engine; }

  render(): void {
    const app = document.getElementById("app")!;
    app.innerHTML = this.baseHTML();
    this.bindDetectScreen();
    this.bindHeader();
  }

  private baseHTML(): string {
    return `
      <div class="container" id="container">
        <div class="header">
          <div class="logo"><span class="logo-mark">P</span><span class="logo-text">olyphon</span></div>
          <div class="header-actions">
            <button class="icon-btn" id="largeUIBtn" title="Accessibility: large UI">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            </button>
          </div>
        </div>
        <div id="detectScreen" class="screen screen-detect">
          <div class="detect-card">
            <div class="detect-icon">🎙️</div>
            <h2>What's your voice?</h2>
            <p class="detect-sub">Sing or hum for 3 seconds and we'll find your natural vocal register.</p>
            <div id="detectProgress" class="detect-progress hidden">
              <div class="detect-bar"><div class="detect-fill" id="detectFill"></div></div>
              <div class="detect-hint" id="detectHint">Keep humming...</div>
            </div>
            <button class="btn-detect" id="detectBtn">🎵 Start voice detection</button>
            <button class="btn-skip" id="skipDetect">Skip — I know my voice type</button>
          </div>
        </div>
        <div id="mainScreen" class="screen hidden">
          <div class="voice-banner" id="voiceBanner">
            <div class="banner-left">
              <span class="banner-label">Your voice</span>
              <span class="banner-name" id="bannerDetected">Tenor</span>
              <span class="banner-hz" id="bannerHz"></span>
            </div>
            <svg class="banner-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            <div class="banner-right">
              <span class="banner-label">Singing as</span>
              <span class="banner-name target" id="bannerTarget">Soprano</span>
            </div>
            <button class="banner-redetect" id="redetectBtn" title="Re-detect voice">↺</button>
          </div>
          <div class="step">
            <div class="step-num">1</div>
            <div class="step-body">
              <div class="section-label">Choose target voice</div>
              <div class="voice-grid" id="voiceGrid"></div>
            </div>
          </div>
          <div class="step">
            <div class="step-num">2</div>
            <div class="step-body">
              <div class="section-label">Record your voice</div>
              <div class="rec-row" id="recRow">
                <button id="recBtn" class="btn btn-record"><span class="btn-icon">⏺</span> Record</button>
                <button id="previewBtn" class="btn btn-play" disabled><span class="btn-icon">▶</span> Preview</button>
                <button id="addBtn" class="btn btn-add" disabled><span class="btn-icon">＋</span> Add to choir</button>
              </div>
              <div class="retake-row hidden" id="retakeRow">
                <button id="retakeBtn" class="btn btn-retake"><span class="btn-icon">↺</span> Retake</button>
                <button id="discardBtn" class="btn btn-discard"><span class="btn-icon">✕</span> Discard</button>
              </div>
              <div class="visualizer-wrap">
                <canvas id="visualizer"></canvas>
                <div class="viz-label" id="vizLabel">ready</div>
              </div>
            </div>
          </div>
          <div class="step">
            <div class="step-num">3</div>
            <div class="step-body">
              <div class="section-label">Your choir</div>
              <div id="trackList" class="track-list"><div class="track-empty">No voices yet — record one above.</div></div>
            </div>
          </div>
          <div class="choir-controls">
            <button id="playAllBtn" class="btn btn-play-all" disabled><span class="btn-icon">▶</span> Sing together</button>
            <button id="stopBtn" class="btn btn-stop" disabled><span class="btn-icon">⏹</span> Stop</button>
            <button id="exportBtn" class="btn btn-download" disabled><span class="btn-icon">↓</span> Export</button>
          </div>
          <div class="status" id="statusBar"><span class="status-dot"></span><span id="statusText">Choose a target voice, then record.</span></div>
          <div id="engineBadge" class="engine-badge"><span class="engine-dot"></span> JS Engine</div>
        </div>
      </div>`;
  }

  private bindHeader(): void {
    document.getElementById("largeUIBtn")!.onclick = () => this.toggleLargeUI();
  }

  private bindDetectScreen(): void {
    document.getElementById("detectBtn")!.onclick = () => this.runDetection();
    document.getElementById("skipDetect")!.onclick = () => this.skipDetection();
  }

  private async runDetection(): Promise<void> {
    const btn = document.getElementById("detectBtn") as HTMLButtonElement;
    const progress = document.getElementById("detectProgress")!;
    const hint = document.getElementById("detectHint")!;
    const fill = document.getElementById("detectFill")!;
    btn.disabled = true;
    btn.textContent = "🎙 Listening...";
    progress.classList.remove("hidden");
    try {
      const result = await this.engine.detectVoice((pct) => {
        fill.style.width = `${Math.round(pct * 100)}%`;
        if (pct > 0.66) hint.textContent = "Almost done...";
      });
      this.applyDetection(result);
    } catch { this.skipDetection(); }
  }

  private applyDetection(result: DetectionResult): void {
    const match = VOICE_TYPES.find(v => v.name === result.voiceName) ?? VOICE_TYPES[3];
    this.detectedVoice = match;
    const idx = VOICE_TYPES.indexOf(match);
    this.targetVoice = VOICE_TYPES[idx > 0 ? idx - 1 : idx + 1] ?? VOICE_TYPES[0];
    this.showMainScreen(result);
  }

  private skipDetection(): void {
    this.detectedVoice = VOICE_TYPES[3];
    this.targetVoice = VOICE_TYPES[0];
    this.showMainScreen(null);
  }

  private showMainScreen(result: DetectionResult | null): void {
    document.getElementById("detectScreen")!.classList.add("hidden");
    document.getElementById("mainScreen")!.classList.remove("hidden");
    document.getElementById("bannerDetected")!.textContent = this.detectedVoice.name;
    if (result?.hz) document.getElementById("bannerHz")!.textContent = `${result.hz} Hz`;
    this.renderVoiceGrid();
    this.bindMainScreen();
    this.updateBannerTarget();
    this.watchWasm();
    if (result && result.hz > 0) this.setStatus(`Detected: ${result.voiceName} (${result.hz} Hz). Choose a target voice.`, "active");
  }

  private bindMainScreen(): void {
    document.getElementById("recBtn")!.onclick = () => this.toggleRecord();
    document.getElementById("previewBtn")!.onclick = () => this.preview();
    document.getElementById("addBtn")!.onclick = () => this.addToChoir();
    document.getElementById("retakeBtn")!.onclick = () => this.retake();
    document.getElementById("discardBtn")!.onclick = () => this.discard();
    document.getElementById("playAllBtn")!.onclick = () => this.playAll();
    document.getElementById("stopBtn")!.onclick = () => this.stopAll();
    document.getElementById("exportBtn")!.onclick = () => this.exportMix();
    document.getElementById("redetectBtn")!.onclick = () => this.redetect();
  }

  private renderVoiceGrid(): void {
    const grid = document.getElementById("voiceGrid");
    if (!grid) return;
    grid.innerHTML = "";
    VOICE_TYPES.forEach((v) => {
      const isDetected = v.name === this.detectedVoice.name;
      const isTarget = v.name === this.targetVoice.name;
      const btn = document.createElement("button");
      btn.className = `voice-btn${isTarget ? " active" : ""}${isDetected ? " detected" : ""}`;
      btn.innerHTML = `<span class="vname">${v.name}</span><span class="vrange">${v.range}</span>${isDetected ? `<span class="vbadge">you</span>` : ""}`;
      btn.onclick = () => this.selectTarget(v);
      grid.appendChild(btn);
    });
  }

  private selectTarget(v: VoiceType): void {
    this.targetVoice = v;
    this.renderVoiceGrid();
    this.updateBannerTarget();
    this.setStatus(this.engine.hasPreview() ? `Target: ${v.name} — preview or add to choir.` : `Target: ${v.name} — record your voice.`);
  }

  private updateBannerTarget(): void {
    const el = document.getElementById("bannerTarget");
    if (el) el.textContent = this.targetVoice.name;
  }

  private async toggleRecord(): Promise<void> {
    const recBtn = document.getElementById("recBtn")!;
    if (this.state === "recording") {
      this.setState("idle");
      recBtn.innerHTML = `<span class="btn-icon">⏺</span> Record`;
      recBtn.classList.remove("recording");
      this.cancelVisualizer();
      this.setVizLabel("processing...");
      this.setStatus("Processing...", "active");
      await this.engine.stopRecording();
      const dur = this.engine.getDuration().toFixed(1);
      this.setStatus(`${dur}s recorded — preview, retake, or add to choir.`, "active");
      this.setState("preview");
      this.setBtn("previewBtn", true);
      this.setBtn("addBtn", true);
      this.showRetakeRow(true);
      this.setVizLabel("recorded");
    } else {
      try {
        await this.engine.requestMic();
        this.engine.startRecording();
        this.setState("recording");
        recBtn.innerHTML = `<span class="btn-icon">⏹</span> Stop`;
        recBtn.classList.add("recording");
        this.setBtn("previewBtn", false);
        this.setBtn("addBtn", false);
        this.showRetakeRow(false);
        this.setStatus(`Recording as ${this.targetVoice.name}...`, "recording");
        this.setVizLabel("recording");
        this.drawVisualizer();
      } catch { this.setStatus("Microphone access denied."); }
    }
  }

  private preview(): void {
    this.engine.previewVoice(this.targetVoice.semitones, this.targetVoice.name);
    this.setStatus(`Previewing as ${this.targetVoice.name}...`, "active");
    this.setVizLabel("playing");
    this.drawVisualizer();
  }

  private retake(): void {
    this.engine.discardPreview();
    this.setState("idle");
    this.setBtn("previewBtn", false);
    this.setBtn("addBtn", false);
    this.showRetakeRow(false);
    this.cancelVisualizer();
    this.setVizLabel("ready");
    this.setStatus(`Retaking — record your ${this.targetVoice.name} voice.`);
  }

  private discard(): void {
    this.engine.discardPreview();
    this.setState("idle");
    this.setBtn("previewBtn", false);
    this.setBtn("addBtn", false);
    this.showRetakeRow(false);
    this.cancelVisualizer();
    this.setVizLabel("ready");
    this.setStatus("Recording discarded.");
  }

  private addToChoir(): void {
    const track = this.engine.saveTrack(this.targetVoice.name, this.targetVoice.semitones);
    this.setBtn("previewBtn", false);
    this.setBtn("addBtn", false);
    this.showRetakeRow(false);
    this.setState("idle");
    this.setVizLabel("ready");
    this.setStatus(`${track.label} added! Record another voice or sing together.`, "active");
    this.renderTracks();
    this.updateChoirButtons();
  }

  private renderTracks(): void {
    const list = document.getElementById("trackList")!;
    const tracks = this.engine.getTracks();
    if (tracks.length === 0) { list.innerHTML = `<div class="track-empty">No voices yet — record one above.</div>`; return; }
    list.innerHTML = tracks.map(t => `
      <div class="track-item" id="track-${t.id}">
        <div class="track-info">
          <span class="track-dot" data-voice="${t.voiceName}"></span>
          <span class="track-label">${t.label}</span>
          <span class="track-dur">${t.duration.toFixed(1)}s</span>
        </div>
        <div class="track-mixer">
          <input type="range" class="track-vol" min="0" max="100" value="${Math.round(t.volume * 100)}" data-id="${t.id}" title="Volume" />
          <button class="track-delete" data-id="${t.id}" title="Remove voice">✕</button>
        </div>
      </div>`).join("");
    list.querySelectorAll(".track-vol").forEach(el => {
      (el as HTMLInputElement).oninput = (e) => {
        const input = e.target as HTMLInputElement;
        this.engine.setTrackVolume(input.dataset.id!, parseInt(input.value) / 100);
      };
    });
    list.querySelectorAll(".track-delete").forEach(el => {
      (el as HTMLButtonElement).onclick = (e) => {
        const id = (e.currentTarget as HTMLButtonElement).dataset.id!;
        this.engine.deleteTrack(id);
        this.renderTracks();
        this.updateChoirButtons();
        const n = this.engine.getTracks().length;
        this.setStatus(n === 0 ? "Choir cleared." : `${n} voice${n > 1 ? "s" : ""} in the choir.`);
      };
    });
  }

  private updateChoirButtons(): void {
    const has = this.engine.getTracks().length > 0;
    this.setBtn("playAllBtn", has);
    this.setBtn("exportBtn", has);
  }

  private playAll(): void {
    this.engine.playAll();
    this.setState("playing");
    this.setBtn("stopBtn", true);
    const n = this.engine.getTracks().length;
    this.setStatus(`${n} voice${n > 1 ? "s" : ""} singing together...`, "active");
    this.drawVisualizer();
  }

  private stopAll(): void {
    this.engine.stopAll();
    this.cancelVisualizer();
    this.setState("idle");
    this.setBtn("stopBtn", false);
    this.setVizLabel("ready");
    this.setStatus("Stopped.");
  }

  private async exportMix(): Promise<void> {
    this.setStatus("Mixing and exporting...", "active");
    try {
      await this.engine.exportMix();
      this.setStatus("Exported as polyphon-choir.wav!");
    } catch { this.setStatus("Export failed — no tracks to mix."); }
  }

  private redetect(): void {
    document.getElementById("mainScreen")!.classList.add("hidden");
    document.getElementById("detectScreen")!.classList.remove("hidden");
    const btn = document.getElementById("detectBtn") as HTMLButtonElement;
    btn.disabled = false;
    btn.textContent = "🎵 Start voice detection";
    document.getElementById("detectProgress")!.classList.add("hidden");
    document.getElementById("detectFill")!.style.width = "0%";
    document.getElementById("detectHint")!.textContent = "Keep humming...";
  }

  private drawVisualizer(): void {
    const canvas = document.getElementById("visualizer") as HTMLCanvasElement;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const W = rect.width, H = rect.height;
    const analyser = this.engine.getAnalyser();
    if (!analyser) return;
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      this.animFrame = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(data);
      ctx.fillStyle = "#0e1117"; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "#1e2535"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, "rgba(0,212,170,0.25)");
      grad.addColorStop(0.5, "rgba(0,212,170,0.85)");
      grad.addColorStop(1, "rgba(0,212,170,0.25)");
      ctx.strokeStyle = grad; ctx.lineWidth = 1.5;
      ctx.shadowColor = "#00d4aa"; ctx.shadowBlur = 6;
      ctx.beginPath();
      const slice = W / data.length;
      data.forEach((v, i) => { const y = (v / 128.0) * (H / 2); i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * slice, y); });
      ctx.stroke(); ctx.shadowBlur = 0;
    };
    draw();
  }

  private cancelVisualizer(): void {
    if (this.animFrame) { cancelAnimationFrame(this.animFrame); this.animFrame = null; }
  }

  private toggleLargeUI(): void {
    this.largeUI = !this.largeUI;
    document.getElementById("container")!.classList.toggle("large-ui", this.largeUI);
  }

  private setState(s: AppState): void { this.state = s; }
  private setBtn(id: string, enabled: boolean): void {
    const el = document.getElementById(id) as HTMLButtonElement | null;
    if (el) el.disabled = !enabled;
  }
  private showRetakeRow(show: boolean): void {
    document.getElementById("retakeRow")!.classList.toggle("hidden", !show);
  }
  private setVizLabel(text: string): void {
    const el = document.getElementById("vizLabel"); if (el) el.textContent = text;
  }
  private setStatus(msg: string, state: "idle" | "active" | "recording" = "idle"): void {
    const bar = document.getElementById("statusBar"); if (!bar) return;
    bar.className = `status${state !== "idle" ? " " + state : ""}`;
    const txt = document.getElementById("statusText"); if (txt) txt.textContent = msg;
  }
  private watchWasm(): void {
    const check = () => {
      const badge = document.getElementById("engineBadge"); if (!badge) return;
      if (this.engine.isWasmReady()) { badge.className = "engine-badge wasm"; badge.innerHTML = `<span class="engine-dot"></span> WASM Engine`; }
      else setTimeout(check, 600);
    };
    check();
  }
}
