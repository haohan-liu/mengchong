import type { AppCategory } from "../types.js";

export function categorize(processName: string, ...context: string[]): AppCategory {
  const name = [processName, ...context].join(" ").toLowerCase();
  if (/figma|photoshop|illustrator|afterfx|indesign|lightroom|blender|sketch|affinity|designer|canva/.test(name)) return "design";
  if (/\bcode(?:\.exe)?\b|codex|cursor|devenv|visual studio|idea64|intellij|webstorm|pycharm|clion|goland|rider|rustrover|android studio|eclipse|sublime_text|notepad\+\+|terminal|powershell|pwsh|cmd\.exe|windowsterminal|wsl|github|gitlab|stackoverflow/.test(name)) return "development";
  if (/winword|excel|powerpnt|outlook|onenote|wps|et\.exe|wpp|notion|obsidian|acrobat|foxit|libreoffice|google docs|google sheets|google slides/.test(name)) return "office";
  if (/ms-teams|teams|zoom|wechat|weixin|\bqq\b|slack|discord|dingtalk|feishu|lark|telegram|skype|webex/.test(name)) return "communication";
  if (/steam|epicgames|game|youtube|netflix|spotify|bilibili|vlc|potplayer|music|iqiyi|youku|tencent video/.test(name)) return "entertainment";
  return "other";
}
