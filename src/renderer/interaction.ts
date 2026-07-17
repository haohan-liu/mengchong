export class ClickTracker {
  private times: number[] = [];
  constructor(private windowMs = 1200, private count = 3) {}
  push(now: number): "single" | "repeat" | "multi" {
    this.times = this.times.filter((value) => now - value <= this.windowMs);
    this.times.push(now);
    if (this.times.length >= this.count) { this.times = []; return "multi"; }
    return this.times.length === 1 ? "single" : "repeat";
  }
}

export function passedDragThreshold(start: { x: number; y: number }, current: { x: number; y: number }, threshold = 5): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}

export const PET_SCALE_MIN = 0.6;
export const PET_SCALE_MAX = 1.5;
export const PET_SCALE_STEP = 0.01;

export function stepPetScale(current: number, direction: -1 | 1): number {
  const stepped = Math.round((current + direction * PET_SCALE_STEP) * 100) / 100;
  return Math.min(PET_SCALE_MAX, Math.max(PET_SCALE_MIN, stepped));
}

export function linkedBubbleScale(petScale: number): number {
  const linked = Math.round((0.62 + petScale * 0.38) * 100) / 100;
  return Math.min(1.2, Math.max(0.9, linked));
}
