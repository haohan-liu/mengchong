import { describe, expect, it } from "vitest";
import { redactContent } from "../src/shared/privacy";

describe("ephemeral context redaction", () => {
  it("limits text and removes tokens, passwords, cards and IDs", () => {
    const result = redactContent("Bearer abcdefghijklmnopqrstuvwxyz password: hunter2 6222021234567890 110101199001011234");
    expect(result.value).not.toContain("hunter2");
    expect(result.value).not.toContain("6222021234567890");
    expect(result.value).not.toContain("110101199001011234");
    expect(result.count).toBeGreaterThanOrEqual(4);
    expect(redactContent("x".repeat(3000)).value).toHaveLength(2000);
  });
});
