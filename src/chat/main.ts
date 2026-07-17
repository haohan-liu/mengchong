import "./styles.css";
import type { AgentToolCall, ChatChunk, ChatMessage, ChatSession, ChatSessionSummary, ChatStatus, ContentContext, Settings } from "../types";
import { escapeHtml, safeAccent } from "../console/ui";

type IconName = "plus" | "search" | "message" | "settings" | "context" | "send" | "stop" | "copy" | "edit" | "trash" | "close" | "menu";

const icon = (name: IconName): string => {
  const paths = {
    plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    message: '<path d="M21 14a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 9h8M8 13h5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    context: '<path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/>', send: '<path d="m3 11 18-8-8 18-2-7-8-3Z"/><path d="m11 14 4-4"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>', copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    edit: '<path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20Z"/><path d="m13.5 7 3.5 3.5"/>', trash: '<path d="M4 7h16M9 11v6M15 11v6M6 7l1 14h10l1-14M9 7V3h6v4"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>', menu: '<path d="M4 7h16M4 12h16M4 17h16"/>'
  } as const;
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`;
};

interface StreamingMessage { sessionId: string; requestId: string; text: string; source: "api" | "local"; userId: string; error?: string; }

class ChatApp {
  private settings!: Settings;
  private status!: ChatStatus;
  private sessions: ChatSessionSummary[] = [];
  private messages: ChatMessage[] = [];
  private activeId = "";
  private nextCursor: number | null = null;
  private streaming: StreamingMessage | null = null;
  private search = "";
  private statusTimer = 0;
  private toastTimer = 0;
  private pageLoading = false;
  private creatingTopic = false;
  private drafts = new Map<string, string>();
  private contextReturnFocus: HTMLElement | null = null;
  private root = document.querySelector<HTMLElement>("#chat-app")!;

  async mount(): Promise<void> {
    this.renderSkeleton();
    try {
      [this.settings, this.status, this.sessions] = await Promise.all([
        window.petAPI.settings.get(), window.petAPI.chat.status(), window.petAPI.chat.list()
      ]);
      if (!this.sessions.length) this.sessions = [this.summary(await window.petAPI.chat.create())];
      this.activeId = this.sessions[0]?.id ?? "";
      this.renderShell();
      this.bind();
      this.renderTopics();
      this.renderStatus();
      this.updateComposerState();
      await this.loadActiveMessages();
      window.petAPI.chat.onChunk((chunk) => this.handleChunk(chunk));
      window.petAPI.settings.onChanged((settings) => {
        this.settings = settings;
        this.applyTheme();
        this.syncBranding();
        void this.refreshStatus();
      });
      window.petAPI.pet.onActivity(() => {
        window.clearTimeout(this.statusTimer);
        this.statusTimer = window.setTimeout(() => void this.refreshStatus(), 650);
      });
      window.petAPI.agentApproval.onRequest((call) => this.requestApproval(call));
    } catch (error) {
      this.root.innerHTML = `<main class="chat-failure"><span class="failure-mark">!</span><h1>聊天台未能加载</h1><p>${escapeHtml(error instanceof Error ? error.message : "请关闭后重试")}</p><button type="button" data-reload-chat>重新加载</button></main>`;
      this.root.querySelector("[data-reload-chat]")?.addEventListener("click", () => location.reload());
    }
  }

  private renderSkeleton(): void {
    this.root.innerHTML = `<div class="chat-shell chat-loading-shell" aria-busy="true"><aside class="topic-sidebar"><div class="skeleton brand-skeleton"></div><div class="skeleton button-skeleton"></div><div class="skeleton search-skeleton"></div><div class="skeleton topic-skeleton"></div><div class="skeleton topic-skeleton"></div></aside><main class="conversation"><header class="conversation-header"><div class="skeleton header-skeleton"></div></header><section class="message-viewport"><div class="messages"><div class="skeleton message-skeleton"></div><div class="skeleton message-skeleton short"></div><div class="skeleton message-skeleton"></div></div></section></main></div>`;
  }

  private renderShell(): void {
    this.root.innerHTML = `<div class="chat-shell theme-${this.settings.appearance.theme}" style="--accent:${safeAccent(this.settings.appearance.accentColor)}">
      <aside class="topic-sidebar" id="topic-sidebar" aria-label="对话导航"><div class="chat-brand"><span class="brand-avatar" data-chat-initial>${escapeHtml(Array.from(this.chatName())[0] ?? "珊")}</span><div><b><span data-chat-name>${escapeHtml(this.chatName())}</span> 智能体</b><small><i></i>本地私密 · 随时陪伴</small></div></div><button class="new-topic primary-action" type="button">${icon("plus")}<span>新建对话</span></button><div class="topic-search">${icon("search")}<input type="search" placeholder="搜索历史对话" aria-label="搜索历史对话"><button type="button" data-clear-search aria-label="清除搜索" title="清除搜索" hidden>${icon("close")}</button></div><div class="topic-caption"><span>对话记录</span><small data-topic-count></small></div><nav class="topic-list" aria-label="聊天话题"></nav><div class="sidebar-footer"><button type="button" data-open-console="ai" title="打开智能体与隐私设置">${icon("settings")}<span>智能体与隐私设置</span></button><div class="privacy-note">${icon("context")}<span><b>仅保存在这台电脑</b><small>上下文不会写入聊天记录</small></span></div></div></aside><button class="sidebar-scrim" type="button" aria-label="收起对话导航" hidden></button>
      <main class="conversation"><header class="conversation-header"><button class="mobile-menu" type="button" aria-label="展开对话导航" aria-controls="topic-sidebar" aria-expanded="false">${icon("menu")}</button><div class="conversation-title"><span class="title-avatar" data-chat-initial>${escapeHtml(Array.from(this.chatName())[0] ?? "珊")}</span><div><div class="title-line"><h1 data-chat-title>新对话</h1><span class="conversation-presence" data-chat-presence><i></i>在线</span></div><p data-model-label></p></div></div><div class="header-actions"><button class="status-chip" type="button" data-show-context aria-expanded="false" title="查看本次上下文"></button><button class="header-icon" type="button" data-open-console="ai" aria-label="打开聊天设置" title="聊天设置">${icon("settings")}</button><button class="header-icon window-close" type="button" aria-label="关闭聊天" title="关闭聊天">${icon("close")}</button></div></header><section class="message-viewport"><div class="messages" role="log" aria-live="polite" aria-relevant="additions text"></div></section><button class="jump-latest" type="button" data-jump-latest hidden>${icon("send")}<span>回到最新消息</span></button><footer class="composer-area"><div class="local-mode-banner" hidden></div><form class="composer"><textarea data-chat-composer rows="1" maxlength="8000" placeholder="给${escapeHtml(this.chatName())}发消息…" aria-label="给${escapeHtml(this.chatName())}发送消息" aria-describedby="composer-help"></textarea><button class="send-button" type="submit" aria-label="发送消息" title="发送消息" disabled>${icon("send")}</button><button class="stop-button" type="button" aria-label="停止生成" title="停止生成" hidden>${icon("stop")}</button></form><div class="composer-meta"><span class="composer-state"><span data-context-meta></span><span data-quota-meta></span></span><span class="composer-guidance"><span data-character-count>0 / 8000</span><span id="composer-help" data-compose-status role="status">Enter 发送 · Shift+Enter 换行</span></span></div><p class="ai-notice">AI 生成内容仅供参考，请核对重要信息</p></footer></main>
      <dialog class="context-drawer" aria-labelledby="context-drawer-title"><header><div><b id="context-drawer-title">本次上下文</b><small>发送前临时读取并脱敏，不写入聊天记录</small></div><button type="button" data-close-context aria-label="关闭上下文面板" title="关闭">${icon("close")}</button></header><div class="context-content"></div><button type="button" class="drawer-settings" data-open-console="privacy">${icon("settings")}在控制台修改感知范围</button></dialog>
      <dialog class="approval-dialog"><form method="dialog"><span class="approval-icon">${icon("context")}</span><h2>允许智能体执行工具？</h2><p data-approval-copy></p><pre data-approval-detail></pre><div><button value="deny">暂不允许</button><button value="allow" class="approve">允许本次</button></div></form></dialog>
      <dialog class="rename-dialog"><form method="dialog"><h2>重命名对话</h2><p>使用一个容易识别的名称，之后可以从对话记录继续聊。</p><label>对话名称<input maxlength="48" autocomplete="off"></label><div><button value="cancel">取消</button><button value="save" class="save">保存</button></div></form></dialog>
      <dialog class="delete-dialog"><form method="dialog"><span class="danger-icon">${icon("trash")}</span><h2>删除这段对话？</h2><p>“<span data-delete-name></span>”及其中的全部消息将从本地永久删除。</p><div><button value="cancel">取消</button><button value="delete" class="delete-confirm">删除对话</button></div></form></dialog>
      <div class="toast" data-toast role="status" aria-live="polite" hidden></div>
    </div>`;
  }

  private bind(): void {
    const textarea = this.textarea();
    const searchInput = this.root.querySelector<HTMLInputElement>(".topic-search input")!;
    this.root.querySelector(".new-topic")?.addEventListener("click", () => void this.createTopic());
    searchInput.addEventListener("input", () => {
      this.search = searchInput.value.trim().toLowerCase();
      const clear = this.root.querySelector<HTMLButtonElement>("[data-clear-search]");
      if (clear) clear.hidden = !searchInput.value;
      this.renderTopics();
    });
    this.root.querySelector("[data-clear-search]")?.addEventListener("click", () => {
      searchInput.value = "";
      this.search = "";
      this.root.querySelector<HTMLButtonElement>("[data-clear-search]")!.hidden = true;
      this.renderTopics();
      searchInput.focus();
    });
    this.root.querySelector(".topic-list")?.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const action = target.closest<HTMLButtonElement>("button[data-topic-action]");
      const item = target.closest<HTMLElement>("[data-topic-id]");
      if (!item) return;
      if (action?.dataset.topicAction === "rename") void this.renameTopic(item.dataset.topicId!);
      else if (action?.dataset.topicAction === "delete") void this.deleteTopic(item.dataset.topicId!);
      else void this.selectTopic(item.dataset.topicId!);
    });
    this.root.querySelector(".composer")?.addEventListener("submit", (event) => { event.preventDefault(); void this.send(); });
    textarea.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void this.send(); } });
    textarea.addEventListener("input", () => { this.resizeComposer(); this.saveDraft(); this.updateComposerState(); });
    this.root.querySelector(".stop-button")?.addEventListener("click", () => void this.stop());
    this.root.querySelectorAll<HTMLElement>("[data-open-console]").forEach((button) => button.addEventListener("click", () => void window.petAPI.console.open((button.dataset.openConsole ?? "ai") as "ai" | "privacy")));
    this.root.querySelector(".window-close")?.addEventListener("click", () => void window.petAPI.chat.close());
    this.root.querySelector("[data-show-context]")?.addEventListener("click", (event) => { this.contextReturnFocus = event.currentTarget as HTMLElement; void this.showContext(); });
    this.root.querySelector("[data-close-context]")?.addEventListener("click", () => this.hideContext());
    this.root.querySelector<HTMLDialogElement>(".context-drawer")?.addEventListener("close", () => { this.root.querySelector<HTMLElement>("[data-show-context]")?.setAttribute("aria-expanded", "false"); this.contextReturnFocus?.focus(); });
    this.root.querySelector(".mobile-menu")?.addEventListener("click", () => this.toggleSidebar());
    this.root.querySelector(".sidebar-scrim")?.addEventListener("click", () => this.toggleSidebar(false));
    this.root.querySelector("[data-jump-latest]")?.addEventListener("click", () => this.scrollToEnd());
    this.viewport().addEventListener("scroll", () => this.handleViewportScroll(), { passive: true });
    this.root.querySelector(".messages")?.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-load-older]")) void this.loadOlder();
      const copy = target.closest<HTMLButtonElement>("[data-copy-message]");
      if (copy) void this.copyMessage(copy);
      const suggestion = target.closest<HTMLButtonElement>("[data-suggestion]");
      if (suggestion) {
        textarea.value = suggestion.dataset.suggestion ?? "";
        this.resizeComposer();
        this.saveDraft();
        this.updateComposerState();
        textarea.focus();
      }
    });
    this.root.addEventListener("keydown", (event) => this.handleKeyboard(event));
  }

  private async loadActiveMessages(): Promise<void> {
    const id = this.activeId;
    if (!id) return;
    const page = await window.petAPI.chat.messages(id, 0, 50);
    if (id !== this.activeId) return;
    this.messages = page.messages;
    this.nextCursor = page.nextCursor;
    this.renderMessages(true);
    this.restoreDraft();
  }

  private async loadOlder(): Promise<void> {
    if (this.pageLoading || this.nextCursor === null || this.streaming) return;
    this.pageLoading = true;
    const id = this.activeId;
    const cursor = this.nextCursor;
    const viewport = this.viewport();
    const beforeHeight = viewport.scrollHeight;
    this.setOlderLoading(true);
    try {
      const page = await window.petAPI.chat.messages(id, cursor, 50);
      if (id !== this.activeId) return;
      const known = new Set(this.messages.map((message) => message.id));
      const older = page.messages.filter((message) => !known.has(message.id));
      this.messages = [...older, ...this.messages];
      this.nextCursor = page.nextCursor;
      const loader = this.root.querySelector<HTMLElement>("[data-load-older]");
      if (older.length && loader) loader.insertAdjacentHTML("afterend", older.map((message) => this.messageHtml(message)).join(""));
      this.setOlderLoading(false);
      viewport.scrollTop += viewport.scrollHeight - beforeHeight;
    } catch {
      this.showToast("更早的消息加载失败，请稍后重试", "error");
    } finally {
      this.pageLoading = false;
      this.setOlderLoading(false);
    }
  }

  private renderTopics(): void {
    const list = this.root.querySelector<HTMLElement>(".topic-list");
    if (!list) return;
    const sessions = this.sessions.filter((session) => !this.search || `${session.title} ${session.lastMessagePreview}`.toLowerCase().includes(this.search));
    const count = this.root.querySelector<HTMLElement>("[data-topic-count]");
    if (count) count.textContent = this.search ? `${sessions.length} / ${this.sessions.length}` : `${this.sessions.length} 个`;
    list.innerHTML = sessions.length ? sessions.map((session) => `<div class="topic-item ${session.id === this.activeId ? "active" : ""}" data-topic-id="${escapeHtml(session.id)}"><button class="topic-main" type="button"${session.id === this.activeId ? ' aria-current="page"' : ""}><span class="topic-icon">${icon("message")}</span><span class="topic-copy"><b>${escapeHtml(session.title)}</b><small>${escapeHtml(session.lastMessagePreview || "还没有消息")}</small><time>${this.relativeTime(session.updatedAt)}</time></span></button><div class="topic-actions"><button type="button" data-topic-action="rename" aria-label="重命名“${escapeHtml(session.title)}”" title="重命名">${icon("edit")}</button><button type="button" data-topic-action="delete" aria-label="删除“${escapeHtml(session.title)}”" title="删除">${icon("trash")}</button></div></div>`).join("") : `<div class="no-topics">${icon("search")}<b>没有找到相关对话</b><span>试试更短的关键词</span></div>`;
  }

  private renderMessages(scrollToEnd = false): void {
    const container = this.root.querySelector<HTMLElement>(".messages");
    const session = this.activeSession();
    if (!container || !session) return;
    this.root.querySelector<HTMLElement>("[data-chat-title]")!.textContent = session.title;
    if (!this.messages.length) {
      container.innerHTML = `<div class="empty-chat"><div class="empty-orb"><span data-chat-initial>${escapeHtml(Array.from(this.chatName())[0] ?? "珊")}</span></div><p class="empty-kicker"><span data-chat-name>${escapeHtml(this.chatName())}</span> 已准备好</p><h2>今天想一起完成什么？</h2><p>可以从当前桌面任务开始，也可以新建一个完全独立的话题。</p><div class="suggestions"><button type="button" data-suggestion="帮我梳理一下当前任务，给出最重要的下一步"><span>${icon("context")}</span><b>梳理当前任务</b><small>结合已授权的桌面上下文</small></button><button type="button" data-suggestion="帮我制定一个专注 25 分钟的计划"><span>${icon("message")}</span><b>制定专注计划</b><small>拆成容易开始的小步骤</small></button><button type="button" data-suggestion="我有点卡住了，陪我分析一下"><span>${icon("search")}</span><b>陪我分析问题</b><small>从困惑中找到突破口</small></button></div><p class="empty-privacy">${icon("context")}上下文仅在发送时临时读取，且始终受隐私规则保护</p></div>`;
    } else {
      const loader = this.nextCursor === null ? "" : `<button class="history-loader" type="button" data-load-older>加载更早消息</button>`;
      container.innerHTML = `${loader}${this.messages.map((message) => this.messageHtml(message)).join("")}`;
    }
    if (scrollToEnd) this.scrollToEnd();
  }

  private messageHtml(message: ChatMessage, streaming = false): string {
    const assistant = message.role === "assistant";
    const source = assistant ? `<span class="source ${message.source === "local" ? "local" : "api"}">${message.source === "local" ? "本地回复" : "智能回复"}</span>` : "";
    const content = streaming ? (message.content ? escapeHtml(message.content) : `<span class="typing" aria-label="正在思考"><i></i><i></i><i></i></span>`) : this.markup(message.content);
    const author = assistant ? escapeHtml(this.chatName()) : "你";
    const initial = assistant ? escapeHtml(Array.from(this.chatName())[0] ?? "珊") : "你";
    return `<article class="message ${message.role}${streaming ? " streaming" : ""}" data-message-id="${escapeHtml(message.id ?? "")}" aria-label="${author}的消息"><div class="message-avatar"${assistant ? " data-chat-initial" : ""}>${initial}</div><div class="message-body"><header><b${assistant ? " data-chat-name" : ""}>${author}</b>${source}<time>${this.time(message.createdAt)}</time></header><div class="message-content">${content}</div>${message.error ? `<p class="fallback-reason">${escapeHtml(message.error)} · 已保存在当前对话</p>` : ""}<footer>${message.content && !streaming ? `<button type="button" data-copy-message aria-label="复制${assistant ? "回复" : "我的消息"}">${icon("copy")}<span>复制</span></button>` : ""}</footer></div></article>`;
  }

  private renderStatus(): void {
    const label = this.root.querySelector<HTMLElement>("[data-model-label]");
    const chip = this.root.querySelector<HTMLElement>("[data-show-context]");
    const context = this.root.querySelector<HTMLElement>("[data-context-meta]");
    const quota = this.root.querySelector<HTMLElement>("[data-quota-meta]");
    const banner = this.root.querySelector<HTMLElement>(".local-mode-banner");
    const online = this.status.apiConfigured && this.status.online && this.status.remaining > 0;
    if (label) label.textContent = `${online ? "智能对话" : "本地模式"} · ${this.status.model}`;
    if (chip) {
      chip.innerHTML = `${icon("context")}<span>${this.status.contextEnabled ? this.status.contextBlocked ? "上下文受保护" : "上下文已关联" : "上下文已关闭"}</span>`;
      chip.classList.toggle("is-protected", this.status.contextBlocked);
      chip.classList.toggle("is-off", !this.status.contextEnabled);
    }
    if (context) context.textContent = this.status.contextEnabled ? this.status.contextBlocked ? "当前上下文已保护" : "上下文临时读取" : "上下文已关闭";
    if (quota) quota.textContent = `本月智能额度 ${this.status.used} / ${this.status.limit}`;
    if (banner) {
      banner.hidden = online;
      banner.textContent = !this.status.apiConfigured ? "尚未配置 API，当前使用本地回复；对话记录仍会正常保存。" : !this.status.online ? "当前离线，已自动切换为本地回复。" : "本月智能调用额度已用完，已自动切换为本地回复。";
    }
  }

  private async createTopic(): Promise<void> {
    if (this.creatingTopic) return;
    this.creatingTopic = true;
    const button = this.root.querySelector<HTMLButtonElement>(".new-topic");
    if (button) { button.disabled = true; button.setAttribute("aria-busy", "true"); }
    this.saveDraft();
    try {
      const session = await window.petAPI.chat.create();
      this.sessions.unshift(this.summary(session));
      this.activeId = session.id;
      this.messages = [];
      this.nextCursor = null;
      this.renderTopics();
      this.renderMessages(true);
      this.restoreDraft();
      this.toggleSidebar(false);
      this.textarea().focus();
    } catch {
      this.showToast("新对话创建失败，请重试", "error");
    } finally {
      this.creatingTopic = false;
      if (button) { button.disabled = false; button.removeAttribute("aria-busy"); }
    }
  }

  private async selectTopic(id: string): Promise<void> {
    if (id === this.activeId) { this.toggleSidebar(false); return; }
    if (this.streaming) { this.showToast("请先停止当前回复，再切换对话"); return; }
    this.saveDraft();
    this.activeId = id;
    this.messages = [];
    this.nextCursor = null;
    this.toggleSidebar(false);
    this.renderTopics();
    this.root.querySelector<HTMLElement>(".messages")!.innerHTML = `<div class="context-loading">正在加载最近消息…</div>`;
    try { await this.loadActiveMessages(); }
    catch { this.showToast("对话加载失败，请重试", "error"); }
  }

  private async renameTopic(id: string): Promise<void> {
    const session = this.sessions.find((item) => item.id === id);
    const dialog = this.root.querySelector<HTMLDialogElement>(".rename-dialog")!;
    const input = dialog.querySelector<HTMLInputElement>("input")!;
    input.value = session?.title ?? "";
    const confirmed = await new Promise<boolean>((resolve) => { dialog.addEventListener("close", () => resolve(dialog.returnValue === "save"), { once: true }); dialog.showModal(); input.focus(); input.select(); });
    const title = input.value.trim();
    if (!confirmed || !title || title === session?.title) return;
    try {
      await window.petAPI.chat.rename(id, title);
      await this.refreshSessions(id);
      this.showToast("对话名称已更新", "success");
    } catch { this.showToast("重命名失败，请重试", "error"); }
  }

  private async deleteTopic(id: string): Promise<void> {
    const session = this.sessions.find((item) => item.id === id);
    const dialog = this.root.querySelector<HTMLDialogElement>(".delete-dialog")!;
    dialog.querySelector<HTMLElement>("[data-delete-name]")!.textContent = session?.title ?? "新对话";
    const confirmed = await new Promise<boolean>((resolve) => { dialog.addEventListener("close", () => resolve(dialog.returnValue === "delete"), { once: true }); dialog.showModal(); });
    if (!confirmed) return;
    const wasActive = id === this.activeId;
    if (this.streaming?.sessionId === id) await this.stop();
    try {
      await window.petAPI.chat.delete(id);
      this.drafts.delete(id);
      await this.refreshSessions();
      if (!this.sessions.length) await this.createTopic();
      else if (wasActive) await this.loadActiveMessages();
      this.showToast("对话已删除", "success");
    } catch { this.showToast("删除失败，请重试", "error"); }
  }

  private async send(): Promise<void> {
    if (this.streaming) return;
    const textarea = this.textarea();
    const text = textarea.value.trim();
    if (!text) { textarea.focus(); return; }
    if (!this.activeId) await this.createTopic();
    if (!this.activeId) return;
    const user: ChatMessage = { id: crypto.randomUUID(), role: "user", content: text, createdAt: Date.now() };
    this.messages.push(user);
    this.streaming = { sessionId: this.activeId, requestId: "pending", text: "", source: "api", userId: user.id! };
    textarea.value = "";
    this.drafts.delete(this.activeId);
    this.resizeComposer();
    this.setGenerating(true);
    this.appendOutgoingNodes(user);
    try { this.streaming.requestId = await window.petAPI.chat.send(this.activeId, text); }
    catch (error) {
      this.messages = this.messages.filter((message) => message.id !== user.id);
      this.root.querySelector(`[data-message-id="${CSS.escape(user.id!)}"]`)?.remove();
      this.root.querySelector(".streaming")?.remove();
      this.streaming = null;
      textarea.value = text;
      this.saveDraft();
      this.resizeComposer();
      this.setGenerating(false);
      this.showToast(error instanceof Error ? error.message : "消息发送失败", "error");
      textarea.focus();
    }
  }

  private appendOutgoingNodes(user: ChatMessage): void {
    const container = this.root.querySelector<HTMLElement>(".messages")!;
    container.querySelector(".empty-chat")?.remove();
    const stream: ChatMessage = { id: "streaming", role: "assistant", content: "", createdAt: Date.now(), source: "api" };
    container.insertAdjacentHTML("beforeend", `${this.messageHtml(user)}${this.messageHtml(stream, true)}`);
    this.scrollToEnd();
  }

  private handleChunk(chunk: ChatChunk): void {
    if (!this.streaming || this.streaming.sessionId !== chunk.sessionId) return;
    if (this.streaming.requestId !== "pending" && this.streaming.requestId !== chunk.requestId) return;
    this.streaming.requestId = chunk.requestId;
    this.streaming.text += chunk.text;
    this.streaming.source = chunk.source;
    if (chunk.error) this.streaming.error = chunk.error;
    if (chunk.done) { void this.finishStream(chunk); return; }
    this.updateStreamingNode();
  }

  private async finishStream(chunk: ChatChunk): Promise<void> {
    const stream = this.streaming;
    if (!stream) return;
    const assistant: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: stream.text || "这次没有生成有效回复，请重新试一次。", createdAt: Date.now(), source: stream.source, ...(stream.error ? { error: stream.error } : {}) };
    if (stream.sessionId === this.activeId) {
      const node = this.root.querySelector(".streaming");
      if (node) node.outerHTML = this.messageHtml(assistant);
      this.messages.push(assistant);
      if (this.nextCursor !== null) this.nextCursor += 2;
    }
    this.streaming = null;
    this.setGenerating(false);
    await Promise.all([this.refreshSessions(chunk.sessionId), this.refreshStatus()]);
    this.updateJumpButton();
    this.textarea().focus();
  }

  private updateStreamingNode(): void {
    const node = this.root.querySelector<HTMLElement>(".streaming .message-content");
    if (!node || !this.streaming) return;
    const nearBottom = this.isNearBottom();
    node.textContent = this.streaming.text;
    const source = this.root.querySelector<HTMLElement>(".streaming .source");
    if (source) { source.textContent = this.streaming.source === "local" ? "本地回复" : "智能回复"; source.className = `source ${this.streaming.source}`; }
    if (nearBottom) this.scrollToEnd();
    else this.updateJumpButton();
  }

  private async stop(): Promise<void> {
    const requestId = this.streaming?.requestId;
    if (!requestId || requestId === "pending") { this.showToast("正在连接智能体，请稍候"); return; }
    try { await window.petAPI.chat.cancel(requestId); this.showToast("正在停止生成…"); }
    catch { this.showToast("暂时无法停止，请稍后重试", "error"); }
  }

  private async refreshSessions(preferredId = this.activeId): Promise<void> {
    this.sessions = await window.petAPI.chat.list();
    if (!this.sessions.some((item) => item.id === this.activeId)) this.activeId = this.sessions.find((item) => item.id === preferredId)?.id ?? this.sessions[0]?.id ?? "";
    this.renderTopics();
    const heading = this.root.querySelector<HTMLElement>("[data-chat-title]");
    if (heading) heading.textContent = this.activeSession()?.title ?? "新对话";
  }

  private async refreshStatus(): Promise<void> { this.status = await window.petAPI.chat.status(); this.renderStatus(); }

  private async showContext(): Promise<void> {
    const drawer = this.root.querySelector<HTMLDialogElement>(".context-drawer")!;
    const content = drawer.querySelector<HTMLElement>(".context-content")!;
    if (!drawer.open) drawer.showModal();
    this.root.querySelector<HTMLElement>("[data-show-context]")?.setAttribute("aria-expanded", "true");
    drawer.querySelector<HTMLButtonElement>("[data-close-context]")?.focus();
    if (!this.status.contextEnabled) { content.innerHTML = `<div class="context-empty"><b>自动上下文已关闭</b><p>可在“智能体 API → 对话与问候”中开启，并继续受感知页权限控制。</p></div>`; return; }
    content.innerHTML = `<div class="context-loading">正在读取并脱敏…</div>`;
    try { content.innerHTML = this.contextHtml(await window.petAPI.chat.contextPreview()); }
    catch { content.innerHTML = `<div class="context-empty"><b>暂时无法读取上下文</b><p>请稍后重试，或在控制台检查感知权限。</p></div>`; }
  }

  private hideContext(): void { const drawer = this.root.querySelector<HTMLDialogElement>(".context-drawer")!; if (drawer.open) drawer.close(); }

  private contextHtml(context: ContentContext): string {
    if (context.blocked) return `<div class="context-empty protected"><b>当前上下文已受保护</b><p>当前应用命中黑名单、隐私模式或感知已关闭，内容不会发送给智能体。</p></div>`;
    const rows: Array<[string, string]> = [["应用", context.application || "未读取"], ["类型", context.category], ["窗口", context.windowTitle || "未读取"], ["文档", context.documentTitle || "未读取"], ["选中文本", context.selectedText || "无"], ["剪贴板", context.clipboardText || "无"], ["脱敏", `${context.redactions} 处`]];
    return `<div class="context-security">${icon("context")}<span><b>仅用于下一次智能请求</b><small>敏感内容会在发送前自动脱敏</small></span></div><dl>${rows.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl><p class="context-note">这些信息不会写入聊天历史，可随时在控制台关闭感知。</p>`;
  }

  private requestApproval(call: AgentToolCall): void {
    const dialog = this.root.querySelector<HTMLDialogElement>(".approval-dialog")!;
    dialog.querySelector<HTMLElement>("[data-approval-copy]")!.textContent = `“${this.status.petName}”请求执行 ${call.name}`;
    dialog.querySelector<HTMLElement>("[data-approval-detail]")!.textContent = JSON.stringify(call.arguments, null, 2);
    dialog.addEventListener("close", () => void window.petAPI.agentApproval.resolve(call.id, dialog.returnValue === "allow"), { once: true });
    dialog.showModal();
  }

  private handleViewportScroll(): void {
    if (this.viewport().scrollTop < 48) void this.loadOlder();
    this.updateJumpButton();
  }

  private updateJumpButton(): void {
    const button = this.root.querySelector<HTMLButtonElement>("[data-jump-latest]");
    if (button) button.hidden = this.isNearBottom() || !this.messages.length;
  }

  private handleKeyboard(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      const input = this.root.querySelector<HTMLInputElement>(".topic-search input");
      input?.focus(); input?.select();
      if (window.innerWidth <= 920) this.toggleSidebar(true);
      return;
    }
    if (event.key === "Escape") {
      const drawer = this.root.querySelector<HTMLDialogElement>(".context-drawer");
      if (drawer?.open) { event.preventDefault(); this.hideContext(); return; }
      this.toggleSidebar(false);
    }
  }

  private toggleSidebar(force?: boolean): void {
    const shell = this.root.querySelector<HTMLElement>(".chat-shell");
    const menu = this.root.querySelector<HTMLElement>(".mobile-menu");
    const scrim = this.root.querySelector<HTMLButtonElement>(".sidebar-scrim");
    if (!shell || !menu || !scrim) return;
    const open = force ?? !shell.classList.contains("sidebar-open");
    shell.classList.toggle("sidebar-open", open);
    menu.setAttribute("aria-expanded", String(open));
    scrim.hidden = !open;
  }

  private saveDraft(): void {
    if (!this.activeId) return;
    const value = this.textarea().value;
    if (value) this.drafts.set(this.activeId, value); else this.drafts.delete(this.activeId);
  }

  private restoreDraft(): void {
    const textarea = this.textarea();
    textarea.value = this.drafts.get(this.activeId) ?? "";
    this.resizeComposer();
    this.updateComposerState();
  }

  private updateComposerState(): void {
    const textarea = this.textarea();
    const count = this.root.querySelector<HTMLElement>("[data-character-count]");
    const send = this.root.querySelector<HTMLButtonElement>(".send-button");
    if (count) { count.textContent = `${textarea.value.length} / ${textarea.maxLength}`; count.classList.toggle("near-limit", textarea.value.length > textarea.maxLength * .9); }
    if (send) send.disabled = Boolean(this.streaming) || !textarea.value.trim();
  }

  private showToast(message: string, tone: "neutral" | "success" | "error" = "neutral"): void {
    const toast = this.root.querySelector<HTMLElement>("[data-toast]");
    if (!toast) return;
    window.clearTimeout(this.toastTimer);
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.hidden = false;
    this.toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2200);
  }

  private summary(session: ChatSession): ChatSessionSummary { return { id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt, messageCount: session.messages.length, lastMessagePreview: session.messages.at(-1)?.content.slice(0, 80) ?? "" }; }
  private activeSession(): ChatSessionSummary | undefined { return this.sessions.find((session) => session.id === this.activeId); }
  private chatName(): string { return this.settings.petName?.trim() || this.status.petName || "珊珊"; }
  private syncBranding(): void {
    const name = this.chatName();
    const initial = Array.from(name)[0] ?? "珊";
    document.title = `和${name}聊天`;
    void window.petAPI.chat.syncTitle(name);
    this.root.querySelectorAll<HTMLElement>("[data-chat-name]").forEach((element) => { element.textContent = name; });
    this.root.querySelectorAll<HTMLElement>("[data-chat-initial]").forEach((element) => { element.textContent = initial; });
    const composer = this.root.querySelector<HTMLTextAreaElement>("[data-chat-composer]");
    if (composer) { composer.placeholder = `给${name}发消息…`; composer.setAttribute("aria-label", `给${name}发送消息`); }
  }
  private applyTheme(): void { const shell = this.root.querySelector<HTMLElement>(".chat-shell"); if (!shell) return; shell.classList.remove("theme-cream", "theme-dark", "theme-system"); shell.classList.add(`theme-${this.settings.appearance.theme}`); shell.style.setProperty("--accent", safeAccent(this.settings.appearance.accentColor)); }
  private setOlderLoading(loading: boolean): void { const loader = this.root.querySelector<HTMLButtonElement>("[data-load-older]"); if (!loader) return; loader.disabled = loading; loader.textContent = loading ? "正在加载…" : this.nextCursor === null ? "" : "加载更早消息"; if (this.nextCursor === null) loader.remove(); }
  private setGenerating(value: boolean): void {
    this.root.querySelector<HTMLButtonElement>(".send-button")!.hidden = value;
    this.root.querySelector<HTMLButtonElement>(".stop-button")!.hidden = !value;
    this.textarea().disabled = value;
    this.root.querySelector<HTMLElement>(".composer")?.setAttribute("aria-busy", String(value));
    const status = this.root.querySelector<HTMLElement>("[data-compose-status]");
    if (status) status.textContent = value ? "正在生成，可随时停止" : "Enter 发送 · Shift+Enter 换行";
    const presence = this.root.querySelector<HTMLElement>("[data-chat-presence]");
    if (presence) { presence.classList.toggle("is-working", value); presence.innerHTML = `<i></i>${value ? "思考中" : "在线"}`; }
    this.updateComposerState();
  }
  private resizeComposer(): void { const area = this.textarea(); area.style.height = "auto"; area.style.height = `${Math.min(180, Math.max(28, area.scrollHeight))}px`; }
  private textarea(): HTMLTextAreaElement { return this.root.querySelector<HTMLTextAreaElement>(".composer textarea")!; }
  private viewport(): HTMLElement { return this.root.querySelector<HTMLElement>(".message-viewport")!; }
  private isNearBottom(): boolean { const view = this.viewport(); return view.scrollHeight - view.scrollTop - view.clientHeight < 88; }
  private scrollToEnd(): void { window.requestAnimationFrame(() => { const view = this.viewport(); view.scrollTop = view.scrollHeight; this.updateJumpButton(); }); }
  private time(value: number): string { return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }); }
  private relativeTime(value: number): string { const delta = Date.now() - value; if (delta < 60_000) return "刚刚"; if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`; if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`; return new Date(value).toLocaleDateString("zh-CN", { month: "short", day: "numeric" }); }

  private markup(value: string): string {
    const parts = escapeHtml(value).split(/```/);
    return parts.map((part, index) => index % 2 ? `<pre><code>${part.replace(/^\w+\n/, "")}</code></pre>` : this.proseMarkup(part)).join("");
  }

  private proseMarkup(value: string): string {
    const lines = value.split("\n");
    const output: string[] = [];
    let paragraph: string[] = [];
    let listType: "ul" | "ol" | null = null;
    let listItems: string[] = [];
    const inline = (line: string) => line.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const flushParagraph = () => { if (paragraph.length) output.push(`<p>${paragraph.map(inline).join("<br>")}</p>`); paragraph = []; };
    const flushList = () => { if (listType && listItems.length) output.push(`<${listType}>${listItems.map((item) => `<li>${inline(item)}</li>`).join("")}</${listType}>`); listType = null; listItems = []; };
    for (const line of lines) {
      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      const heading = line.match(/^\s*(#{1,3})\s+(.+)$/);
      const quote = line.match(/^\s*&gt;\s?(.+)$/);
      if (bullet || ordered) {
        flushParagraph();
        const nextType = bullet ? "ul" : "ol";
        if (listType && listType !== nextType) flushList();
        listType = nextType;
        listItems.push((bullet?.[1] ?? ordered?.[1])!);
      } else if (heading) {
        flushParagraph(); flushList();
        const level = (heading[1] ?? "#").length + 2;
        output.push(`<h${level}>${inline(heading[2] ?? "")}</h${level}>`);
      } else if (quote) {
        flushParagraph(); flushList();
        output.push(`<blockquote>${inline(quote[1] ?? "")}</blockquote>`);
      } else if (!line.trim()) {
        flushParagraph(); flushList();
      } else {
        flushList(); paragraph.push(line);
      }
    }
    flushParagraph(); flushList();
    return output.join("");
  }

  private async copyMessage(button: HTMLButtonElement): Promise<void> {
    const id = button.closest<HTMLElement>("[data-message-id]")?.dataset.messageId;
    const message = this.messages.find((item) => item.id === id);
    if (!message) return;
    try { await navigator.clipboard.writeText(message.content); this.showToast("消息已复制", "success"); }
    catch { this.showToast("复制失败，请手动选择文本", "error"); }
  }
}

void new ChatApp().mount();
