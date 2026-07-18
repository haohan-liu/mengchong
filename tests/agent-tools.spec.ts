import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { TOOL_RULES, validateToolCall } from "../src/shared/AgentToolPolicy";

describe("agent tool policy", () => {
  it("has the fixed safe/confirm split and no shell or file tool", () => {
    expect(TOOL_RULES.open_url.risk).toBe("confirm");
    expect(TOOL_RULES.launch_app.risk).toBe("confirm");
    expect(TOOL_RULES.read_current_context.risk).toBe("confirm");
    expect(TOOL_RULES.set_pet_action.risk).toBe("safe");
    expect(Object.keys(TOOL_RULES).some((name) => /shell|file|delete|install|registry/.test(name))).toBe(false);
  });

  it("rejects undeclared fields and wrong argument types", () => {
    expect(() => validateToolCall("open_url", { url: "https://example.com", extra: true })).toThrow();
    expect(() => validateToolCall("create_reminder", { title: "喝水", minutes: "ten" })).toThrow();
    expect(validateToolCall("open_url", { url: "https://example.com" }).risk).toBe("confirm");
    expect(validateToolCall("launch_app", { app: "计算器", expression: "10*10=" }).arguments.expression).toBe("10*10=");
  });

  it("supports ask, allow and deny preferences for confirm-level tools", async () => {
    const [settings, executor, consoleSource] = await Promise.all([
      readFile(new URL("../electron/services/SettingsStore.ts", import.meta.url), "utf8"),
      readFile(new URL("../electron/services/AgentTools.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/console/main.ts", import.meta.url), "utf8")
    ]);
    expect(settings).toContain('open_url: "ask"');
    expect(settings).toContain('launch_app: "ask"');
    expect(executor).toContain('permission === "deny"');
    expect(executor).toContain('permission === "ask"');
    expect(executor).toContain("visibleWebResult");
    expect(executor).toContain("launchKnownApp");
    expect(consoleSource).toContain("每次询问");
    expect(consoleSource).toContain("打开聊天台");
  });

  it("returns tool output to the model for a final answer instead of stopping at the tool name", async () => {
    const [agentSource, chatSource, executor] = await Promise.all([
      readFile(new URL("../electron/services/DeepSeekAgent.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/chat/main.ts", import.meta.url), "utf8"),
      readFile(new URL("../electron/services/AgentTools.ts", import.meta.url), "utf8")
    ]);
    expect(agentSource).toContain('role: "tool"');
    expect(agentSource).toContain("messages.push");
    expect(agentSource).not.toContain('`\\n${JSON.parse(result).ok ? "已完成" : "未执行"}：${call.name}`');
    expect(chatSource).toContain("以后直接允许");
    expect(executor).toContain("new BrowserWindow");
    expect(executor).toContain("toolWindow.close()");
    expect(executor).toContain("typeCalculatorExpression");
    expect(chatSource).toContain('dialog.returnValue = "deny"');
    expect(chatSource).toContain("window.petAPI.settings.update(next)");
  });
});
