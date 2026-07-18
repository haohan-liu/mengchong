import type { ActivityKind, ActivitySnapshot, Settings } from "../../src/types.js";
import type { ActivityClassification } from "../../src/shared/activity.js";
import { classification, classifyBuiltin, isActivityKind, resolvePresence } from "../../src/shared/activity.js";
import type { DataStore } from "./DataStore.js";
import type { SettingsStore } from "./SettingsStore.js";
import { ActivityRuleStore, normalizeProcessName } from "./ActivityRuleStore.js";

interface AiResult { applicationLabel?: unknown; activityKind?: unknown; titleKeywords?: unknown; confidence?: unknown; }

export class ActivityClassifier {
  private stableKey = "";
  private stableSince = 0;
  private timer: NodeJS.Timeout | null = null;
  private controller: AbortController | null = null;
  private lastAiCallAt = 0;
  private lastResolved = new Map<string, ActivityClassification>();
  private apiConfigured = false;

  constructor(
    private settingsStore: SettingsStore,
    private dataStore: DataStore,
    readonly rules: ActivityRuleStore,
    private onResolved: (snapshot: ActivitySnapshot) => void
  ) {}

  async initialize(): Promise<void> { this.apiConfigured = await this.settingsStore.hasApiKey(); }
  setApiConfigured(value: boolean): void { this.apiConfigured = value; }

  classify(snapshot: ActivitySnapshot): ActivitySnapshot {
    const settings = this.settingsStore.get();
    const title = `${snapshot.windowTitle} ${snapshot.documentTitle}`;
    const key = `${normalizeProcessName(snapshot.foregroundProcess)}\0${this.genericTitleKey(title)}`;
    if (key !== this.stableKey) {
      this.cancelPending();
      this.stableKey = key;
      this.stableSince = snapshot.timestamp;
    }

    const manual = this.rules.match(snapshot.foregroundProcess, title, "manual");
    const builtin = classifyBuiltin(snapshot.foregroundProcess, snapshot.foregroundPath, snapshot.windowTitle, snapshot.documentTitle);
    const learned = !manual && !builtin.matched ? this.rules.match(snapshot.foregroundProcess, title, "learned") : null;
    const selected = manual
      ? classification(manual.activityKind, manual.applicationLabel, "manual", 1)
      : builtin.matched ? builtin
      : learned ? classification(learned.activityKind, learned.applicationLabel, "learned", learned.confidence)
      : null;

    const cached = this.lastResolved.get(key);
    const meetingOverride = !manual && snapshot.meeting ? classification("meeting", selected?.applicationLabel ?? builtin.applicationLabel, selected?.classificationSource ?? "builtin", Math.max(.9, selected?.classificationConfidence ?? 0)) : null;
    const result = { ...snapshot, ...(meetingOverride ?? selected ?? cached ?? classification("other", builtin.applicationLabel, "fallback", this.canLearn(settings, snapshot) ? -1 : 0, false)) };
    result.presenceState = resolvePresence(result);
    if (!selected && !cached && result.classificationConfidence < 0) this.schedule(snapshot, key);
    return result;
  }

  cancelPending(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
  }

  async clear(): Promise<void> {
    this.cancelPending();
    this.lastResolved.clear();
    this.stableKey = "";
    this.stableSince = 0;
    await this.rules.clear();
  }

  private canLearn(settings: Settings, snapshot: ActivitySnapshot): boolean {
    const blocked = settings.sensing.blockedApps.some((entry) => `${snapshot.foregroundProcess} ${snapshot.windowTitle}`.toLowerCase().includes(entry.toLowerCase()));
    return settings.firstRunConsent && settings.sensing.enabled && settings.sensing.foregroundApp && settings.sensing.windowTitle
      && settings.sensing.smartActivityLearning && this.apiConfigured && snapshot.online && !blocked;
  }

  private schedule(snapshot: ActivitySnapshot, key: string): void {
    if (this.timer || this.controller) return;
    const wait = Math.max(0, 8_000 - (snapshot.timestamp - this.stableSince));
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.learn(snapshot, key);
    }, wait);
  }

  private async learn(snapshot: ActivitySnapshot, key: string): Promise<void> {
    const settings = this.settingsStore.get();
    if (key !== this.stableKey || !this.canLearn(settings, snapshot) || Date.now() - this.lastAiCallAt < 60_000
      || !this.rules.canUseAiToday() || this.dataStore.getCurrentMonthAiCalls() >= settings.ai.monthlyLimit
      || !(await this.settingsStore.hasApiKey())) {
      this.finishFallback(snapshot, key);
      return;
    }
    const apiKey = await this.settingsStore.getApiKey();
    if (!apiKey) { this.finishFallback(snapshot, key); return; }
    this.controller = new AbortController();
    this.lastAiCallAt = Date.now();
    await this.rules.recordAiCall();
    this.dataStore.increment("aiCalls");
    try {
      const response = await fetch(`${settings.ai.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST", signal: this.controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: settings.ai.model, stream: false, temperature: 0, response_format: { type: "json_object" }, max_tokens: 220,
          messages: [
            { role: "system", content: "你是桌面软件活动分类器。只返回 JSON：applicationLabel、activityKind、titleKeywords、confidence。activityKind 必须是 designing, modeling, rendering, video-editing, developing, editing, spreadsheet, presentation, reading, meeting, communicating, browsing, searching, ai-chat, learning, file-management, watching, listening, gaming, other 之一。titleKeywords 只能是可复用产品/站点关键词，不得包含路径、文档名、URL、项目名或个人信息。" },
            { role: "user", content: JSON.stringify({ processName: normalizeProcessName(snapshot.foregroundProcess), redactedWindowHint: this.redactTitle(snapshot.windowTitle) }) }
          ]
        })
      });
      if (!response.ok) throw new Error(`Activity classification failed (${response.status})`);
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const parsed = JSON.parse(String(payload.choices?.[0]?.message?.content || "{}")) as AiResult;
      const confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0));
      if (!isActivityKind(parsed.activityKind) || confidence < 0.75) { this.finishFallback(snapshot, key); return; }
      const titleKeywords = this.safeKeywords(parsed.titleKeywords, snapshot.windowTitle);
      const rule = await this.rules.addLearned({
        processName: snapshot.foregroundProcess, titleKeywords,
        applicationLabel: String(parsed.applicationLabel || "未知软件").slice(0, 40),
        activityKind: parsed.activityKind, confidence
      });
      const learnedClassification = classification(rule.activityKind, rule.applicationLabel, "ai", confidence);
      const resolved = { ...snapshot, ...learnedClassification };
      resolved.presenceState = resolvePresence(resolved);
      this.lastResolved.set(key, learnedClassification);
      while (this.lastResolved.size > 100) this.lastResolved.delete(this.lastResolved.keys().next().value!);
      if (key === this.stableKey) this.onResolved(resolved);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) this.finishFallback(snapshot, key);
    } finally {
      this.controller = null;
    }
  }

  private finishFallback(snapshot: ActivitySnapshot, key: string): void {
    if (key !== this.stableKey) return;
    const builtin = classifyBuiltin(snapshot.foregroundProcess);
    const fallback = classification("other", builtin.applicationLabel, "fallback", 0, false);
    const resolved = { ...snapshot, ...fallback };
    resolved.presenceState = resolvePresence(resolved);
    this.lastResolved.set(key, fallback);
    while (this.lastResolved.size > 100) this.lastResolved.delete(this.lastResolved.keys().next().value!);
    this.onResolved(resolved);
  }

  private safeKeywords(value: unknown, title: string): string[] {
    if (!Array.isArray(value)) return [];
    const lowerTitle = title.toLowerCase();
    return [...new Set(value.map((item) => String(item).toLowerCase().trim())
      .filter((item) => item.length >= 2 && item.length <= 24 && !/[\\/:?&=#@]/.test(item) && lowerTitle.includes(item)))]
      .slice(0, 5);
  }

  private genericTitleKey(title: string): string {
    return title.toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/\d+/g, "#").replace(/\s+/g, " ").slice(-80);
  }

  private redactTitle(title: string): string {
    return title.replace(/https?:\/\/\S+/gi, "[URL]").replace(/[a-z]:\\\S+/gi, "[PATH]").replace(/[\w.+-]+@[\w.-]+/g, "[EMAIL]")
      .split(/\s[-—|]\s/).slice(-2).join(" - ").replace(/\d{3,}/g, "#").slice(0, 120);
  }
}
