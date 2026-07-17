import { describe, expect, it } from "vitest";
import { ClickTracker, linkedBubbleScale, passedDragThreshold, stepPetScale } from "../src/renderer/interaction";

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
