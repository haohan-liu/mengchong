import { clipboard } from "electron";
import type { ActivitySnapshot, ContentContext, Settings } from "../../src/types.js";
import { redactContent } from "../../src/shared/privacy.js";

export { redactContent } from "../../src/shared/privacy.js";

export function isBlockedContext(snapshot: ActivitySnapshot, settings: Settings): boolean {
  const target = `${snapshot.foregroundProcess} ${snapshot.foregroundPath} ${snapshot.windowTitle}`.toLowerCase();
  if (settings.sensing.allowedApps.some((app) => target.includes(app.toLowerCase()))) return false;
  return settings.sensing.blockedApps.some((app) => target.includes(app.toLowerCase())) || /incognito|inprivate|无痕|隐私浏览|credential|password/.test(target);
}

export function buildContentContext(snapshot: ActivitySnapshot, settings: Settings, selectedText = ""): ContentContext {
  const blocked = !settings.sensing.enabled || isBlockedContext(snapshot, settings);
  const empty = { value: "", count: 0 };
  const title = !blocked && settings.sensing.windowTitle ? redactContent(snapshot.windowTitle) : empty;
  const document = !blocked && settings.sensing.windowTitle ? redactContent(snapshot.documentTitle) : empty;
  const selected = !blocked && settings.sensing.selectedText ? redactContent(selectedText) : empty;
  const clip = !blocked && settings.sensing.clipboard ? redactContent(clipboard.readText()) : empty;
  return {
    application: settings.sensing.foregroundApp ? snapshot.foregroundProcess : "",
    category: snapshot.appCategory,
    windowTitle: title.value,
    documentTitle: document.value,
    selectedText: selected.value,
    clipboardText: selected.value ? "" : clip.value,
    summary: `应用类别=${snapshot.appCategory}; 活跃=${snapshot.activeAppSeconds}s; 输入强度=${snapshot.keyboardCount10s + snapshot.mouseClicks10s}`,
    blocked,
    redactions: title.count + document.count + selected.count + clip.count
  };
}
