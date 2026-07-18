import { BrowserWindow, shell, type WebContents } from "electron";
import { execFile, spawn } from "node:child_process";
import type { AgentToolCall, ActivitySnapshot, ContentContext } from "../../src/types.js";
import { validateToolCall } from "../../src/shared/AgentToolPolicy.js";

export class AgentTools {
  private approvals = new Map<string, { resolve: (approved: boolean) => void; senderId: number; conversationId: string }>();
  private conversationApprovals = new Map<number, Map<string, Set<AgentToolCall["name"]>>>();
  constructor(private callbacks: {
    getActivity: () => ActivitySnapshot;
    getContext: () => ContentContext | Promise<ContentContext>;
    getPetName: () => string;
    getToolPermission?: (name: AgentToolCall["name"]) => "ask" | "allow" | "deny";
    setAction: (action: string) => boolean;
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

  clearConversationApprovals(sender: WebContents): void { this.conversationApprovals.delete(sender.id); }

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

  async execute(name: string, rawArguments: string, sender: WebContents, conversationId?: string): Promise<string> {
    const parsed = rawArguments.trim() ? JSON.parse(rawArguments) : {};
    const call = validateToolCall(name, parsed);
    if (call.risk === "confirm") {
      const permission = this.callbacks.getToolPermission?.(call.name) ?? "ask";
      if (permission === "deny") return JSON.stringify({ ok: false, error: "该工具已在控制台中关闭" });
      if (permission === "ask" && !this.isConversationAllowed(sender, conversationId, call.name) && !(await this.approval(call, sender, conversationId))) return JSON.stringify({ ok: false, error: "用户未授权" });
    }
    const args = call.arguments;
    switch (call.name) {
      case "get_activity_summary": return JSON.stringify({ ok: true, activity: this.callbacks.getActivity() });
      case "read_current_context": return JSON.stringify({ ok: true, context: await this.callbacks.getContext() });
      case "set_pet_action": return JSON.stringify({ ok: this.callbacks.setAction(String(args.action)) });
      case "open_console": await this.callbacks.openConsole(); return JSON.stringify({ ok: true });
      case "show_notification": this.callbacks.showNotification(String(args.title), String(args.body)); return JSON.stringify({ ok: true });
      case "open_url": {
        return this.visibleWebResult(String(args.url), sender);
      }
      case "launch_app": return this.launchKnownApp(String(args.app), args.expression);
      case "create_reminder": {
        const minutes = Math.max(0, Math.min(1440, Number(args.minutes)));
        setTimeout(() => this.callbacks.showNotification(`${this.callbacks.getPetName()}提醒`, String(args.title)), minutes * 60_000);
        return JSON.stringify({ ok: true, id: crypto.randomUUID() });
      }
      case "complete_reminder":
      case "snooze_reminder":
      case "focus_timer": return JSON.stringify({ ok: false, error: "该工具尚未提供可验证的持久执行能力" });
    }
    return JSON.stringify({ ok: false, error: "工具未实现" });
  }
}
