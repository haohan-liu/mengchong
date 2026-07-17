import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { TOOL_RULES, validateToolCall } from "../src/shared/AgentToolPolicy";

describe("agent tool policy", () => {
  it("has the fixed safe/confirm split and no shell or file tool", () => {
    expect(TOOL_RULES.open_url.risk).toBe("confirm");
    expect(TOOL_RULES.read_current_context.risk).toBe("confirm");
    expect(TOOL_RULES.set_pet_action.risk).toBe("safe");
    expect(Object.keys(TOOL_RULES).some((name) => /shell|file|delete|install|registry/.test(name))).toBe(false);
  });

  it("rejects undeclared fields and wrong argument types", () => {
    expect(() => validateToolCall("open_url", { url: "https://example.com", extra: true })).toThrow();
    expect(() => validateToolCall("create_reminder", { title: "喝水", minutes: "ten" })).toThrow();
    expect(validateToolCall("open_url", { url: "https://example.com" }).risk).toBe("confirm");
  });

  it("supports ask, allow and deny preferences for confirm-level tools", async () => {
    const [settings, executor, consoleSource] = await Promise.all([
      readFile(new URL("../electron/services/SettingsStore.ts", import.meta.url), "utf8"),
      readFile(new URL("../electron/services/AgentTools.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/console/main.ts", import.meta.url), "utf8")
    ]);
    expect(settings).toContain('open_url: "ask"');
    expect(executor).toContain('permission === "deny"');
    expect(executor).toContain('permission === "ask"');
    expect(consoleSource).toContain("每次询问");
  });
});
