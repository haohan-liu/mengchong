import type { AnimationDefinition } from "../../types";

interface CachedAction { frames: ImageBitmap[]; usedAt: number; }

export class AssetLoader {
  private cache = new Map<string, CachedAction>();
  private loading = new Map<string, Promise<ImageBitmap[]>>();
  private generation = 0;
  // Retain the active action and, at most, one short interaction action. A
  // 384px RGBA ImageBitmap uses about 0.56 MB after decoding, so 18 frames
  // keep steady-state texture memory close to 10 MB instead of growing with
  // every action the user has seen.
  private readonly maxFrames = 18;

  async load(definition: AnimationDefinition): Promise<ImageBitmap[]> {
    const cached = this.cache.get(definition.id);
    if (cached) { cached.usedAt = performance.now(); return cached.frames; }
    const pending = this.loading.get(definition.id);
    if (pending) return pending;
    const generation = this.generation;
    let promise!: Promise<ImageBitmap[]>;
    promise = this.loadFrames(definition).then((frames) => {
      // A window can be hidden while images are decoding. Do not let that
      // stale decode repopulate a cache that was explicitly released.
      if (generation !== this.generation) {
        frames.forEach((frame) => frame.close());
        return [];
      }
      this.cache.set(definition.id, { frames, usedAt: performance.now() });
      return frames;
    });
    this.loading.set(definition.id, promise);
    try {
      return await promise;
    } finally {
      // An old, cancelled decode must not delete a newer load for the same
      // action after the pet becomes visible again.
      if (this.loading.get(definition.id) === promise) this.loading.delete(definition.id);
    }
  }

  trim(current: string): void { this.evict(current); }

  private async loadFrames(definition: AnimationDefinition): Promise<ImageBitmap[]> {
    const uniqueFrames: ImageBitmap[] = [];
    try {
      for (let index = 0; index < definition.frames; index += 1) {
        const name = `${definition.id}_${String(index).padStart(3, "0")}.png`;
        const image = new Image();
        const url = new URL(`./sprites/${definition.id}/${name}`, window.location.href).href;
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error(`缺少或无法解码动画帧：${name}`));
          image.src = url;
        });
        // The pet is rendered into a 330×420 CSS box. 384px source bitmaps keep
        // the character sharp while substantially reducing decoded texture RAM.
        uniqueFrames.push(await createImageBitmap(image, { resizeWidth: 384, resizeHeight: 384, resizeQuality: "high" }));
      }
    } catch (error) {
      uniqueFrames.forEach((frame) => frame.close());
      throw error;
    }
    return uniqueFrames;
  }

  private evict(current: string): void {
    let total = [...this.cache.values()].reduce((sum, entry) => sum + entry.frames.length, 0);
    const candidates = [...this.cache.entries()].filter(([id]) => id !== current).sort((a, b) => a[1].usedAt - b[1].usedAt);
    for (const [id, entry] of candidates) {
      if (total <= this.maxFrames) break;
      entry.frames.forEach((frame) => frame.close());
      this.cache.delete(id);
      total -= entry.frames.length;
    }
  }

  clear(): void {
    this.generation += 1;
    this.cache.forEach((entry) => entry.frames.forEach((frame) => frame.close()));
    this.cache.clear();
    this.loading.clear();
  }

  dispose(): void { this.clear(); }
}
