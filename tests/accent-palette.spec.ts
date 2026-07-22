import { describe, expect, it } from "vitest";
import { accentPaletteForPreference } from "../src/shared/accent-palette";

describe("accent color recommendations", () => {
  it("follows the requested color family instead of returning a fixed red palette", () => {
    const green = accentPaletteForPreference("推荐几种绿色强调色");
    const red = accentPaletteForPreference("红色");
    expect(green.label).toBe("绿色");
    expect(green.colors).toHaveLength(5);
    expect(green.colors).not.toEqual(red.colors);
    expect(green.colors.every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true);
  });

  it("builds usable variants around an explicitly supplied hex color", () => {
    const custom = accentPaletteForPreference("以 #246b4a 为主色");
    expect(custom.label).toBe("自定义色");
    expect(custom.colors[0]).toBe("#246b4a");
    expect(new Set(custom.colors).size).toBe(5);
  });
});
