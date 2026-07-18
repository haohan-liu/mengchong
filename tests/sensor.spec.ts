import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { categorize } from "../src/shared/categorize";

describe("sensor classification and fallback boundary", () => {
  it("classifies known foreground processes locally", () => {
    expect(categorize("Figma.exe")).toBe("designing");
    expect(categorize("Code.exe")).toBe("developing");
    expect(categorize("Teams.exe")).toBe("meeting");
    expect(categorize("unknown.exe")).toBe("other");
  });

  it("keeps the compatibility hook content-blind", async () => {
    const source = await readFile(new URL("../native/sensor/compat/PetSensorCompat.cs", import.meta.url), "utf8");
    const start = source.indexOf("private static IntPtr KeyboardHook");
    const keyboardHook = source.slice(start, source.indexOf("private static IntPtr MouseHook", start));
    expect(keyboardHook).toContain("Interlocked.Increment(ref keyCount)");
    expect(keyboardHook).not.toContain("Marshal.PtrToStructure");
    expect(source).toContain("keyboardCount1s");
    expect(source).toContain("sensorSource\\\":\\\"compat");
  });
});
