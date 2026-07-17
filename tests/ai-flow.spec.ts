import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("electron", () => ({ clipboard: { readText: () => "" } }));

describe("DeepSeek local degradation", () => {
  it("parses and de-duplicates temporary companion batches", async () => {
    const { parseCompanionBatch } = await import("../electron/services/DeepSeekAgent");
    const batch = parseCompanionBatch('```json\n{"click":["你来找我啦","你来找我啦","收到你的招呼啦","被你戳醒了，早安"],"proactive":["记得喝口水呀"]}\n```');
    expect(batch.click).toEqual(["你来找我啦", "收到你的招呼啦"]);
    expect(batch.proactive).toEqual(["记得喝口水呀"]);
  });

  it("keeps the pet responsive when no API key is available", async () => {
    const { DeepSeekAgent } = await import("../electron/services/DeepSeekAgent");
    const chunks: unknown[] = [];
    const chats: unknown[] = [];
    const settingsStore = { get: () => ({ ai: { monthlyLimit: 10 }, sensing: {} }), getApiKey: async () => "" };
    const data = {
      getStatistics: () => ({ days: [] }), getCurrentMonthAiCalls: () => 0, increment: vi.fn(),
      appendChat: async (...messages: unknown[]) => { chats.push(messages); }
    };
    const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: (_channel: string, chunk: unknown) => chunks.push(chunk) });
    const snapshot = { online: true };
    const tools = { execute: vi.fn() };
    const agent = new DeepSeekAgent(settingsStore as never, data as never, () => snapshot as never, tools as never);
    await agent.chat("你好", sender as never);
    await vi.waitFor(() => expect(chunks.length).toBeGreaterThanOrEqual(2));
    expect(chunks.some((chunk) => (chunk as { source: string }).source === "local")).toBe(true);
    expect(chats).toHaveLength(1);
  });

  it("serves built-in speech without an API key", async () => {
    const { DeepSeekAgent } = await import("../electron/services/DeepSeekAgent");
    const settingsStore = { get: () => ({ ai: { monthlyLimit: 10, smartCompanionSpeech: true }, sensing: {} }), getApiKey: async () => "" };
    const data = { getCurrentMonthAiCalls: () => 0, increment: vi.fn() };
    const agent = new DeepSeekAgent(settingsStore as never, data as never, () => ({ online: true }) as never, {} as never);
    const lines = await Promise.all(Array.from({ length: 5 }, () => agent.nextCompanionLine("click")));
    expect(lines.every((line) => line.length > 0)).toBe(true);
    expect(data.increment).not.toHaveBeenCalled();
  });
});
