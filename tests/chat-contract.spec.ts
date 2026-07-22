import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("agent chat workspace contract", () => {
  it("provides topics, history, context, quota and local fallback surfaces", async () => {
    const [chat, styles, main, agent, store, vite] = await Promise.all([
      readFile(new URL("../src/chat/main.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/chat/styles.css", import.meta.url), "utf8"),
      readFile(new URL("../electron/main.ts", import.meta.url), "utf8"),
      readFile(new URL("../electron/services/DeepSeekAgent.ts", import.meta.url), "utf8"),
      readFile(new URL("../electron/services/DataStore.ts", import.meta.url), "utf8"),
      readFile(new URL("../vite.config.ts", import.meta.url), "utf8")
    ]);
    for (const text of [
      "新建对话",
      "搜索历史对话",
      "本次上下文",
      "本月",
      "本地回复",
      "停止生成",
      "回到最新消息",
      "AI 生成内容仅供参考"
    ]) expect(chat).toContain(text);
    expect(chat).not.toContain('class="header-icon window-close"');
    expect(chat).not.toContain("仅保存在这台电脑");
    expect(chat).toContain("composer-toolbar");
    expect(chat).toContain("cardIds");
    expect(chat).toContain("upsertActionCardNode");
    expect(chat).toContain("selectAccentOption");
    expect(chat).toContain("toggleSidebarCompact");
    expect(chat).toContain("data-sidebar-search");
    expect(chat).toContain("context-drawer-scrim");
    expect(chat).toContain("chat-modal-scrim");
    expect(chat).toContain("syncChatModalScrim");
    expect(chat).toContain("drawer.show()");
    expect(chat).toContain("选择颜色后确认应用");
    expect(chat).toContain('card.status === "pending"');
    expect(chat).toContain("scheduleStreamingRender");
    expect(chat).toContain("finalizeStreamingNode");
    expect(chat).toContain("has-text");
    expect(chat).toContain("已取消，未做更改");
    expect(styles).toContain(".topic-sidebar");
    expect(styles).toContain(".sidebar-collapsed");
    expect(styles).toContain(".message-viewport");
    expect(styles).toContain(":focus-visible");
    expect(styles).toContain("prefers-reduced-motion");
    expect(styles).toContain(".agent-choice-group");
    expect(styles).toContain(".message.streaming .message-body");
    expect(styles).toContain(".context-drawer { position: absolute");
    expect(styles).not.toContain(".context-drawer { position: fixed");
    expect(styles).toContain("--window-content-gutter: 32px");
    expect(styles).not.toContain("calc(100vh - 64px)");
    expect(main).toContain("async function openChat");
    expect(main).toContain('ipcMain.handle("chat:create"');
    expect(agent).toContain("this.data.conversation(sessionId");
    expect(agent).toContain("已达到月度上限");
    expect(store).toContain("async renameChat");
    expect(store).toContain("async deleteChat");
    expect(vite).toContain('chat: resolve(projectRoot, "chat.html")');
  });
});
