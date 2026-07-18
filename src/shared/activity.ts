import type { ActivityGroup, ActivityKind, ActivitySnapshot, ClassificationSource, PresenceState } from "../types.js";
import { activityKinds } from "../types.js";

export const activityLabels: Record<ActivityKind, string> = {
  designing: "设计中", modeling: "建模中", rendering: "渲染中", "video-editing": "剪辑中",
  developing: "开发中", editing: "编辑中", spreadsheet: "表格处理中", presentation: "演示设计中",
  reading: "阅读中", meeting: "会议中", communicating: "沟通中", browsing: "浏览中",
  searching: "查询中", "ai-chat": "AI 对话中", learning: "学习中", "file-management": "整理文件中",
  watching: "观看中", listening: "听歌中", gaming: "游戏中", other: "其他"
};

export const activityGroups: Array<{ id: ActivityGroup; label: string; kinds: ActivityKind[] }> = [
  { id: "productivity", label: "生产力", kinds: ["designing", "modeling", "rendering", "video-editing", "developing", "editing", "spreadsheet", "presentation", "reading"] },
  { id: "collaboration", label: "沟通", kinds: ["meeting", "communicating"] },
  { id: "browser", label: "浏览器", kinds: ["browsing", "searching", "ai-chat", "learning"] },
  { id: "files", label: "文件", kinds: ["file-management"] },
  { id: "media", label: "媒体", kinds: ["watching", "listening", "gaming"] },
  { id: "other", label: "其他", kinds: ["other"] }
];

export const productiveActivityKinds = new Set<ActivityKind>(activityGroups[0]!.kinds);
export const passiveActivityKinds = new Set<ActivityKind>(["meeting", "reading", "learning", "watching", "listening"]);

export interface ActivityClassification {
  activityKind: ActivityKind;
  activityLabel: string;
  applicationLabel: string;
  classificationSource: ClassificationSource;
  classificationConfidence: number;
  matched: boolean;
}

const appRules: Array<[RegExp, ActivityKind, string]> = [
  [/keyshot/i, "rendering", "KeyShot"], [/(?:vray|v-ray)/i, "rendering", "V-Ray"], [/corona/i, "rendering", "Corona"],
  [/arnold/i, "rendering", "Arnold"], [/(?:^|\W)d5(?:\W|$)/i, "rendering", "D5"], [/lumion/i, "rendering", "Lumion"], [/enscape/i, "rendering", "Enscape"],
  [/(?:3dsmax|3ds max)/i, "modeling", "3ds Max"], [/blender/i, "modeling", "Blender"], [/maya/i, "modeling", "Maya"],
  [/(?:cinema 4d|c4d)/i, "modeling", "C4D"], [/zbrush/i, "modeling", "ZBrush"], [/rhino/i, "modeling", "Rhino"],
  [/sketchup/i, "modeling", "SketchUp"], [/fusion(?:360)?/i, "modeling", "Fusion"], [/solidworks/i, "modeling", "SolidWorks"],
  [/(?:photoshop|photoshop\.exe)/i, "designing", "Photoshop"], [/illustrator/i, "designing", "Illustrator"], [/figma/i, "designing", "Figma"],
  [/affinity/i, "designing", "Affinity"], [/canva/i, "designing", "Canva"], [/indesign/i, "designing", "InDesign"],
  [/(?:premiere|adobe premiere)/i, "video-editing", "Premiere"], [/(?:davinci|resolve)/i, "video-editing", "DaVinci Resolve"], [/(?:capcut|剪映)/i, "video-editing", "剪映"],
  [/(?:^|\W)code(?:\.exe)?(?:\W|$)|visual studio code/i, "developing", "VS Code"], [/codex/i, "developing", "Codex"], [/cursor/i, "developing", "Cursor"],
  [/(?:devenv|visual studio)/i, "developing", "Visual Studio"], [/(?:idea64|intellij|webstorm|pycharm|clion|goland|rider|rustrover|jetbrains)/i, "developing", "JetBrains"],
  [/(?:windowsterminal|powershell|pwsh|cmd\.exe|terminal|wsl)/i, "developing", "终端"],
  [/(?:winword|word\.exe)/i, "editing", "Word"], [/(?:wps.*文字|wps\.exe)/i, "editing", "WPS 文字"], [/notion/i, "editing", "Notion"], [/obsidian/i, "editing", "Obsidian"],
  [/(?:excel|et\.exe|wps.*表格)/i, "spreadsheet", "Excel"], [/(?:powerpnt|wpp\.exe|wps.*演示)/i, "presentation", "PowerPoint"],
  [/(?:acrobat|acrord32)/i, "reading", "Acrobat"], [/foxit/i, "reading", "Foxit"], [/(?:wpspdf|wps.*pdf)/i, "reading", "WPS PDF"],
  [/(?:explorer\.exe|文件资源管理器|windows explorer)/i, "file-management", "资源管理器"],
  [/(?:vlc|potplayer|mpv|iqiyi|youku|tencent video|media player)/i, "watching", "影音播放器"],
  [/(?:spotify|cloudmusic|qqmusic|musicbee|foobar2000|网易云音乐|酷狗|音乐)/i, "listening", "音乐播放器"],
  [/(?:steam|epicgames|battle\.net|wegame|xbox|game)/i, "gaming", "游戏"],
  [/(?:ms-teams|teams|zoom|webex)/i, "meeting", "会议软件"],
  [/(?:wechat|weixin|企业微信|feishu|lark|dingtalk|钉钉|slack|discord|telegram|skype|\bqq\b)/i, "communicating", "沟通软件"]
];

const browsers = /(?:msedge|chrome|firefox|brave|opera|vivaldi|browser|iexplore)/i;

function cleanProcessName(value: string): string {
  const safe = String(value || "unknown").replace(/\\/g, "/");
  return (safe.split("/").at(-1) || "unknown").toLowerCase();
}

function fallbackApplicationLabel(processName: string): string {
  const cleaned = cleanProcessName(processName).replace(/\.exe$/i, "").trim();
  if (!cleaned || cleaned === "unknown") return "未知软件";
  return cleaned.slice(0, 1).toUpperCase() + cleaned.slice(1, 40);
}

function browserClassification(processName: string, context: string): [ActivityKind, string] {
  const app = /msedge/i.test(processName) ? "Edge" : /firefox/i.test(processName) ? "Firefox" : /chrome/i.test(processName) ? "Chrome" : "浏览器";
  if (/(?:chatgpt|openai|deepseek|claude|gemini|kimi|豆包|通义|元宝|copilot|perplexity)/i.test(context)) return ["ai-chat", app];
  if (/(?:google|bing|baidu|百度|搜狗|duckduckgo|search|搜索|检索)(?:\W|$)/i.test(context)) return ["searching", app];
  if (/(?:coursera|udemy|慕课|网课|课程|教程|题库|learn|tutorial|developer docs|documentation|mdn)/i.test(context)) return ["learning", app];
  if (/(?:figma|canva|photopea)/i.test(context)) return ["designing", app];
  if (/(?:google docs|office online|notion|飞书文档|腾讯文档|石墨文档|在线文档)/i.test(context)) return ["editing", app];
  if (/(?:\.pdf|pdf|长文|article|文章|read)/i.test(context)) return ["reading", app];
  if (/(?:youtube|bilibili|哔哩哔哩|netflix|iqiyi|爱奇艺|youku|腾讯视频|video)/i.test(context)) return ["watching", app];
  if (/(?:spotify|网易云音乐|qq音乐|酷狗|music|音乐|podcast)/i.test(context)) return ["listening", app];
  return ["browsing", app];
}

export function classifyBuiltin(processName: string, ...contextParts: string[]): ActivityClassification {
  const process = cleanProcessName(processName);
  const context = [process, ...contextParts].join(" ");
  if (browsers.test(process)) {
    const [activityKind, applicationLabel] = browserClassification(process, context);
    return classification(activityKind, applicationLabel, "builtin", 0.9, true);
  }
  for (const [pattern, activityKind, applicationLabel] of appRules) {
    if (pattern.test(context)) return classification(activityKind, applicationLabel, "builtin", 0.96, true);
  }
  return classification("other", fallbackApplicationLabel(process), "fallback", 0, false);
}

export function classification(
  activityKind: ActivityKind,
  applicationLabel: string,
  classificationSource: ClassificationSource,
  classificationConfidence: number,
  matched = true
): ActivityClassification {
  return { activityKind, activityLabel: activityLabels[activityKind], applicationLabel, classificationSource, classificationConfidence, matched };
}

export function isActivityKind(value: unknown): value is ActivityKind {
  return typeof value === "string" && (activityKinds as readonly string[]).includes(value);
}

export function resolvePresence(snapshot: Pick<ActivitySnapshot, "locked" | "idleSeconds" | "meeting" | "fullscreen" | "activityKind">): PresenceState {
  if (snapshot.locked) return "resting";
  if (snapshot.meeting || snapshot.fullscreen) return "active";
  if (snapshot.idleSeconds >= 300) return "resting";
  if (snapshot.idleSeconds < 60) return "active";
  if (passiveActivityKinds.has(snapshot.activityKind)) return "active";
  return "away";
}
