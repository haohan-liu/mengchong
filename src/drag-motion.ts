export interface TimedDragPoint {
  point: { x: number; y: number };
  at: number;
}

export interface DragGlide {
  velocity: { x: number; y: number };
  speed: number;
  distance: number;
  duration: number;
  decayTime: number;
}

// Release inertia is intentionally a high-speed gesture, not a continuation
// of every drag. These values require a real mouse flick while keeping the
// resulting tail short enough to feel like a soft release rather than a throw.
export const DRAG_RELEASE_SAMPLE_WINDOW_MS = 72;
export const DRAG_RELEASE_MAX_SAMPLE_AGE_MS = 32;
export const DRAG_RELEASE_MIN_DURATION_MS = 16;
export const DRAG_RELEASE_MIN_DISTANCE = 14;
export const DRAG_RELEASE_MIN_SPEED = .85;
export const DRAG_RELEASE_MIN_PEAK_SPEED = 1.2;
export const DRAG_RELEASE_MAX_MOVEMENT_AGE_MS = 28;
export const DRAG_GLIDE_MIN_DISTANCE = 72;
export const DRAG_GLIDE_MAX_DISTANCE = 128;
export const DRAG_GLIDE_DURATION_MS = 280;
export const DRAG_GLIDE_DECAY_TIME_MS = 80;

export function dragGlideForRelease(samples: readonly TimedDragPoint[], releasedAt: number): DragGlide | null {
  const recent = samples.filter((sample) => sample.at >= releasedAt - DRAG_RELEASE_SAMPLE_WINDOW_MS && sample.at <= releasedAt);
  const last = recent.at(-1);
  if (!last || releasedAt - last.at > DRAG_RELEASE_MAX_SAMPLE_AGE_MS) return null;

  // Measure the terminal part of the gesture. Using the whole drag makes a
  // short, decisive flick disappear inside the preceding slower placement.
  const tailCutoff = last.at - 44;
  const tail = recent.filter((sample) => sample.at >= tailCutoff);
  const first = tail[0];
  if (!first) return null;

  const duration = last.at - first.at;
  if (duration < DRAG_RELEASE_MIN_DURATION_MS) return null;
  const deltaX = last.point.x - first.point.x;
  const deltaY = last.point.y - first.point.y;
  const travelled = Math.hypot(deltaX, deltaY);
  const speed = travelled / duration;
  if (travelled < DRAG_RELEASE_MIN_DISTANCE || speed < DRAG_RELEASE_MIN_SPEED) return null;

  let peakSpeed = 0;
  let lastMovementAt = first.at;
  for (let index = 1; index < tail.length; index += 1) {
    const previous = tail[index - 1]!;
    const current = tail[index]!;
    const elapsed = current.at - previous.at;
    if (elapsed <= 0) continue;
    const segmentDistance = Math.hypot(current.point.x - previous.point.x, current.point.y - previous.point.y);
    peakSpeed = Math.max(peakSpeed, segmentDistance / elapsed);
    if (segmentDistance >= 1) lastMovementAt = current.at;
  }
  // Average speed alone can classify a brisk normal placement as a fling.
  // Requiring one genuinely fast segment preserves the deliberate gesture.
  if (peakSpeed < DRAG_RELEASE_MIN_PEAK_SPEED) return null;
  // Moving quickly and then pausing before release means "put it here".
  if (releasedAt - lastMovementAt > DRAG_RELEASE_MAX_MOVEMENT_AGE_MS) return null;

  const finalSpeed = Math.min(1.6, Math.max(DRAG_RELEASE_MIN_SPEED, speed));
  const naturalDistance = finalSpeed * DRAG_GLIDE_DECAY_TIME_MS * (1 - Math.exp(-DRAG_GLIDE_DURATION_MS / DRAG_GLIDE_DECAY_TIME_MS));

  return {
    velocity: { x: deltaX / duration, y: deltaY / duration },
    speed,
    distance: Math.min(DRAG_GLIDE_MAX_DISTANCE, Math.max(DRAG_GLIDE_MIN_DISTANCE, naturalDistance)),
    duration: DRAG_GLIDE_DURATION_MS,
    decayTime: DRAG_GLIDE_DECAY_TIME_MS
  };
}
