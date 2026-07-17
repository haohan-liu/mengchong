import type { AnimationDefinition } from "../../types";

interface CachedAction { frames: ImageBitmap[]; uniqueFrames: ImageBitmap[]; usedAt: number; }

export class AssetLoader {
  private cache = new Map<string, CachedAction>();
  private loading = new Map<string, Promise<ImageBitmap[]>>();
  // Keep the current action plus a small idle set only. A decoded 512px
  // ImageBitmap is much larger than its PNG file, so retaining old actions
  // quickly becomes the dominant renderer-memory cost.
  private readonly maxFrames = 32;

  async load(definition: AnimationDefinition): Promise<ImageBitmap[]> {
    const cached = this.cache.get(definition.id);
    if (cached) { cached.usedAt = performance.now(); return cached.frames; }
    const pending = this.loading.get(definition.id);
    if (pending) return pending;
    const promise = this.loadFrames(definition);
    this.loading.set(definition.id, promise);
    try {
      const frames = await promise;
      this.cache.set(definition.id, { frames, uniqueFrames: [...new Set(frames)], usedAt: performance.now() });
      return frames;
    } finally { this.loading.delete(definition.id); }
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
    // Preserve the former forward-then-exact-reverse visual sequence without
    // storing or decoding a second physical copy of every PNG.
    return [...uniqueFrames, ...[...uniqueFrames].reverse()];
  }

  private evict(current: string): void {
    let total = [...this.cache.values()].reduce((sum, entry) => sum + entry.uniqueFrames.length, 0);
    const candidates = [...this.cache.entries()].filter(([id]) => id !== current).sort((a, b) => a[1].usedAt - b[1].usedAt);
    for (const [id, entry] of candidates) {
      if (total <= this.maxFrames) break;
      entry.uniqueFrames.forEach((frame) => frame.close());
      this.cache.delete(id);
      total -= entry.uniqueFrames.length;
    }
  }

  dispose(): void {
    this.cache.forEach((entry) => entry.uniqueFrames.forEach((frame) => frame.close()));
    this.cache.clear();
  }
}
