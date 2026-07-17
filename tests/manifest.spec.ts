import { describe, expect, it } from "vitest";
import manifest from "../animations_manifest.json";

describe("24-action delivery contract", () => {
  it("contains exactly 24 actions and 280 frames", () => {
    expect(manifest).toHaveLength(24);
    expect(manifest.reduce((sum, item) => sum + item.frames, 0)).toBe(280);
    expect(new Set(manifest.map((item) => item.id)).size).toBe(24);
  });

  it("contains 15 loops and 9 recoverable one-shot actions", () => {
    expect(manifest.filter((item) => item.playMode === "loop")).toHaveLength(15);
    const once = manifest.filter((item) => item.playMode === "once");
    expect(once).toHaveLength(9);
    expect(once.every((item) => item.returnTo === "idle_breath")).toBe(true);
  });
});
