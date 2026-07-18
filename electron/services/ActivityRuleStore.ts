import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ActivityKind, ActivityRule } from "../../src/types.js";
import { isActivityKind } from "../../src/shared/activity.js";

interface RuleFile {
  version: 1;
  rules: ActivityRule[];
  aiUsage: { date: string; count: number };
}

const dateKey = (): string => new Date().toISOString().slice(0, 10);

export function normalizeProcessName(value: string): string {
  return basename(String(value || "").replace(/\\/g, "/")).toLowerCase().replace(/[^a-z0-9._+-]/g, "").slice(0, 80);
}

function normalizeKeywords(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).toLowerCase().trim())
    .filter((item) => item.length >= 2 && item.length <= 24 && !/[\\/:?&=#@]/.test(item)))]
    .slice(0, 5);
}

function normalizeRule(value: unknown): ActivityRule | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ActivityRule>;
  const processName = normalizeProcessName(String(item.processName || ""));
  if (!processName || !isActivityKind(item.activityKind) || (item.source !== "manual" && item.source !== "learned")) return null;
  return {
    id: String(item.id || crypto.randomUUID()), processName,
    titleKeywords: normalizeKeywords(item.titleKeywords),
    applicationLabel: String(item.applicationLabel || processName.replace(/\.exe$/i, "")).replace(/[\r\n]/g, " ").trim().slice(0, 40) || "未知软件",
    activityKind: item.activityKind, source: item.source,
    confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0)),
    hitCount: Math.max(0, Math.round(Number(item.hitCount) || 0)),
    lastUsedAt: Math.max(0, Number(item.lastUsedAt) || Date.now()), pinned: Boolean(item.pinned)
  };
}

export class ActivityRuleStore {
  private rules: ActivityRule[] = [];
  private aiUsage = { date: dateKey(), count: 0 };
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private dataDirectory: () => string) {}
  private path(): string { return join(this.dataDirectory(), "activity-rules.json"); }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path(), "utf8")) as Partial<RuleFile>;
      this.rules = (Array.isArray(parsed.rules) ? parsed.rules : []).flatMap((item) => {
        const rule = normalizeRule(item);
        return rule ? [rule] : [];
      });
      this.aiUsage = parsed.aiUsage?.date === dateKey()
        ? { date: dateKey(), count: Math.max(0, Math.round(Number(parsed.aiUsage.count) || 0)) }
        : { date: dateKey(), count: 0 };
      this.prune();
    } catch {
      this.rules = [];
      this.aiUsage = { date: dateKey(), count: 0 };
    }
  }

  list(): ActivityRule[] { return structuredClone(this.rules).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastUsedAt - a.lastUsedAt); }

  match(processName: string, title: string, source: "manual" | "learned"): ActivityRule | null {
    const process = normalizeProcessName(processName);
    const normalizedTitle = String(title || "").toLowerCase();
    const matches = this.rules.filter((rule) => rule.source === source && rule.processName === process
      && (!rule.titleKeywords.length || rule.titleKeywords.every((keyword) => normalizedTitle.includes(keyword))));
    const rule = matches.sort((a, b) => b.titleKeywords.length - a.titleKeywords.length || Number(b.pinned) - Number(a.pinned))[0];
    if (!rule) return null;
    if (Date.now() - rule.lastUsedAt >= 60_000) {
      rule.hitCount += 1;
      rule.lastUsedAt = Date.now();
      void this.save();
    }
    return structuredClone(rule);
  }

  async addLearned(input: { processName: string; titleKeywords?: string[]; applicationLabel: string; activityKind: ActivityKind; confidence: number }): Promise<ActivityRule> {
    const normalized = normalizeRule({ ...input, id: crypto.randomUUID(), source: "learned", hitCount: 1, lastUsedAt: Date.now(), pinned: false });
    if (!normalized) throw new Error("Invalid learned activity rule");
    this.rules = this.rules.filter((rule) => !(rule.source === "learned" && rule.processName === normalized.processName
      && rule.titleKeywords.join("\0") === normalized.titleKeywords.join("\0")));
    this.rules.push(normalized);
    this.prune();
    await this.save();
    return structuredClone(normalized);
  }

  async update(id: string, changes: Partial<Pick<ActivityRule, "activityKind" | "applicationLabel" | "pinned">>): Promise<ActivityRule | null> {
    const rule = this.rules.find((item) => item.id === id);
    if (!rule) return null;
    if (isActivityKind(changes.activityKind)) rule.activityKind = changes.activityKind;
    if (typeof changes.applicationLabel === "string") rule.applicationLabel = changes.applicationLabel.replace(/[\r\n]/g, " ").trim().slice(0, 40) || rule.applicationLabel;
    if (typeof changes.pinned === "boolean") rule.pinned = changes.pinned;
    if (rule.pinned || changes.activityKind || changes.applicationLabel) rule.source = "manual";
    rule.confidence = 1;
    rule.lastUsedAt = Date.now();
    await this.save();
    return structuredClone(rule);
  }

  async remove(id: string): Promise<boolean> {
    const before = this.rules.length;
    this.rules = this.rules.filter((rule) => rule.id !== id);
    if (this.rules.length !== before) await this.save();
    return this.rules.length !== before;
  }

  canUseAiToday(): boolean {
    if (this.aiUsage.date !== dateKey()) this.aiUsage = { date: dateKey(), count: 0 };
    return this.aiUsage.count < 10;
  }

  async recordAiCall(): Promise<void> {
    if (this.aiUsage.date !== dateKey()) this.aiUsage = { date: dateKey(), count: 0 };
    this.aiUsage.count += 1;
    await this.save();
  }

  async clear(): Promise<void> {
    this.rules = [];
    this.aiUsage = { date: dateKey(), count: 0 };
    await this.writeChain.catch(() => undefined);
    await rm(this.path(), { force: true });
  }

  private prune(): void {
    const learned = this.rules.filter((rule) => rule.source === "learned");
    if (learned.length <= 200) return;
    const remove = new Set(learned.filter((rule) => !rule.pinned).sort((a, b) => a.lastUsedAt - b.lastUsedAt).slice(0, learned.length - 200).map((rule) => rule.id));
    this.rules = this.rules.filter((rule) => !remove.has(rule.id));
  }

  private save(): Promise<void> {
    const snapshot: RuleFile = { version: 1, rules: structuredClone(this.rules), aiUsage: { ...this.aiUsage } };
    const write = this.writeChain.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.path()), { recursive: true });
      const temp = `${this.path()}.tmp`;
      await writeFile(temp, JSON.stringify(snapshot, null, 2), "utf8");
      await rename(temp, this.path());
    });
    this.writeChain = write;
    return write;
  }
}
