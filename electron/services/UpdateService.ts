import { app } from "electron";
import electronUpdater, { type AppUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import type { UpdateStatus } from "../../src/types.js";

type UpdateServiceOptions = {
  enabled: boolean;
  onStatus(status: UpdateStatus): void;
  beforeInstall(): Promise<void>;
};

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const STARTUP_DELAY_MS = 15_000;

function updaterInstance(): AppUpdater {
  return electronUpdater.autoUpdater;
}

function releaseNotes(info: UpdateInfo): string | null {
  const notes = info.releaseNotes;
  const value = typeof notes === "string" ? notes : notes?.map((item) => item.note).join("\n");
  const normalized = value?.replace(/\r\n/g, "\n").trim();
  return normalized ? normalized.slice(0, 1_500) : null;
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/no published versions|no releases|latest release.*404|status code 404/i.test(message)) {
    return "发布页暂时还没有正式版本，完成首次 GitHub Release 后即可正常检查更新";
  }
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|network|net::|internet|offline/i.test(message)) {
    return "暂时无法连接 GitHub，请检查网络后重试";
  }
  if (/signature|certificate|publisher|authenticode/i.test(message)) {
    return "更新包来源验证失败，请前往官方发布页手动下载";
  }
  return message.replace(/https?:\/\/[^\s]+/g, "GitHub 更新服务").slice(0, 180) || "更新检查失败，请稍后重试";
}

export class UpdateService {
  private readonly updater = updaterInstance();
  private statusValue: UpdateStatus;
  private startupTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private checkPromise: Promise<UpdateStatus> | null = null;
  private downloadPromise: Promise<UpdateStatus> | null = null;

  constructor(private readonly options: UpdateServiceOptions) {
    this.statusValue = {
      phase: options.enabled ? "idle" : "disabled",
      currentVersion: app.getVersion(),
      availableVersion: null,
      latestVerifiedVersion: null,
      downloadedVersion: null,
      checkedAt: null,
      downloadVerified: false,
      releaseNotes: null,
      downloadPercent: 0,
      message: options.enabled ? "可以检查新版本" : "开发模式不连接更新服务器"
    };
    this.updater.autoDownload = false;
    // A cached package can be older than a newly published release. Installation
    // is therefore always an explicit, freshly verified action.
    this.updater.autoInstallOnAppQuit = false;
    this.updater.allowPrerelease = false;
    this.bindEvents();
  }

  status(): UpdateStatus {
    return structuredClone(this.statusValue);
  }

  start(): void {
    this.emit();
    if (!this.options.enabled || this.startupTimer || this.intervalTimer) return;
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      void this.check().catch(() => undefined);
    }, STARTUP_DELAY_MS);
    this.startupTimer.unref();
    this.intervalTimer = setInterval(() => void this.check().catch(() => undefined), CHECK_INTERVAL_MS);
    this.intervalTimer.unref();
  }

  check(): Promise<UpdateStatus> {
    if (!this.options.enabled) return Promise.resolve(this.status());
    if (this.checkPromise) return this.checkPromise;
    this.set({ phase: "checking", downloadPercent: 0, message: "正在检查 GitHub Releases…" });
    this.checkPromise = this.updater.checkForUpdates()
      .then((result) => {
        const latest = result?.updateInfo?.version ?? this.statusValue.availableVersion;
        this.set({ latestVerifiedVersion: latest || null, checkedAt: Date.now(), releaseNotes: result?.updateInfo ? releaseNotes(result.updateInfo) : this.statusValue.releaseNotes });
        if (this.statusValue.downloadedVersion && this.statusValue.downloadedVersion !== latest) {
          this.set({ downloadVerified: false, phase: latest ? "available" : "idle", message: latest ? `已发现更新 ${latest}，旧缓存不会被安装` : "更新信息已刷新" });
        } else if (this.statusValue.downloadedVersion && this.statusValue.downloadedVersion === latest) {
          this.set({ phase: "downloaded", availableVersion: latest || null, downloadVerified: true, message: "最新更新已下载，随时可以安装" });
        }
        return this.status();
      })
      .catch((error) => {
        this.set({ phase: "error", message: cleanError(error) });
        return this.status();
      })
      .finally(() => { this.checkPromise = null; });
    return this.checkPromise;
  }

  async download(): Promise<UpdateStatus> {
    if (!this.options.enabled) return this.status();
    if (this.downloadPromise) return this.downloadPromise;
    // Refresh first so an already-downloaded 1.0.2 cannot be installed after
    // 1.0.3 has appeared upstream.
    await this.check();
    if (this.statusValue.phase !== "available" || !this.statusValue.latestVerifiedVersion) return this.status();
    this.set({ phase: "downloading", downloadPercent: 0, downloadedVersion: null, downloadVerified: false, message: "正在下载最新更新…" });
    this.downloadPromise = this.updater.downloadUpdate()
      .then(() => this.status())
      .catch((error) => {
        this.set({ phase: "error", message: cleanError(error) });
        return this.status();
      })
      .finally(() => { this.downloadPromise = null; });
    return this.downloadPromise;
  }

  async install(): Promise<boolean> {
    if (!this.options.enabled || this.statusValue.phase !== "downloaded") return false;
    await this.check();
    const latest = this.statusValue.latestVerifiedVersion;
    if (!latest || this.statusValue.downloadedVersion !== latest || !this.statusValue.downloadVerified) {
      this.set({ phase: latest ? "available" : "error", message: latest ? "缓存版本不是最新版本，正在重新下载" : "无法确认最新版，暂不安装" });
      if (latest) await this.download();
      if (this.statusValue.phase !== "downloaded" || this.statusValue.downloadedVersion !== this.statusValue.latestVerifiedVersion || !this.statusValue.downloadVerified) return false;
    }
    await this.options.beforeInstall();
    this.updater.quitAndInstall(true, true);
    return true;
  }

  private bindEvents(): void {
    this.updater.on("checking-for-update", () => this.set({ phase: "checking", message: "正在检查 GitHub Releases…" }));
    this.updater.on("update-available", (info: UpdateInfo) => this.set({
      phase: "available",
      availableVersion: info.version,
      latestVerifiedVersion: info.version,
      checkedAt: Date.now(),
      releaseNotes: releaseNotes(info),
      downloadPercent: 0,
      message: `发现新版本 ${info.version}`
    }));
    this.updater.on("update-not-available", (info: UpdateInfo) => this.set({
      phase: "up-to-date",
      availableVersion: info.version || null,
      latestVerifiedVersion: info.version || this.statusValue.currentVersion,
      checkedAt: Date.now(),
      releaseNotes: null,
      downloadPercent: 0,
      message: "当前已经是最新版本"
    }));
    this.updater.on("download-progress", (progress: ProgressInfo) => this.set({
      phase: "downloading",
      downloadPercent: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
      message: `正在下载更新 ${Math.round(Number(progress.percent) || 0)}%`
    }));
    this.updater.on("update-downloaded", (info: UpdateInfo) => this.set({
      phase: "downloaded",
      availableVersion: info.version,
      downloadedVersion: info.version,
      downloadVerified: info.version === this.statusValue.latestVerifiedVersion,
      releaseNotes: releaseNotes(info) ?? this.statusValue.releaseNotes,
      downloadPercent: 100,
      message: info.version === this.statusValue.latestVerifiedVersion ? "最新更新已下载，重启后自动完成安装" : "下载版本已过期，正在等待重新获取最新版本"
    }));
    this.updater.on("error", (error) => this.set({ phase: "error", message: cleanError(error) }));
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.statusValue = { ...this.statusValue, ...patch };
    this.emit();
  }

  private emit(): void {
    this.options.onStatus(this.status());
  }
}
