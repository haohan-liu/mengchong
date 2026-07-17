import { describe, expect, it } from "vitest";
import { formatCount, formatDuration } from "../src/console/format";

describe("console value formatting", () => {
  it("promotes durations from minutes to hours and days", () => {
    expect(formatDuration(59)).toBe("59秒");
    expect(formatDuration(60 * 60)).toBe("1小时");
    expect(formatDuration(25 * 60 * 60)).toBe("1天1小时");
  });

  it("keeps large counters precise", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(12_000)).toBe("12,000");
  });
});
