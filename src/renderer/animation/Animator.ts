import type { AnimationDefinition } from "../../types";
import { AssetLoader } from "./AssetLoader";

export class Animator {
  private readonly context: CanvasRenderingContext2D;
  private readonly loader = new AssetLoader();
  private definition: AnimationDefinition | null = null;
  private frames: ImageBitmap[] = [];
  private index = 0;
  private lastFrameAt = 0;
  private raf = 0;
  private transitionStarted = 0;
  private transitionMs = 80;
  private renderedIndex = -1;
  private renderedAlpha = -1;
  private token = 0;
  private onComplete: ((action: string) => void) | null = null;
  private intensity: "full" | "soft" | "minimal" = "full";
  private energySaving = false;
  private resizeTimer = 0;

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
    this.transitionMs = value ? 0 : 80;
    this.resize();
  }
  setCompleteListener(listener: (action: string) => void): void { this.onComplete = listener; }

  async preload(definitions: AnimationDefinition[]): Promise<void> {
    // Two decode streams keep startup responsive without starving the active
    // renderer or growing decoded texture memory in a burst.
    for (let index = 0; index < definitions.length; index += 2) {
      await Promise.allSettled(definitions.slice(index, index + 2).map((definition) => this.loader.load(definition)));
      this.loader.trim("");
    }
  }

  async play(definition: AnimationDefinition): Promise<void> {
    const token = ++this.token;
    const frames = await this.loader.load(definition);
    if (token !== this.token) return;
    this.definition = definition;
    this.frames = frames;
    this.loader.trim(definition.id);
    this.index = 0;
    this.lastFrameAt = performance.now();
    this.transitionStarted = performance.now();
    this.renderedIndex = -1;
    this.renderedAlpha = -1;
    if (!this.raf) this.raf = requestAnimationFrame((time) => this.draw(time));
  }

  private draw(time: number): void {
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
      if (next >= this.frames.length) {
        if (definition.playMode === "loop") this.index = next % this.frames.length;
        else {
          this.index = this.frames.length - 1;
          const completed = definition.id;
          this.definition = null;
          this.onComplete?.(completed);
        }
      } else this.index = next;
    }
    const frame = this.frames[this.index];
    if (!frame) return;
    const alpha = Math.min(1, (time - this.transitionStarted) / this.transitionMs);
    const shouldRender = this.index !== this.renderedIndex || alpha < 1 || this.renderedAlpha < 1;
    if (!shouldRender) return;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.context.save();
    this.context.globalAlpha = alpha;
    this.context.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
    this.context.restore();
    this.renderedIndex = this.index;
    this.renderedAlpha = alpha;
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

  dispose(): void { cancelAnimationFrame(this.raf); window.clearTimeout(this.resizeTimer); this.loader.dispose(); }
}
