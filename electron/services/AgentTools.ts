import { BrowserWindow, shell, type WebContents } from "electron";
import { execFile, spawn } from "node:child_process";
import type { AgentToolCall, ActivitySnapshot, ChatActionCard, ChatActionResult, ContentContext, PlanTask, WellbeingSnapshot } from "../../src/types.js";
import { validateToolCall } from "../../src/shared/AgentToolPolicy.js";
import { accentPaletteForPreference } from "../../src/shared/accent-palette.js";

export class AgentTools {
  private static readonly ACTION_CARD_TTL_MS = 10 * 60_000;
  private approvals = new Map<string, { resolve: (approved: boolean) => void; senderId: number; conversationId: string }>();
  private conversationApprovals = new Map<number, Map<string, Set<AgentToolCall["name"]>>>();
  constructor(private callbacks: {
    getActivity: () => ActivitySnapshot;
    getContext: () => ContentContext | Promise<ContentContext>;
    getSystemSummary?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
    getWellbeing?: () => WellbeingSnapshot;
    checkUpdates?: () => Promise<unknown>;
    findPlans?: (query: string) => unknown;
    getPetName: () => string;
    getToolPermission?: (name: AgentToolCall["name"]) => "ask" | "allow" | "deny";
    setAction: (action: string) => boolean;
    setAccent?: (color: string) => Promise<boolean>;
    setScale?: (scale: number) => Promise<boolean>;
    createPlan?: (input: Partial<PlanTask>) => Promise<boolean>;
    updateChatActionCard?: (conversationId: string, card: ChatActionCard) => Promise<void>;
    updateAction?: (action: string) => Promise<{ ok: boolean; message: string }>;
    openConsole: () => Promise<void>;
    showNotification: (title: string, body: string) => void;
  }) {}

  resolve(id: string, approved: boolean, allowConversation = false, conversationId = ""): void {
    const pending = this.approvals.get(id);
    if (pending && approved && allowConversation && pending.conversationId && pending.conversationId === conversationId) {
      const byConversation = this.conversationApprovals.get(pending.senderId) ?? new Map<string, Set<AgentToolCall["name"]>>();
      const allowed = byConversation.get(conversationId) ?? new Set<AgentToolCall["name"]>();
      const call = this.pendingCalls.get(id);
      if (call) allowed.add(call.name);
      byConversation.set(conversationId, allowed);
      this.conversationApprovals.set(pending.senderId, byConversation);
    }
    pending?.resolve(approved);
    this.approvals.delete(id);
    this.pendingCalls.delete(id);
  }

  private pendingCalls = new Map<string, AgentToolCall>();
  private actionCards = new Map<string, { card: ChatActionCard; senderId: number; conversationId: string }>();
  private conversationBySender = new Map<number, string>();

  clearConversationApprovals(sender: WebContents): void { this.conversationApprovals.delete(sender.id); }

  private expireActionCard(id: string): void {
    const item = this.actionCards.get(id);
    if (!item || item.card.status !== "pending") return;
    item.card.status = "stale";
    item.card.result = "长时间未处理，这项建议已自动失效。需要时请让智能体重新生成。";
    item.card.revision = Date.now();
    if (item.conversationId) void this.callbacks.updateChatActionCard?.(item.conversationId, item.card);
  }

  private propose(sender: WebContents, type: ChatActionCard["type"], title: string, description: string, payload: Record<string, unknown>, actions: ChatActionCard["actions"], conversationId?: string): string {
    const resolvedConversationId = conversationId ?? this.conversationBySender.get(sender.id);
    const key = JSON.stringify(payload);
    const existing = [...this.actionCards.values()].find((item) => item.senderId === sender.id && item.conversationId === (resolvedConversationId ?? "") && item.card.type === type && item.card.status === "pending" && JSON.stringify(item.card.payload) === key);
    if (existing) return JSON.stringify({ ok: true, cardId: existing.card.id, message: "同一条建议已经在当前对话中，等待你的确认" });
    // Keep one actionable proposal of each kind per conversation. A revised
    // proposal supersedes the previous one instead of stacking duplicate cards.
    for (const item of this.actionCards.values()) {
      if (item.senderId !== sender.id || item.conversationId !== (resolvedConversationId ?? "") || item.card.type !== type || item.card.status !== "pending") continue;
      item.card.status = "stale";
      item.card.result = "已由更新后的建议替代，请使用下方最新卡片。";
      item.card.revision = Date.now();
      if (item.conversationId) void this.callbacks.updateChatActionCard?.(item.conversationId, item.card);
      sender.send("chat:action-result", structuredClone(item.card));
    }
    const resolvedActions = actions.some((action) => action.id === "cancel") ? actions : [...actions, { id: "cancel", label: "取消本次操作", style: "quiet" as const }];
    const card: ChatActionCard = { id: crypto.randomUUID(), conversationId: resolvedConversationId, type, revision: Date.now(), title, description, payload, actions: resolvedActions, status: "pending", createdAt: Date.now() };
    this.actionCards.set(card.id, { card, senderId: sender.id, conversationId: resolvedConversationId ?? "" });
    sender.send("chat:action-card", card);
    setTimeout(() => {
      const item = this.actionCards.get(card.id);
      if (!item || item.card.status !== "pending") return;
      this.expireActionCard(card.id);
      sender.send("chat:action-result", structuredClone(item.card));
    }, AgentTools.ACTION_CARD_TTL_MS);
    return JSON.stringify({ ok: true, cardId: card.id, message: "已生成可点击建议卡片，等待用户确认" });
  }

  actionCard(id: string, sender: WebContents): ChatActionCard | null {
    const item = this.actionCards.get(id);
    return item?.senderId === sender.id ? structuredClone(item.card) : null;
  }

  async executeActionCard(id: string, action: string, sender: WebContents): Promise<ChatActionResult> {
    const pending = this.actionCards.get(id);
    if (!pending || pending.senderId !== sender.id) return { ok: false, status: "stale", message: "该建议已失效，请让智能体重新生成" };
    const card = pending.card;
    if (card.status !== "pending") return { ok: false, status: card.status, message: card.result || "这条建议已经处理过了" };
    let result: { ok: boolean; message: string } = { ok: false, message: "不支持的建议操作" };
    if (action === "cancel") {
      card.status = "cancelled";
      card.result = "已取消，没有更改任何设置或计划";
      result = { ok: true, message: card.result };
    } else if (card.type === "accent-colors" && action.startsWith("apply:")) {
      const color = action.slice(6).toLowerCase(); const colors = Array.isArray(card.payload.colors) ? card.payload.colors.map(String) : [];
      result = /^#[0-9a-f]{6}$/.test(color) && colors.includes(color) && this.callbacks.setAccent ? { ok: await this.callbacks.setAccent(color), message: "强调色已实时应用" } : { ok: false, message: "颜色建议已失效" };
    } else if (card.type === "pet-scale" && action === "apply") {
      const scale = Number(card.payload.scale); result = Number.isFinite(scale) && scale >= .6 && scale <= 1.5 && this.callbacks.setScale ? { ok: await this.callbacks.setScale(scale), message: "桌宠尺寸已实时调整" } : { ok: false, message: "尺寸建议已失效" };
    } else if (card.type === "plan" && action === "create") {
      result = card.type === "plan" && this.callbacks.createPlan ? { ok: await this.callbacks.createPlan(card.payload as Partial<PlanTask>), message: "计划已创建" } : { ok: false, message: "计划服务暂不可用" };
    } else if (card.type === "update" && this.callbacks.updateAction) result = await this.callbacks.updateAction(action);
    else if (card.type === "shortcut" && action === "open") { await this.callbacks.openConsole(); result = { ok: true, message: "已打开对应页面" }; }
    if (action !== "cancel") card.status = result.ok ? "executed" : "failed";
    card.result = result.message;
    card.revision = Date.now();
    if (pending.conversationId) await this.callbacks.updateChatActionCard?.(pending.conversationId, card);
    sender.send("chat:action-result", card);
    return { ok: result.ok, status: card.status, message: result.message };
  }

  private isConversationAllowed(sender: WebContents, conversationId: string | undefined, name: AgentToolCall["name"]): boolean {
    return Boolean(conversationId && this.conversationApprovals.get(sender.id)?.get(conversationId)?.has(name));
  }

  private approval(call: AgentToolCall, sender: WebContents, conversationId = ""): Promise<boolean> {
    sender.send("agent:approval-request", call);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.approvals.delete(call.id); this.pendingCalls.delete(call.id); resolve(false); }, 60_000);
      this.pendingCalls.set(call.id, call);
      this.approvals.set(call.id, { senderId: sender.id, conversationId, resolve: (approved) => { clearTimeout(timer); resolve(approved); } });
    });
  }

  private async visibleWebResult(rawUrl: string, sender: WebContents): Promise<string> {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) return JSON.stringify({ ok: false, error: "仅允许 HTTP/HTTPS" });
    const toolWindow = new BrowserWindow({
      width: 1040,
      height: 720,
      minWidth: 760,
      minHeight: 520,
      show: false,
      title: "临时浏览器 · 正在查询",
      // This must be a real top-level window: it is intentionally not parented to
      // the chat window, so it behaves like a separate temporary browser.
      modal: false,
      backgroundColor: "#fbf7f9",
      autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    toolWindow.setMenu(null);
    toolWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    toolWindow.webContents.on("will-navigate", (event, nextUrl) => {
      try { if (!["http:", "https:"].includes(new URL(nextUrl).protocol)) event.preventDefault(); }
      catch { event.preventDefault(); }
    });
    let closedByUser = false;
    let closing = false;
    toolWindow.on("closed", () => { if (!closing) closedByUser = true; });
    toolWindow.once("ready-to-show", () => { if (!toolWindow.isDestroyed()) { toolWindow.show(); toolWindow.focus(); } });
    try {
      await Promise.race([
        toolWindow.loadURL(url.toString()),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("网页加载超时")), 8_000))
      ]);
      if (toolWindow.isDestroyed()) return JSON.stringify({ ok: false, error: "用户关闭了临时浏览器窗口" });
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      const page = await toolWindow.webContents.executeJavaScript(`(() => {
        const root = document.querySelector('main, article, [role="main"]') || document.body;
        return { title: document.title, url: location.href, content: (root?.innerText || document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 12000) };
      })()`, true) as { title?: string; url?: string; content?: string };
      await new Promise((resolve) => setTimeout(resolve, 220));
      if (!toolWindow.isDestroyed()) { closing = true; toolWindow.close(); }
      return JSON.stringify({ ok: true, title: page.title ?? "", url: page.url ?? url.toString(), content: page.content || "网页已打开，但没有可提取的文本内容" });
    } catch (error) {
      if (!toolWindow.isDestroyed()) { closing = true; toolWindow.close(); }
      return JSON.stringify({ ok: false, error: closedByUser ? "用户关闭了临时浏览器窗口" : error instanceof Error ? error.message : "网页执行失败" });
    }
  }

  private evaluateCalculatorExpression(rawExpression: string): number | null {
    const expression = rawExpression.replace(/[×xX]/g, "*").replace(/÷/g, "/").trim().replace(/=$/, "");
    if (!expression || !/^[0-9+\-*/().\s]+$/.test(expression)) return null;
    try {
      const result = Function(`"use strict"; return (${expression});`)();
      return typeof result === "number" && Number.isFinite(result) ? result : null;
    } catch { return null; }
  }

  private async typeCalculatorExpression(expression: string): Promise<boolean> {
    // Windows Calculator is a UWP window: SendKeys can report success while the
    // keystrokes are silently discarded. Invoke its exposed UI Automation buttons
    // instead, so every digit and operator is visibly pressed in the real app.
    const buttonByCharacter: Record<string, string> = {
      "0": "num0Button", "1": "num1Button", "2": "num2Button", "3": "num3Button", "4": "num4Button",
      "5": "num5Button", "6": "num6Button", "7": "num7Button", "8": "num8Button", "9": "num9Button",
      ".": "decimalSeparatorButton", "+": "plusButton", "-": "minusButton", "*": "multiplyButton", "/": "divideButton", "=": "equalButton"
    };
    const characters = `${expression.replace(/[×xX]/g, "*").replace(/÷/g, "/").trim().replace(/=$/, "") }=`.replace(/\s/g, "");
    const buttonIds = [...characters].map((character) => buttonByCharacter[character]);
    if (buttonIds.some((id) => !id)) return false;
    const payload = Buffer.from(JSON.stringify(buttonIds), "utf8").toString("base64");
    const script = [
      "Add-Type -AssemblyName UIAutomationClient",
      "$deadline = (Get-Date).AddSeconds(5)",
      "$process = $null",
      "while ((Get-Date) -lt $deadline) {",
      "  $process = Get-Process -Name Calculator -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
      "  if ($process) { break }; Start-Sleep -Milliseconds 150",
      "}",
      "if (-not $process) { exit 1 }",
      "$window = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)",
      "if ($null -eq $window) { exit 1 }",
      "function Invoke-CalculatorButton([string]$automationId) {",
      "  $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, $automationId)",
      "  $button = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)",
      "  if ($null -eq $button) { throw \"Calculator button not found: $automationId\" }",
      "  $pattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)",
      "  ([System.Windows.Automation.InvokePattern]$pattern).Invoke()",
      "  Start-Sleep -Milliseconds 85",
      "}",
      "Invoke-CalculatorButton 'clearButton'",
      `$buttons = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payload}')) | ConvertFrom-Json`,
      "foreach ($buttonId in $buttons) { Invoke-CalculatorButton ([string]$buttonId) }",
      "Write-Output 'typed'"
    ].join("\n");
    return new Promise((resolve) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], { windowsHide: true }, (error, stdout) => resolve(!error && stdout.trim() === "typed")));
  }

  private async launchKnownApp(rawName: string, rawExpression?: unknown): Promise<string> {
    if (process.platform !== "win32") return JSON.stringify({ ok: false, error: "启动应用目前仅支持 Windows" });
    const name = rawName.trim().toLowerCase().replace(/[\s·_-]+/g, "");
    const aliases: Record<string, { label: string; command?: string; protocol?: string }> = {
      "记事本": { label: "记事本", command: "notepad.exe" }, notepad: { label: "记事本", command: "notepad.exe" },
      "计算器": { label: "计算器", command: "calc.exe" }, calculator: { label: "计算器", command: "calc.exe" }, calc: { label: "计算器", command: "calc.exe" },
      "画图": { label: "画图", command: "mspaint.exe" }, paint: { label: "画图", command: "mspaint.exe" }, mspaint: { label: "画图", command: "mspaint.exe" },
      "文件资源管理器": { label: "文件资源管理器", command: "explorer.exe" }, "资源管理器": { label: "文件资源管理器", command: "explorer.exe" }, explorer: { label: "文件资源管理器", command: "explorer.exe" },
      "系统设置": { label: "Windows 设置", protocol: "ms-settings:" }, "设置": { label: "Windows 设置", protocol: "ms-settings:" }, settings: { label: "Windows 设置", protocol: "ms-settings:" }
    };
    const target = aliases[name];
    if (!target) return JSON.stringify({ ok: false, error: "该应用不在安全白名单中", supported: ["记事本", "计算器", "画图", "文件资源管理器", "Windows 设置"] });
    if (target.protocol) await shell.openExternal(target.protocol);
    else await new Promise<void>((resolve, reject) => {
      const child = spawn(target.command!, [], { detached: true, stdio: "ignore", windowsHide: false });
      child.once("error", reject);
      child.once("spawn", () => { child.unref(); resolve(); });
    });
    const expression = typeof rawExpression === "string" ? rawExpression.trim() : "";
    if (target.label === "计算器" && expression) {
      const result = this.evaluateCalculatorExpression(expression);
      if (result === null) return JSON.stringify({ ok: false, error: "计算器仅支持基础四则运算、数字和括号" });
      const inputted = await this.typeCalculatorExpression(expression);
      if (inputted) await new Promise((resolve) => setTimeout(resolve, 420));
      return JSON.stringify({ ok: true, app: target.label, expression, result, inputted });
    }
    return JSON.stringify({ ok: true, app: target.label });
  }

  private planTimeFromSchedule(raw: unknown): number | null {
    const text = String(raw ?? "").trim();
    const now = new Date();
    const clock = text.match(/(?:上午|下午|今晚|早上)?\s*([01]?\d|2[0-3])\s*[:：点]\s*([0-5]\d)?/);
    const local = new Date(now);
    if (/明天|明日/.test(text)) local.setDate(local.getDate() + 1);
    const absolute = text.match(/(\d{4})\s*[/-年]\s*(\d{1,2})\s*[/-月]\s*(\d{1,2})/);
    if (absolute) local.setFullYear(Number(absolute[1]), Number(absolute[2]) - 1, Number(absolute[3]));
    if (clock) local.setHours(Number(clock[1]), Number(clock[2] ?? 0), 0, 0);
    else if (!/今天|今日|明天|明日/.test(text) && !absolute) return null;
    const timestamp = local.getTime();
    return timestamp > Date.now() ? timestamp : null;
  }

  private proposePlan(sender: WebContents, conversationId: string | undefined, args: Record<string, unknown>): string {
    const schedule = String(args.schedule ?? "").trim();
    const dueAt = this.planTimeFromSchedule(schedule);
    if (!dueAt) return JSON.stringify({ ok: false, error: "计划时间已过去或格式不完整。请提供未来时间，例如“今天 18:30”或“明天 09:00”。" });
    const recurrence = /每月最后/.test(schedule) ? { kind: "monthly-last-day" } : /每月/.test(schedule) ? { kind: "monthly-date", monthDay: new Date(dueAt).getDate() } : /工作日/.test(schedule) ? { kind: "weekly", weekdays: [1, 2, 3, 4, 5, 6] } : /每周/.test(schedule) ? { kind: "weekly", weekdays: [((new Date(dueAt).getDay() + 6) % 7) + 1] } : /每天|每日/.test(schedule) ? { kind: "daily" } : { kind: "once" };
    const time = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(dueAt);
    const title = String(args.title ?? "未命名计划").trim().slice(0, 120) || "未命名计划";
    const notes = String(args.notes ?? "").replace(/\s+/g, " ").trim().slice(0, 2_000);
    const labels = { once: "单次", daily: "每天", weekly: "每周", "monthly-date": "每月", "monthly-last-day": "每月最后一天" } as const;
    const detail = [`内容：${notes || "未填写具体内容"}`, `时间：${time}`, `规则：${labels[recurrence.kind as keyof typeof labels]}`].join("\n");
    return this.propose(sender, "plan", title, detail, { title, startAt: dueAt, dueAt, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, recurrence, notes, reminderOffsets: [0] }, [{ id: "create", label: "确认创建", style: "primary" }], conversationId);
  }

  async execute(name: string, rawArguments: string, sender: WebContents, conversationId?: string): Promise<string> {
    this.conversationBySender.set(sender.id, conversationId ?? "");
    const parsed = rawArguments.trim() ? JSON.parse(rawArguments) : {};
    const call = validateToolCall(name, parsed);
    if (call.risk === "confirm") {
      const permission = this.callbacks.getToolPermission?.(call.name) ?? "ask";
      if (permission === "deny") return JSON.stringify({ ok: false, error: "该工具已在控制台中关闭" });
      if (permission === "ask" && !this.isConversationAllowed(sender, conversationId, call.name) && !(await this.approval(call, sender, conversationId))) return JSON.stringify({ ok: false, error: "用户未授权" });
    }
    const args = call.arguments;
    if (call.name === "propose_plan") return this.proposePlan(sender, conversationId, args);
    switch (call.name) {
      case "get_activity_summary": return JSON.stringify({ ok: true, activity: this.callbacks.getActivity() });
      case "get_system_summary": return JSON.stringify({ ok: true, system: await this.callbacks.getSystemSummary?.() ?? {} });
      case "get_wellbeing": return JSON.stringify({ ok: true, wellbeing: this.callbacks.getWellbeing?.() ?? null });
      case "find_plans": return JSON.stringify({ ok: true, plans: this.callbacks.findPlans?.(String(args.query ?? "")) ?? [] });
      case "check_for_updates": {
        const update = await this.callbacks.checkUpdates?.();
        return this.propose(sender, "update", "检查更新", "已获取当前更新状态；下载和安装仍需你点击确认。", { update }, [{ id: "download", label: "下载最新版", style: "primary" }, { id: "install", label: "安装已验证版本", style: "secondary" }, { id: "open", label: "打开更新页", style: "quiet" }]);
      }
      case "propose_accent_colors": {
        const preference = String(args.preference ?? "").trim();
        const palette = accentPaletteForPreference(preference);
        return this.propose(sender, "accent-colors", `${palette.label}强调色建议`, "这些颜色只会在你点击后应用；取消不会更改当前界面。", { colors: palette.colors, preference }, palette.colors.map((color) => ({ id: `apply:${color}`, label: color, style: "primary" })), conversationId);
      }
      case "propose_pet_scale": {
        const scale = Math.max(.6, Math.min(1.5, Number(args.scale) || 1));
        return this.propose(sender, "pet-scale", "桌宠尺寸建议", `建议调整为 ${Math.round(scale * 100)}%，点击后会立即同步桌面与控制台。`, { scale }, [{ id: "apply", label: `应用 ${Math.round(scale * 100)}%`, style: "primary" }]);
      }
      default: {
        const schedule = String(args.schedule ?? ""); const parsedTime = Date.parse(schedule.replace(/年|月/g, "-").replace(/日/g, ""));
        const dueAt = Number.isFinite(parsedTime) ? parsedTime : Date.now() + 60 * 60_000;
        const recurrence = schedule.includes("每月最后") ? { kind: "monthly-last-day" } : schedule.includes("每月") ? { kind: "monthly-date", monthDay: new Date(dueAt).getDate() } : schedule.includes("工作日") ? { kind: "weekly", weekdays: [1, 2, 3, 4, 5, 6] } : schedule.includes("每周") ? { kind: "weekly", weekdays: [((new Date(dueAt).getDay() + 6) % 7) + 1] } : schedule.includes("每天") ? { kind: "daily" } : { kind: "once" };
        const notes = String(args.notes ?? "").replace(/\s+/g, " ").trim().slice(0, 2_000);
        return this.propose(sender, "plan", String(args.title || "计划草案"), `内容：${notes || "未填写具体内容"}\n时间：${new Date(dueAt).toLocaleString("zh-CN")}\n确认后才会保存到计划中心。`, { title: String(args.title), startAt: dueAt, dueAt, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, recurrence, notes, reminderOffsets: [0] }, [{ id: "create", label: "确认创建", style: "primary" }], conversationId);
      }
      case "read_current_context": return JSON.stringify({ ok: true, context: await this.callbacks.getContext() });
      case "set_pet_action": return JSON.stringify({ ok: this.callbacks.setAction(String(args.action)) });
      case "open_console": await this.callbacks.openConsole(); return JSON.stringify({ ok: true });
      case "show_notification": this.callbacks.showNotification(String(args.title), String(args.body)); return JSON.stringify({ ok: true });
      case "open_url": {
        return this.visibleWebResult(String(args.url), sender);
      }
      case "launch_app": return this.launchKnownApp(String(args.app), args.expression);
      case "create_reminder": return this.propose(sender, "plan", String(args.title || "提醒草案"), `内容：${String(args.notes ?? "到时提醒我处理这件事").trim()}\n时间：${Math.max(0, Math.min(1440, Number(args.minutes)))} 分钟后`, { title: String(args.title), notes: String(args.notes ?? "").trim(), startAt: Date.now() + Math.max(0, Math.min(1440, Number(args.minutes))) * 60_000, dueAt: Date.now() + Math.max(0, Math.min(1440, Number(args.minutes))) * 60_000, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, recurrence: { kind: "once" }, reminderOffsets: [0] }, [{ id: "create", label: "确认创建", style: "primary" }], conversationId);
      case "complete_reminder":
      case "snooze_reminder":
      case "focus_timer": return JSON.stringify({ ok: false, error: "该工具尚未提供可验证的持久执行能力" });
    }
    return JSON.stringify({ ok: false, error: "工具未实现" });
  }
}
