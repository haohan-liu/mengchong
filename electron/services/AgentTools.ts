import { Notification, shell, type WebContents } from "electron";
import type { AgentToolCall, ActivitySnapshot, ContentContext } from "../../src/types.js";
import { validateToolCall } from "../../src/shared/AgentToolPolicy.js";

export class AgentTools {
  private approvals = new Map<string, (approved: boolean) => void>();
  constructor(private callbacks: {
    getActivity: () => ActivitySnapshot;
    getContext: () => ContentContext | Promise<ContentContext>;
    getPetName: () => string;
    getToolPermission?: (name: AgentToolCall["name"]) => "ask" | "allow" | "deny";
    setAction: (action: string) => boolean;
    openConsole: () => Promise<void>;
  }) {}

  resolve(id: string, approved: boolean): void {
    this.approvals.get(id)?.(approved);
    this.approvals.delete(id);
  }

  private approval(call: AgentToolCall, sender: WebContents): Promise<boolean> {
    sender.send("agent:approval-request", call);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.approvals.delete(call.id); resolve(false); }, 30_000);
      this.approvals.set(call.id, (approved) => { clearTimeout(timer); resolve(approved); });
    });
  }

  async execute(name: string, rawArguments: string, sender: WebContents): Promise<string> {
    const parsed = rawArguments.trim() ? JSON.parse(rawArguments) : {};
    const call = validateToolCall(name, parsed);
    if (call.name === "launch_app") return JSON.stringify({ ok: false, error: "尚未配置应用白名单" });
    if (call.risk === "confirm") {
      const permission = this.callbacks.getToolPermission?.(call.name) ?? "ask";
      if (permission === "deny") return JSON.stringify({ ok: false, error: "该工具已在控制台中关闭" });
      if (permission === "ask" && !(await this.approval(call, sender))) return JSON.stringify({ ok: false, error: "用户未授权" });
    }
    const args = call.arguments;
    switch (call.name) {
      case "get_activity_summary": return JSON.stringify({ ok: true, activity: this.callbacks.getActivity() });
      case "read_current_context": return JSON.stringify({ ok: true, context: await this.callbacks.getContext() });
      case "set_pet_action": return JSON.stringify({ ok: this.callbacks.setAction(String(args.action)) });
      case "open_console": await this.callbacks.openConsole(); return JSON.stringify({ ok: true });
      case "show_notification": new Notification({ title: String(args.title), body: String(args.body) }).show(); return JSON.stringify({ ok: true });
      case "open_url": {
        const url = new URL(String(args.url));
        if (!['http:', 'https:'].includes(url.protocol)) return JSON.stringify({ ok: false, error: "仅允许 HTTP/HTTPS" });
        await shell.openExternal(url.toString());
        return JSON.stringify({ ok: true });
      }
      case "create_reminder": {
        const minutes = Math.max(0, Math.min(1440, Number(args.minutes)));
        setTimeout(() => new Notification({ title: `${this.callbacks.getPetName()}提醒`, body: String(args.title) }).show(), minutes * 60_000);
        return JSON.stringify({ ok: true, id: crypto.randomUUID() });
      }
      case "complete_reminder":
      case "snooze_reminder":
      case "focus_timer": return JSON.stringify({ ok: false, error: "该工具尚未提供可验证的持久执行能力" });
    }
    return JSON.stringify({ ok: false, error: "工具未实现" });
  }
}
