import type { AnimationDefinition } from "../../types";
import { AssetLoader } from "./AssetLoader";

export class Animator {
  private readonly context: CanvasRenderingContext2D;
  private readonly loader = new AssetLoader();
  private definition: AnimationDefinition | null = null;
  private frames: ImageBitmap[] = [];
  private sequence: number[] = [];
  private loopStart = 0;
  private index = 0;
  private lastFrameAt = 0;
  private raf = 0;
  private transitionStarted = 0;
  private transitionMs = 120;
  private outgoingFrame: ImageBitmap | null = null;
  private renderedIndex = -1;
  private renderedAlpha = -1;
  private token = 0;
  private onComplete: ((action: string) => void) | null = null;
  private intensity: "full" | "soft" | "minimal" = "full";
  private energySaving = false;
  private resizeTimer = 0;
  private horizontalFlip = false;
  private exiting = false;
  private exitResolve: (() => void) | null = null;
  private suspended = false;
  private readonly immediateInterruptActions = new Set(["stand_sleep", "dragged", "error", "offline", "low_battery"]);

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.context = canvas.getContext("2d", { alpha: true })!;
    this.resize();
    // Native-window wheel scaling can fire many resize events per second.
    // Keep the current backing store composited while it moves, then rebuild it
    // once the user has stopped changing the size.
    window.addEventListener("resize", () => this.scheduleResize());
  }

  setIntensity(value: "full" | "soft" | "minimal"): void {
    if (this.intensity === value) return;
    this.intensity = value;
    this.resize();
  }
  setEnergySaving(value: boolean): void {
    if (this.energySaving === value) return;
    this.energySaving = value;
    this.transitionMs = value ? 0 : 120;
    // Energy-saving mode should not retain interaction frames from the
    // previous full-animation session.
    if (value) this.loader.trim(this.definition?.id ?? "");
    this.resize();
  }
  setHorizontalFlip(value: boolean): void {
    if (this.horizontalFlip === value) return;
    this.horizontalFlip = value;
    this.renderedIndex = -1;
    this.renderedAlpha = -1;
  }
  setCompleteListener(listener: (action: string) => void): void { this.onComplete = listener; }

  async preload(definitions: AnimationDefinition[]): Promise<void> {
    if (this.suspended) return;
    // Two decode streams keep startup responsive without starving the active
    // renderer or growing decoded texture memory in a burst.
    for (let index = 0; index < definitions.length; index += 2) {
      await Promise.allSettled(definitions.slice(index, index + 2).map((definition) => this.loader.load(definition)));
      this.loader.trim(this.definition?.id ?? "");
    }
  }

  async setVisible(visible: boolean): Promise<void> {
    if (!visible) {
      if (this.suspended) return;
      this.suspended = true;
      this.token += 1;
      this.cancelExit();
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.frames = [];
      this.outgoingFrame = null;
      this.renderedIndex = -1;
      this.renderedAlpha = -1;
      this.loader.clear();
      // The transparent backing store is small but persistent. Releasing it
      // as well makes a hidden pet give back both decoded frames and canvas
      // memory to Chromium.
      this.canvas.width = 1;
      this.canvas.height = 1;
      return;
    }
    if (!this.suspended) return;
    this.suspended = false;
    this.resize();
    const definition = this.definition;
    if (!definition) return;
    const token = ++this.token;
    const frames = await this.loader.load(definition);
    if (this.suspended || token !== this.token || this.definition?.id !== definition.id || !frames.length) return;
    this.frames = frames;
    this.index = Math.min(this.index, Math.max(0, this.sequence.length - 1));
    this.lastFrameAt = performance.now();
    this.renderedIndex = -1;
    this.renderedAlpha = -1;
    if (!this.raf) this.raf = requestAnimationFrame((time) => this.draw(time));
  }

  async play(definition: AnimationDefinition): Promise<void> {
    if (this.definition?.id === definition.id) return;
    this.cancelExit();
    const token = ++this.token;
    const previous = this.definition;
    const continuous = Boolean(previous?.playback?.continuityGroup
      && previous.playback.continuityGroup === definition.playback?.continuityGroup);
    if (this.suspended) {
      this.definition = definition;
      this.frames = [];
      const playback = this.playbackSequence(definition, continuous);
      this.sequence = playback.sequence;
      this.loopStart = playback.loopStart;
      this.index = 0;
      this.outgoingFrame = null;
      return;
    }
    if (previous?.playback?.exit && previous.playback.interruptPolicy === "after-exit"
      && !continuous && !this.immediateInterruptActions.has(definition.id)) {
      await this.runExit(previous);
      if (token !== this.token) return;
    }
    const frames = await this.loader.load(definition);
    if (token !== this.token) return;
    this.outgoingFrame = this.currentFrame();
    this.definition = definition;
    this.frames = frames;
    const playback = this.playbackSequence(definition, continuous);
    this.sequence = playback.sequence;
    this.loopStart = playback.loopStart;
    this.index = 0;
    this.lastFrameAt = performance.now();
    this.transitionStarted = performance.now();
    this.renderedIndex = -1;
    this.renderedAlpha = -1;
    if (!this.raf) this.raf = requestAnimationFrame((time) => this.draw(time));
  }

  private draw(time: number): void {
    if (this.suspended) { this.raf = 0; return; }
    this.raf = requestAnimationFrame((next) => this.draw(next));
    const definition = this.definition;
    if (!definition || !this.frames.length) return;
    const fpsScale = this.energySaving ? 0.25 : this.intensity === "minimal" ? 0.5 : this.intensity === "soft" ? 0.75 : 1;
    const backgroundScale = document.hidden ? 0.25 : 1;
    const interval = 1000 / Math.max(1, definition.fps * fpsScale * backgroundScale);
    if (time - this.lastFrameAt >= interval) {
      const steps = Math.max(1, Math.floor((time - this.lastFrameAt) / interval));
      this.lastFrameAt += steps * interval;
      const next = this.index + steps;
      if (next >= this.sequence.length) {
        if (this.exiting) {
          this.index = this.sequence.length - 1;
          this.exiting = false;
          const resolve = this.exitResolve;
          this.exitResolve = null;
          resolve?.();
        } else if (definition.playMode === "loop") {
          const loopLength = Math.max(1, this.sequence.length - this.loopStart);
          this.index = this.loopStart + (next - this.loopStart) % loopLength;
        }
        else {
          this.index = this.sequence.length - 1;
          const completed = definition.id;
          this.definition = null;
          this.onComplete?.(completed);
        }
      } else this.index = next;
    }
    const frame = this.currentFrame();
    if (!frame) return;
    const alpha = Math.min(1, (time - this.transitionStarted) / this.transitionMs);
    const shouldRender = this.index !== this.renderedIndex || alpha < 1 || this.renderedAlpha < 1;
    if (!shouldRender) return;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.save();
    if (this.horizontalFlip) {
      this.context.translate(this.canvas.width, 0);
      this.context.scale(-1, 1);
    }
    if (this.outgoingFrame && alpha < 1) {
      this.context.globalAlpha = 1 - alpha;
      this.context.drawImage(this.outgoingFrame, 0, 0, this.canvas.width, this.canvas.height);
    }
    this.context.globalAlpha = alpha;
    this.context.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
    this.context.restore();
    this.renderedIndex = this.index;
    this.renderedAlpha = alpha;
    if (alpha >= 1) {
      this.outgoingFrame = null;
      this.loader.trim(definition.id);
    }
  }

  private currentFrame(): ImageBitmap | null {
    const frameIndex = this.sequence[this.index] ?? this.index;
    return this.frames[frameIndex] ?? null;
  }

  private phaseSequence(definition: AnimationDefinition, value: { from: number; to: number; mode?: "forward" | "ping-pong" }): number[] {
    const range = (from: number, to: number): number[] => {
      const start = Math.max(0, Math.min(definition.frames - 1, Math.round(from)));
      const end = Math.max(0, Math.min(definition.frames - 1, Math.round(to)));
      const step = start <= end ? 1 : -1;
      const result: number[] = [];
      for (let value = start; value !== end + step; value += step) result.push(value);
      return result;
    };
    const forward = range(value.from, value.to);
    if (value.mode !== "ping-pong" || forward.length < 3) return forward;
    return [...forward, ...forward.slice(1, -1).reverse()];
  }

  private playbackSequence(definition: AnimationDefinition, skipEnter = false): { sequence: number[]; loopStart: number } {
    if (definition.playback) {
      const enter = !skipEnter && definition.playback.enter ? this.phaseSequence(definition, definition.playback.enter) : [];
      const sustain = definition.playback.sustain ? this.phaseSequence(definition, definition.playback.sustain) : [];
      const exit = definition.playMode === "once" && definition.playback.exit ? this.phaseSequence(definition, definition.playback.exit) : [];
      const sequence = [...enter, ...sustain, ...exit];
      return { sequence: sequence.length ? sequence : [0], loopStart: Math.min(enter.length, Math.max(0, sequence.length - 1)) };
    }
    const forward = this.phaseSequence(definition, { from: 0, to: definition.frames - 1 });
    const pingPong = forward.length < 3 ? forward : [...forward, ...forward.slice(1, -1).reverse()];
    return { sequence: pingPong, loopStart: 0 };
  }

  private runExit(definition: AnimationDefinition): Promise<void> {
    const exit = definition.playback?.exit;
    if (!exit) return Promise.resolve();
    this.outgoingFrame = this.currentFrame();
    this.sequence = this.phaseSequence(definition, exit);
    this.index = 0;
    this.lastFrameAt = performance.now();
    this.transitionStarted = performance.now();
    this.renderedIndex = -1;
    this.renderedAlpha = -1;
    this.exiting = true;
    return new Promise<void>((resolve) => { this.exitResolve = resolve; });
  }

  private cancelExit(): void {
    if (!this.exitResolve) return;
    const resolve = this.exitResolve;
    this.exitResolve = null;
    this.exiting = false;
    resolve();
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    // Source frames are 512px wide, so a 2x backing store only upscales the
    // source while increasing transparent-canvas memory and compositing work.
    const dprCap = this.energySaving ? 0.85 : this.intensity === "minimal" ? 1 : this.intensity === "soft" ? 1.1 : 1.25;
    const dpr = Math.min(devicePixelRatio, dprCap);
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.renderedIndex = -1;
    this.renderedAlpha = -1;
  }

  private scheduleResize(): void {
    window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = 0;
      this.resize();
    }, 120);
  }

  dispose(): void {
    this.cancelExit();
    this.suspended = true;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.resizeTimer);
    this.loader.dispose();
  }
}
