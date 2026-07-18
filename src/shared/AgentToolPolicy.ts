import type { AgentToolCall } from "../types.js";

type ToolName = AgentToolCall["name"];
type ArgumentType = "string" | "number" | "boolean";
interface Rule { risk: "safe" | "confirm"; required: Record<string, ArgumentType>; optional?: Record<string, ArgumentType>; }

export const TOOL_RULES: Record<ToolName, Rule> = {
  get_activity_summary: { risk: "safe", required: {} },
  create_reminder: { risk: "safe", required: { title: "string", minutes: "number" } },
  complete_reminder: { risk: "safe", required: { id: "string" } },
  snooze_reminder: { risk: "safe", required: { id: "string", minutes: "number" } },
  focus_timer: { risk: "safe", required: { command: "string" } },
  set_pet_action: { risk: "safe", required: { action: "string" } },
  show_notification: { risk: "safe", required: { title: "string", body: "string" } },
  open_console: { risk: "safe", required: {} },
  open_url: { risk: "confirm", required: { url: "string" } },
  launch_app: { risk: "confirm", required: { app: "string" }, optional: { expression: "string" } },
  read_current_context: { risk: "confirm", required: {} }
};

const toolDescriptions: Partial<Record<ToolName, string>> = {
  open_url: "在独立的临时浏览器窗口中打开 HTTP/HTTPS 网页，读取页面可见文本后自动关闭窗口并返回。天气、新闻、搜索等实时信息应在每次新查询时调用。",
  launch_app: "启动安全白名单中的 Windows 应用。支持：记事本、计算器、画图、文件资源管理器、Windows 设置。启动计算器时，如用户给出了算式，必须同时传 expression，让计算器输入并计算该算式。",
  read_current_context: "读取一次经过隐私规则过滤和脱敏的临时桌面上下文。"
};

// Do not advertise controls that do not yet have durable execution semantics.
// Returning { ok: true } for these commands previously made the model claim
// completion even though no focus/reminder state changed.
const implementedTools = new Set<ToolName>([
  "get_activity_summary", "create_reminder", "set_pet_action", "show_notification",
  "open_console", "open_url", "launch_app", "read_current_context"
]);

export const TOOL_DEFINITIONS = Object.entries(TOOL_RULES).filter(([name]) => implementedTools.has(name as ToolName)).map(([name, rule]) => ({
  type: "function",
  function: {
    name,
    description: toolDescriptions[name as ToolName] ?? `桌面伙伴工具（${rule.risk === "confirm" ? "执行前需要用户确认" : "安全本地操作"}）`,
    parameters: {
      type: "object",
      properties: Object.fromEntries(Object.entries({ ...rule.required, ...rule.optional }).map(([key, type]) => [key, { type }])),
      required: Object.keys(rule.required),
      additionalProperties: false
    }
  }
}));

export function validateToolCall(name: string, argumentsValue: unknown): AgentToolCall {
  if (!(name in TOOL_RULES)) throw new Error(`不允许的工具：${name}`);
  if (!argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) throw new Error("工具参数必须是对象");
  const toolName = name as ToolName;
  const rule = TOOL_RULES[toolName]!;
  const args = argumentsValue as Record<string, unknown>;
  const supported = { ...rule.required, ...rule.optional };
  for (const key of Object.keys(args)) if (!(key in supported)) throw new Error(`工具参数未登记：${key}`);
  for (const [key, type] of Object.entries(rule.required)) if (typeof args[key] !== type) throw new Error(`工具参数 ${key} 必须为 ${type}`);
  for (const [key, type] of Object.entries(rule.optional ?? {})) if (key in args && typeof args[key] !== type) throw new Error(`工具参数 ${key} 必须为 ${type}`);
  return { id: crypto.randomUUID(), name: toolName, arguments: args, risk: rule.risk };
}
