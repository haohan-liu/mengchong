import { app, safeStorage } from "electron";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Settings } from "../../src/types.js";

export const SETTINGS_VERSION = 8;

export function defaultSettings(): Settings {
  return {
    version: SETTINGS_VERSION,
    petName: "珊珊",
    firstRunConsent: false,
    appearance: {
      scale: 1,
      alwaysOnTop: true,
      lockPosition: false,
      animationIntensity: "full",
      bubbleFontSize: 15,
      bubbleScale: 1,
      bubbleOpacity: 0.94,
      bubbleDurationSeconds: 8,
      theme: "system",
      accentColor: "#d77d6b",
      recentAccentColors: []
    },
    sensing: {
      enabled: true,
      foregroundApp: true,
      windowTitle: true,
      keyboardMouse: true,
      clipboard: true,
      selectedText: true,
      meeting: true,
      microphone: true,
      power: true,
      network: true,
      autoContext: true,
      smartActivityLearning: false,
      blockedApps: ["1password", "bitwarden", "keepass", "credentialui", "password"],
      allowedApps: []
    },
    reminders: {
      focusMinutes: 50,
      breakMinutes: 5,
      hydrationMinutes: 60,
      proactiveCooldownMinutes: 20,
      proactiveDailyLimit: 6,
      scheduledSilent: false,
      quietStart: "22:30",
      quietEnd: "08:00",
      meetingSilent: true,
      fullscreenSilent: true,
      autostart: true,
      startupDelaySeconds: 3
    },
    ai: {
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      deepThinking: false,
      smartCompanionSpeech: true,
      monthlyLimit: 500,
      includeContext: true,
      toolPermissions: {
        open_url: "ask",
        launch_app: "ask",
        read_current_context: "ask"
      }
    },
    dataDirectory: "",
    manualMode: "auto",
    manualState: null,
    manualUntil: null
  };
}

export function mergeSettings(input: Partial<Settings>): Settings {
  const base = defaultSettings();
  const record = input && typeof input === "object" ? input : {};
  const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const appearance = object(record.appearance);
  const sensing = object(record.sensing);
  const reminders = object(record.reminders);
  const ai = object(record.ai);
  const toolPermissions = object(ai.toolPermissions);
  const boolean = (value: unknown, fallback: boolean): boolean => typeof value === "boolean" ? value : fallback;
  const number = (value: unknown, fallback: number, min: number, max: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  };
  const choice = <T extends string>(value: unknown, values: readonly T[], fallback: T): T =>
    values.includes(value as T) ? value as T : fallback;
  const strings = (value: unknown, fallback: string[]): string[] => Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, 100)
    : fallback;
  const time = (value: unknown, fallback: string): string => {
    const candidate = String(value ?? "");
    const match = /^(\d{2}):(\d{2})$/.exec(candidate);
    return match && Number(match[1]) < 24 && Number(match[2]) < 60 ? candidate : fallback;
  };
  const cleanedName = String(record.petName ?? base.petName).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const petName = Array.from(cleanedName).slice(0, 12).join("") || base.petName;
  const requestedMode = String(record.manualMode ?? base.manualMode);
  const manualMode = requestedMode === "sleep"
    ? "rest"
    : (["auto", "dnd", "rest", "energy_saving", "low_battery", "manual"].includes(requestedMode)
      ? requestedMode as Settings["manualMode"]
      : base.manualMode);
  const recentAccentColors = Array.isArray(appearance.recentAccentColors)
    ? [...new Set(appearance.recentAccentColors
      .map((value) => String(value).toLowerCase())
      .filter((value) => /^#[0-9a-f]{6}$/.test(value)))].slice(0, 6)
    : base.appearance.recentAccentColors;
  const manualStates = ["BOOT", "APPEAR", "IDLE", "LISTENING", "USER_TYPING", "THINKING", "RESPONDING", "SUCCESS", "ERROR", "OFFLINE", "LOW_BATTERY", "SLEEP", "DRAGGING", "REACTION", "DISAPPEAR"] as const;
  return {
    ...base,
    petName,
    firstRunConsent: boolean(record.firstRunConsent, base.firstRunConsent),
    manualMode,
    manualState: manualStates.includes(record.manualState as typeof manualStates[number]) ? record.manualState as typeof manualStates[number] : null,
    manualUntil: record.manualUntil === null ? null : number(record.manualUntil, 0, 0, Number.MAX_SAFE_INTEGER) || null,
    dataDirectory: typeof record.dataDirectory === "string" ? record.dataDirectory : base.dataDirectory,
    appearance: {
      scale: number(appearance.scale, base.appearance.scale, .6, 1.5),
      alwaysOnTop: boolean(appearance.alwaysOnTop, base.appearance.alwaysOnTop),
      lockPosition: boolean(appearance.lockPosition, base.appearance.lockPosition),
      animationIntensity: choice(appearance.animationIntensity, ["full", "soft", "minimal"] as const, base.appearance.animationIntensity),
      bubbleFontSize: number(appearance.bubbleFontSize, base.appearance.bubbleFontSize, 12, 22),
      bubbleScale: number(appearance.bubbleScale, base.appearance.bubbleScale, .8, 1.3),
      bubbleOpacity: number(appearance.bubbleOpacity, base.appearance.bubbleOpacity, .55, 1),
      bubbleDurationSeconds: number(appearance.bubbleDurationSeconds, base.appearance.bubbleDurationSeconds, 2, 30),
      theme: choice(appearance.theme, ["cream", "dark", "system"] as const, base.appearance.theme),
      accentColor: /^#[0-9a-f]{6}$/i.test(String(appearance.accentColor ?? "")) ? String(appearance.accentColor).toLowerCase() : base.appearance.accentColor,
      recentAccentColors
    },
    sensing: {
      enabled: boolean(sensing.enabled, base.sensing.enabled), foregroundApp: boolean(sensing.foregroundApp, base.sensing.foregroundApp),
      windowTitle: boolean(sensing.windowTitle, base.sensing.windowTitle), keyboardMouse: boolean(sensing.keyboardMouse, base.sensing.keyboardMouse),
      clipboard: boolean(sensing.clipboard, base.sensing.clipboard), selectedText: boolean(sensing.selectedText, base.sensing.selectedText),
      meeting: boolean(sensing.meeting, base.sensing.meeting), microphone: boolean(sensing.microphone, base.sensing.microphone),
      power: boolean(sensing.power, base.sensing.power), network: boolean(sensing.network, base.sensing.network),
      autoContext: boolean(sensing.autoContext, base.sensing.autoContext),
      smartActivityLearning: boolean(sensing.smartActivityLearning, base.sensing.smartActivityLearning),
      blockedApps: strings(sensing.blockedApps, base.sensing.blockedApps), allowedApps: strings(sensing.allowedApps, base.sensing.allowedApps)
    },
    reminders: {
      focusMinutes: number(reminders.focusMinutes, base.reminders.focusMinutes, 1, 240),
      breakMinutes: number(reminders.breakMinutes, base.reminders.breakMinutes, 1, 60),
      hydrationMinutes: number(reminders.hydrationMinutes, base.reminders.hydrationMinutes, 5, 240),
      proactiveCooldownMinutes: number(reminders.proactiveCooldownMinutes, base.reminders.proactiveCooldownMinutes, 1, 1440),
      proactiveDailyLimit: Math.round(number(reminders.proactiveDailyLimit, base.reminders.proactiveDailyLimit, 0, 100)),
      scheduledSilent: boolean(reminders.scheduledSilent, base.reminders.scheduledSilent),
      quietStart: time(reminders.quietStart, base.reminders.quietStart), quietEnd: time(reminders.quietEnd, base.reminders.quietEnd),
      meetingSilent: boolean(reminders.meetingSilent, base.reminders.meetingSilent), fullscreenSilent: boolean(reminders.fullscreenSilent, base.reminders.fullscreenSilent),
      autostart: boolean(reminders.autostart, base.reminders.autostart),
      startupDelaySeconds: number(reminders.startupDelaySeconds, base.reminders.startupDelaySeconds, 0, 30)
    },
    ai: {
      baseUrl: typeof ai.baseUrl === "string" && /^https?:\/\//i.test(ai.baseUrl) ? ai.baseUrl.trim() : base.ai.baseUrl,
      model: choice(ai.model, ["deepseek-v4-flash", "deepseek-v4-pro"] as const, base.ai.model),
      deepThinking: boolean(ai.deepThinking, base.ai.deepThinking), smartCompanionSpeech: boolean(ai.smartCompanionSpeech, base.ai.smartCompanionSpeech),
      monthlyLimit: Math.round(number(ai.monthlyLimit, base.ai.monthlyLimit, 0, 100000)),
      includeContext: boolean(ai.includeContext, base.ai.includeContext),
      toolPermissions: {
        open_url: choice(toolPermissions.open_url, ["ask", "allow", "deny"] as const, base.ai.toolPermissions.open_url),
        launch_app: choice(toolPermissions.launch_app, ["ask", "allow", "deny"] as const, base.ai.toolPermissions.launch_app),
        read_current_context: choice(toolPermissions.read_current_context, ["ask", "allow", "deny"] as const, base.ai.toolPermissions.read_current_context)
      }
    },
    version: SETTINGS_VERSION
  };
}

export class SettingsStore {
  private settings!: Settings;
  private writeChain: Promise<void> = Promise.resolve();
  private apiKeyConfigured: boolean | null = null;

  private get settingsPath(): string { return join(app.getPath("userData"), "settings.json"); }
  private get secretPath(): string { return join(app.getPath("userData"), "deepseek.key"); }

  async load(): Promise<Settings> {
    try {
      this.settings = mergeSettings(JSON.parse(await readFile(this.settingsPath, "utf8")) as Partial<Settings>);
    } catch {
      this.settings = defaultSettings();
    }
    if (!this.settings.dataDirectory) this.settings.dataDirectory = join(app.getPath("userData"), "data");
    await this.save(this.settings);
    return this.get();
  }

  get(): Settings { return structuredClone(this.settings); }

  async save(next: Settings): Promise<Settings> {
    this.settings = mergeSettings(next);
    const snapshot = JSON.stringify(this.settings, null, 2);
    const write = this.writeChain.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.settingsPath), { recursive: true });
      const temp = `${this.settingsPath}.tmp`;
      await writeFile(temp, snapshot, "utf8");
      await rename(temp, this.settingsPath);
    });
    this.writeChain = write;
    await write;
    if (process.platform === "win32" && app.isPackaged) {
      // 先清理旧版本未带参数的登录项，再按当前格式登记，避免覆盖升级后出现两个自启动项。
      app.setLoginItemSettings({ openAtLogin: false });
      app.setLoginItemSettings({
        openAtLogin: this.settings.reminders.autostart,
        path: process.execPath,
        args: ["--autostart"]
      });
    }
    return this.get();
  }

  async setApiKey(value: string): Promise<boolean> {
    if (!safeStorage.isEncryptionAvailable()) return false;
    const cleaned = value.trim();
    await writeFile(this.secretPath, safeStorage.encryptString(cleaned).toString("base64"), "utf8");
    this.apiKeyConfigured = Boolean(cleaned);
    return true;
  }

  async getApiKey(): Promise<string> {
    if (!safeStorage.isEncryptionAvailable()) return "";
    try {
      return safeStorage.decryptString(Buffer.from(await readFile(this.secretPath, "utf8"), "base64"));
    } catch { this.apiKeyConfigured = false; return ""; }
  }

  async hasApiKey(): Promise<boolean> {
    if (this.apiKeyConfigured !== null) return this.apiKeyConfigured;
    try { await access(this.secretPath); this.apiKeyConfigured = Boolean(await this.getApiKey()); }
    catch { this.apiKeyConfigured = false; }
    return this.apiKeyConfigured;
  }

  async clearApiKey(): Promise<void> {
    await rm(this.secretPath, { force: true });
    this.apiKeyConfigured = false;
  }

  async clearAndReset(): Promise<Settings> {
    await this.writeChain.catch(() => undefined);
    await Promise.all([rm(this.settingsPath, { force: true }), this.clearApiKey()]);
    this.settings = defaultSettings();
    this.settings.dataDirectory = join(app.getPath("userData"), "data");
    return this.save(this.settings);
  }
}
