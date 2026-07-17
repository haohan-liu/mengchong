import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("energy saving mode", () => {
  it("links settings, renderer throttling and both menus", async () => {
    const [types, consoleSource, petSource, animator, mainSource] = await Promise.all([
      readFile(new URL("../src/types.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/console/main.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/renderer/App.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/renderer/animation/Animator.ts", import.meta.url), "utf8"),
      readFile(new URL("../electron/main.ts", import.meta.url), "utf8")
    ]);

    expect(types).toContain('"energy_saving"');
    expect(consoleSource).toContain("节能模式");
    expect(petSource).toContain("data-energy-label");
    expect(animator).toContain("this.energySaving ? 0.25");
    expect(mainSource).toContain("toggleEnergySaving");
    expect(mainSource).toContain("lastEnergySnapshotAt");
  });
});
