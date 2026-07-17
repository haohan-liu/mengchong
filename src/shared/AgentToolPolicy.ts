import type { AgentToolCall } from "../types.js";

type ToolName = AgentToolCall["name"];
interface Rule { risk: "safe" | "confirm"; required: Record<string, "string" | "number" | "boolean">; }

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
  launch_app: { risk: "confirm", required: { app: "string" } },
  read_current_context: { risk: "confirm", required: {} }
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
    description: `Desktop companion tool (${rule.risk === "confirm" ? "requires user confirmation" : "safe local action"})`,
    parameters: {
      type: "object",
      properties: Object.fromEntries(Object.entries(rule.required).map(([key, type]) => [key, { type }])),
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
  for (const key of Object.keys(args)) if (!(key in rule.required)) throw new Error(`工具参数未登记：${key}`);
  for (const [key, type] of Object.entries(rule.required)) if (typeof args[key] !== type) throw new Error(`工具参数 ${key} 必须为 ${type}`);
  return { id: crypto.randomUUID(), name: toolName, arguments: args, risk: rule.risk };
}
