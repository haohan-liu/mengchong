import { describe, expect, it } from "vitest";
import { ClickTracker, DragDirectionTracker, dragDirectionForMove, linkedBubbleScale, passedDragThreshold, stepPetScale } from "../src/renderer/interaction";
import { dragGlideForRelease } from "../src/drag-motion";

describe("local interactions", () => {
  it("recognizes three clicks inside 1.2 seconds", () => {
    const tracker = new ClickTracker();
    expect(tracker.push(0)).toBe("single");
    expect(tracker.push(450)).toBe("repeat");
    expect(tracker.push(1100)).toBe("multi");
    expect(tracker.push(1400)).toBe("single");
  });

  it("starts dragging only after the threshold", () => {
    expect(passedDragThreshold({ x: 10, y: 10 }, { x: 13, y: 13 })).toBe(false);
    expect(passedDragThreshold({ x: 10, y: 10 }, { x: 18, y: 10 })).toBe(true);
    expect(passedDragThreshold({ x: 10, y: 10 }, { x: 18, y: 10 }, 12)).toBe(false);
    expect(passedDragThreshold({ x: 10, y: 10 }, { x: 23, y: 10 }, 12)).toBe(true);
  });

  it("keeps a directional drag pose stable on vertical movement", () => {
    expect(dragDirectionForMove({ x: 100, y: 100 }, { x: 126, y: 102 }, "left")).toBe("right");
    expect(dragDirectionForMove({ x: 100, y: 100 }, { x: 74, y: 102 }, "right")).toBe("left");
    expect(dragDirectionForMove({ x: 100, y: 100 }, { x: 101, y: 138 }, "right")).toBe("right");
  });

  it("uses reversal hysteresis instead of chattering around one x position", () => {
    const direction = new DragDirectionTracker("right", 12);
    direction.reset(100, "right");
    expect(direction.update(124)).toBe("right");
    expect(direction.update(119)).toBe("right");
    expect(direction.update(113)).toBe("right");
    expect(direction.update(112)).toBe("left");
    expect(direction.update(118)).toBe("left");
    expect(direction.update(124)).toBe("right");
  });

  it("stops exactly on a normal drag release", () => {
    expect(dragGlideForRelease([
      { point: { x: 100, y: 100 }, at: 1_000 },
      { point: { x: 112, y: 101 }, at: 1_024 },
      { point: { x: 126, y: 102 }, at: 1_048 }
    ], 1_052)).toBeNull();
  });

  it("glides only when the pointer is still moving in a real flick", () => {
    const glide = dragGlideForRelease([
      { point: { x: 100, y: 100 }, at: 1_000 },
      { point: { x: 118, y: 102 }, at: 1_012 },
      { point: { x: 140, y: 104 }, at: 1_024 },
      { point: { x: 168, y: 106 }, at: 1_040 }
    ], 1_044);
    expect(glide).not.toBeNull();
    expect(glide!.distance).toBeGreaterThanOrEqual(72);
    expect(glide!.distance).toBeLessThanOrEqual(128);
    expect(glide!.duration).toBe(280);

    expect(dragGlideForRelease([
      { point: { x: 100, y: 100 }, at: 2_000 },
      { point: { x: 160, y: 100 }, at: 2_024 },
      { point: { x: 160, y: 100 }, at: 2_048 },
      { point: { x: 160, y: 100 }, at: 2_064 }
    ], 2_068)).toBeNull();
  });

  it("steps wheel scaling within the console size limits", () => {
    expect(stepPetScale(1, 1)).toBe(1.01);
    expect(stepPetScale(1, -1)).toBe(0.99);
    expect(stepPetScale(1.5, 1)).toBe(1.5);
    expect(stepPetScale(0.6, -1)).toBe(0.6);
  });

  it("keeps linked speech readable at the pet size limits", () => {
    expect(linkedBubbleScale(0.6)).toBe(0.9);
    expect(linkedBubbleScale(1)).toBe(1);
    expect(linkedBubbleScale(1.5)).toBe(1.19);
  });
});
