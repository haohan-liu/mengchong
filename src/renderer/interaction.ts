import type { DragDirection } from "../types";

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

/**
 * Keep the previous pose during a mostly vertical move. That avoids a visual
 * left/right flicker when a user is simply lifting or lowering the pet.
 */
export function dragDirectionForMove(previous: { x: number; y: number }, current: { x: number; y: number }, fallback: DragDirection): DragDirection {
  const deltaX = current.x - previous.x;
  const deltaY = current.y - previous.y;
  if (Math.abs(deltaX) < Math.max(3, Math.abs(deltaY) * .35)) return fallback;
  return deltaX < 0 ? "left" : "right";
}

/**
 * A direction change must travel far enough back from the furthest point in
 * the current direction. This hysteresis removes left/right chatter from tiny
 * hand corrections without making an intentional turn feel delayed.
 */
export class DragDirectionTracker {
  private direction: DragDirection;
  private extremeX = 0;

  constructor(initial: DragDirection = "right", private readonly reversalDistance = 12) {
    this.direction = initial;
  }

  reset(x: number, direction: DragDirection): void {
    this.extremeX = x;
    this.direction = direction;
  }

  update(x: number): DragDirection {
    if (this.direction === "right") {
      if (x >= this.extremeX) this.extremeX = x;
      else if (this.extremeX - x >= this.reversalDistance) {
        this.direction = "left";
        this.extremeX = x;
      }
      return this.direction;
    }
    if (x <= this.extremeX) this.extremeX = x;
    else if (x - this.extremeX >= this.reversalDistance) {
      this.direction = "right";
      this.extremeX = x;
    }
    return this.direction;
  }
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
