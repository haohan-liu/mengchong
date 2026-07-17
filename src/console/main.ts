import "./styles.css";
import animations from "../data/animations.json";
import type { ActivitySnapshot, AnimationDefinition, PetRuntimeStatus, PetState, Settings, StatisticsSummary, UpdateStatus } from "../types";
import { buttonLabel, escapeHtml, icon, safeAccent, sectionHeading, type IconName } from "./ui";
import { formatCount, formatDuration } from "./format";

const recommendedAccents = [
  ["珊瑚红", "#e94f64"], ["蜜桃橙", "#e87955"], ["鸢尾紫", "#8267c7"],
  ["晴空蓝", "#4f7fce"], ["青瓷绿", "#3f9a86"], ["琥珀金", "#c88a32"]
] as const;
const statisticCategories = ["design", "office", "development", "communication", "entertainment", "other"] as const;
const stateActionMap: Record<PetState, string[]> = {
  BOOT: ["idle_breath"], APPEAR: ["wave_hello"], IDLE: ["idle_breath", "idle_blink", "idle_look_around"],
  LISTENING: ["listen"], USER_TYPING: ["user_typing", "type_fast"], THINKING: ["thinking", "loading"],
  RESPONDING: ["talk_normal"], SUCCESS: ["success"], ERROR: ["error"], OFFLINE: ["offline"],
  LOW_BATTERY: ["low_battery"], SLEEP: ["stand_sleep"], DRAGGING: ["dragged"],
  REACTION: ["clicked", "multi_clicked"], DISAPPEAR: ["good_night"]
};

function hexToHsl(hex: string): [number, number, number] {
  const value = safeAccent(hex).slice(1);
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta) hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  const lightness = (max + min) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  return [Math.round((hue * 60 + 360) % 360), Math.round(saturation * 100), Math.round(lightness * 100)];
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = Math.max(0, Math.min(100, saturation)) / 100, l = Math.max(0, Math.min(100, lightness)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((hue / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((value) => Math.round((value + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

const tabs = [
  ["home", "总览", "home"], ["appearance", "外观与桌宠", "palette"], ["states", "状态与动作", "sparkles"],
  ["privacy", "感知与隐私", "shield"], ["reminders", "提醒与陪伴", "clock"], ["ai", "智能体 API", "brain"],
  ["stats", "数据统计", "chart"], ["storage", "数据与存储", "database"], ["updates", "关于与更新", "info"]
] as const satisfies ReadonlyArray<readonly [string, string, IconName]>;

class ConsoleApp {
  private settings!: Settings;
  private active = "home";
  private stats: StatisticsSummary | null = null;
  private statsRange = 30;
  private runtime!: PetRuntimeStatus;
  private updateStatus!: UpdateStatus;
  private onboardingOpen = false;
  private onboardingStep = 0;
  private activity!: ActivitySnapshot;
  private rangeSaveTimer = 0;
  private toastTimer = 0;
  private pauseExpiryTimer = 0;
  private showcaseTimer = 0;
  private manualCountdownTimer = 0;
  private root = document.querySelector<HTMLElement>("#console-app")!;

  async mount(): Promise<void> {
    [this.settings, this.stats, this.runtime, this.updateStatus] = await Promise.all([
      window.petAPI.settings.get(), window.petAPI.statistics.get(31), window.petAPI.pet.getRuntime(), window.petAPI.updates.status()
    ]);
    this.onboardingOpen = !this.settings.firstRunConsent;
    this.activity = this.runtime.activity;
    const requestedTab = await window.petAPI.console.initialTab();
    if (tabs.some(([id]) => id === requestedTab)) this.active = requestedTab;
    this.render();
    window.petAPI.console.onNavigate((tab) => { if (tabs.some(([id]) => id === tab) && tab !== this.active) void this.openTab(tab); });
    window.petAPI.pet.onActivity((snapshot) => {
      this.activity = snapshot;
      this.updateLiveValues();
    });
    window.petAPI.settings.onChanged((settings) => {
      const nameChanged = this.settings.petName !== settings.petName;
      const modeChanged=this.settings.manualMode!==settings.manualMode;
      const scheduledSilentChanged=this.settings.reminders.scheduledSilent!==settings.reminders.scheduledSilent;
      this.settings = settings;
      // Most console text is intentionally generated from the name at render
      // time. Re-render only for a cross-window rename so every copy updates
      // together while preserving the current page and scroll position.
      if (nameChanged) { document.title = `${this.petNameText()}桌宠控制台`; this.render(true); return; }
      if(this.active==='appearance')this.syncAppearanceScale();
      if(scheduledSilentChanged&&this.active==='reminders')this.syncScheduledSilentControls(settings.reminders.scheduledSilent);
      if(modeChanged)this.syncModeSelection();
      this.syncManualCountdown();
      this.updateLiveValues();
    });
    window.petAPI.pet.onRuntimeChanged((status) => {
      this.runtime = status;
      this.activity = status.activity;
      if(this.active==='states')this.syncStateSelection();
      this.updateLiveValues();
    });
    window.petAPI.pet.onScalePreview(({scale,bubbleScale}) => {
      if(this.active==='appearance')this.syncAppearanceScale(scale,bubbleScale);
    });
    window.petAPI.updates.onChanged((status) => {
      this.updateStatus=status;
      if(this.active==='updates')this.syncUpdatePanel();
      else this.syncUpdateAttention();
    });
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".custom-select, .time-picker, .color-picker")) this.closePopovers();
    });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") this.closePopovers(); });
  }

  private render(preserveScroll=false): void {
    window.clearInterval(this.showcaseTimer);
    const previousScroll=this.root.querySelector<HTMLElement>('.workspace')?.scrollTop??0;
    const current = tabs.find(([id])=>id===this.active) ?? tabs[0];
    const accent = safeAccent(this.settings.appearance.accentColor);
    const name = this.petName();
    const updateAttention=this.updateStatus.phase==='available'||this.updateStatus.phase==='downloaded';
    this.root.innerHTML = `<div class="console-shell theme-${this.settings.appearance.theme} ${this.settings.manualMode==='energy_saving'?'energy-saving':''}" style="--accent:${accent}">
      <aside class="sidebar" aria-label="控制台主导航">
        <div class="brand"><div class="brand-mark" aria-hidden="true">${this.petNameInitial()}</div><div class="brand-copy"><b>${name}控制台</b><small>${icon('heart')} AI 桌面陪伴</small></div></div>
        <nav>${tabs.map(([id,label,iconName])=>`<button type="button" data-tab="${id}" class="nav-item ${this.active===id?'active':''}" ${this.active===id?'aria-current="page"':''}>${icon(iconName)}<span>${label}</span>${id==='updates'&&updateAttention?'<i class="nav-update-dot" aria-label="有可用更新"></i>':''}${icon('chevron','nav-chevron')}</button>`).join("")}</nav>
        <div class="sidebar-status">
          <div class="privacy-note"><div class="sidebar-note-title"><span class="status-dot ${this.sensingActive()?'':'off'}"></span><b>本地感知</b><strong data-live="sensing-status">${this.sensingLabel()}</strong></div><small>${icon('shield')} 不保存按键内容 · 不录音 · 不截图</small></div>
          <div class="performance-note" title="应用内存包含桌宠、当前控制台与 GPU 等 Electron 子进程；关闭控制台会释放其渲染进程。"><div class="sidebar-note-title">${icon('activity')}<b>当前资源消耗</b></div><dl><div><dt><i class="resource-dot" data-resource="pet-cpu"></i>应用 CPU</dt><dd data-live="pet-cpu">${this.percent(this.activity.performance.petCpuPercent)}</dd></div><div><dt><i class="resource-dot" data-resource="pet-memory"></i>应用内存</dt><dd data-live="pet-memory">${this.activity.performance.petMemoryMb.toFixed(1)} MB</dd></div><div><dt><i class="resource-dot" data-resource="system-cpu"></i>系统 CPU</dt><dd data-live="system-cpu">${this.percent(this.activity.performance.systemCpuPercent)}</dd></div><div><dt><i class="resource-dot" data-resource="system-memory"></i>系统内存</dt><dd data-live="system-memory">${this.percent(this.activity.performance.systemMemoryPercent)}</dd></div></dl></div>
        </div>
      </aside>
      <main class="workspace">
        <header class="topbar"><div class="page-intro"><span class="page-kicker">${name} · ${current[1]}</span><h1>${current[1]}</h1><p>${this.subtitle()}</p></div><div class="topbar-actions"><button type="button" class="icon-button close-window" aria-label="关闭控制台" title="关闭控制台">${icon('close')}</button></div></header>
        <section class="page" aria-label="${current[1]}">${this.page()}</section>
      </main>
      <div class="toast" role="status" aria-live="polite"><span class="toast-icon">${icon('check')}</span><span class="toast-message"></span></div>
      <dialog class="confirm-dialog"><form method="dialog"><div class="dialog-icon">${icon('shield')}</div><h2></h2><p></p><div class="dialog-actions"><button type="submit" value="cancel">取消</button><button type="submit" value="confirm" class="danger confirm-submit">确认</button></div></form></dialog>
      ${this.onboarding()}
    </div>`;
    this.bind();
    this.updateLiveValues();
    this.syncManualCountdown();
    if(this.active==='home')this.startShowcaseAnimation();
    if(preserveScroll){const workspace=this.root.querySelector<HTMLElement>('.workspace');if(workspace)workspace.scrollTop=previousScroll}
  }

  private subtitle(): string { const name=this.petName(); return ({home:"今天也在安静地陪你工作。",appearance:"调整名字、尺寸、动效和界面风格。",states:`查看并临时切换${name}的状态。`,privacy:`决定${name}能够感知哪些本地上下文。`,reminders:"配置专注、休息和喝水节奏。",ai:"配置智能对话与本地工具权限。",stats:"只展示本地聚合数据，不保存内容。",storage:"管理数据位置与本地数据清理。",updates:"查看版本、隐私说明、使用指引与官方发布页。"} as Record<string,string>)[this.active] ?? ""; }

  private page(): string {
    if (this.active === "home") return this.home();
    if (this.active === "appearance") return this.appearance();
    if (this.active === "states") return this.statesV2();
    if (this.active === "privacy") return this.privacy();
    if (this.active === "reminders") return this.reminders();
    if (this.active === "ai") return this.ai();
    if (this.active === "stats") return this.statistics();
    if (this.active === "storage") return this.storage();
    return this.updatesPage();
  }

  private home(): string {
    const today = this.stats?.today;
    const performance = this.activity.performance;
    const name = this.petName();
    const aiUsed=this.monthlyAiUsage(),aiLimit=Math.max(0,this.settings.ai.monthlyLimit),aiRemaining=Math.max(0,aiLimit-aiUsed);
    const quickModes: ReadonlyArray<readonly [Settings['manualMode'], string, string, IconName]> = [
      ['auto', '自动陪伴', '自动识别节奏', 'sparkles'], ['dnd', '勿扰', '安静陪伴', 'moon'],
      ['rest', '休息', '进入休息动作', 'coffee'], ['energy_saving', '节能模式', '降低动效开销', 'activity']
    ];
    const quickModeCards = quickModes.map(([value, label, description, iconName]) => `<button type="button" data-mode="${value}" class="quick-mode-card ${this.settings.manualMode===value?'selected':''}"><i class="quick-mode-icon">${icon(iconName)}</i><span><b>${label}</b><small>${description}</small></span>${this.settings.manualMode===value?`<em>${icon('check')} 当前</em>`:''}</button>`).join('');
    return `<article class="hero-card"><div class="hero-copy"><span class="status-pill"><i class="status-dot ${this.sensingActive()?'':'off'}"></i>当前状态 · <b data-live="sensor-source">${this.sensorSourceName()}</b></span><h2 data-live="mode-headline">${this.modeHeadline()}</h2><p><span data-live="foreground">${escapeHtml(this.foregroundLabel())}</span><span class="hero-separator">·</span><span data-live="typing">${this.typingLabel()}</span></p><div class="hero-actions"><button type="button" data-command="chat" class="primary">${buttonLabel('message','立即聊天')}</button><button type="button" data-command="toggle-sensing" class="sensing-toggle">${this.sensingControlLabel()}</button></div></div><div class="pet-showcase"><div class="pet-orb"><span class="orb-ring"></span><img data-showcase-pet src="./sprites/idle_breath/idle_breath_000.png" alt="${name}"></div><span class="companion-badge">${icon('heart')} <span data-live="mode-label">${this.modeLabel()}</span></span></div></article>
      <div class="metric-grid">${this.metric('clock','今日专注',this.duration(today?.focusSeconds ?? 0),'有效工作时间')}${this.metric('keyboard','输入事件',`${this.compactCount(today?.inputEvents ?? 0)} 次`,'键盘、点击与滚轮次数')}${this.metric('coffee','休息完成',`${this.compactCount(today?.breaksCompleted ?? 0)} 次`,'今天的完成次数')}${this.metric('brain','AI 对话',`${this.compactCount(aiUsed)} 次`,`限额 ${this.compactCount(aiLimit)} 次 · 剩余 ${this.compactCount(aiRemaining)} 次`)}</div>
      <div class="two-col"><article class="card">${sectionHeading('感知健康','只统计活动信号，不读取输入内容')}<div class="health-list"><div class="health-row"><span>感知状态</span><b class="status-text ${this.sensingActive()?'ok':'warn'}" data-live="sensing-status">${this.sensingLabel()}</b></div><div class="health-row"><span>键盘事件（最近 1 秒）</span><b data-live="keyboard-rate">${this.activity.keyboardCount1s}</b></div><div class="health-row"><span>鼠标事件（最近 1 秒）</span><b data-live="mouse-rate">${this.activity.mouseClicks1s + this.activity.mouseWheel1s}</b></div><div class="health-row"><span>内容上下文</span><b>${this.settings.sensing.autoContext?'自动附带':'不发送'}</b></div></div></article><article class="card">${sectionHeading('电脑与桌宠性能','桌宠应用占用信息，关闭控制台会释放其渲染进程')}<div class="health-list"><div class="health-row"><span>系统 CPU / 内存</span><b><span data-live="system-cpu">${this.percent(performance.systemCpuPercent)}</span> / <span data-live="system-memory">${this.percent(performance.systemMemoryPercent)}</span></b></div><div class="health-row"><span>应用 CPU / 内存</span><b><span data-live="pet-cpu">${this.percent(performance.petCpuPercent)}</span> / <span data-live="pet-memory">${performance.petMemoryMb.toFixed(1)} MB</span></b></div><div class="health-row"><span>传感器内存</span><b data-live="sensor-memory">${performance.sensorMemoryMb ? `${performance.sensorMemoryMb.toFixed(1)} MB` : '基础降级层'}</b></div><div class="health-row"><span>进程 / 事件循环延迟</span><b><span data-live="pet-processes">${performance.petProcessCount}</span> / <span data-live="event-loop-lag">${performance.eventLoopLagMs} ms</span></b></div></div></article></div><article class="card compact-card quick-mode-section">${sectionHeading('快速模式',`一键切换${name}的陪伴节奏`)}<div class="quick-mode-grid">${quickModeCards}</div></article>`;
  }

  private appearance(): string {
    const a=this.settings.appearance,name=this.petName();
    const resetBehavior=`<button type="button" data-command="reset-behavior" class="section-reset">${buttonLabel('rotate','重置')}</button>`;
    const resetMotion=`<button type="button" data-command="reset-motion" class="section-reset">${buttonLabel('rotate','重置')}</button>`;
    const resetAccent=`<button type="button" data-command="reset-accent" class="section-reset">${buttonLabel('rotate','重置强调色')}</button>`;
    return `<article class="card identity-card"><div class="name-preview"><div class="name-preview-mark">${this.petNameInitial()}</div><span class="name-preview-status">${icon('heart')} 我的桌面伙伴</span></div><div class="name-settings">${sectionHeading('桌宠名字','默认叫珊珊，修改后会同步到聊天、通知、托盘和智能体')}<label class="field-group"><span class="field-label">名字</span><div class="name-input-row"><input type="text" data-pet-name value="${name}" maxlength="12" placeholder="例如：珊珊" autocomplete="off"><button type="button" data-command="save-name" class="primary">${buttonLabel('check','保存名字')}</button></div><small class="field-hint">1–12 个字符，不可为空</small></label></div></article><div class="two-col"><article class="card form-card">${sectionHeading('桌宠尺寸与行为',`调整${name}在桌面上的呈现方式`,resetBehavior)}${this.range("桌宠大小","scale",a.scale,.6,1.5,.01,`${Math.round(a.scale*100)}%`)}${this.switcher("始终置顶","alwaysOnTop",a.alwaysOnTop,`让${name}保持在其他窗口上方`)}${this.switcher("锁定位置","lockPosition",a.lockPosition,"防止误拖动")}<button type="button" data-command="reset-position" class="secondary full">${buttonLabel('rotate','重置到屏幕右下角')}</button></article>
      <article class="card form-card">${sectionHeading('动效与气泡','气泡框与文字统一缩放；鼠标滚轮会与人物一起联动',resetMotion)}${this.select("动画强度","animationIntensity",a.animationIntensity,[["full","完整"],["soft","柔和"],["minimal","极简"]])}${this.range("气泡与文字大小","bubbleScale",a.bubbleScale,.8,1.3,.01,`${Math.round(a.bubbleScale*100)}%`)}${this.range("气泡透明度","bubbleOpacity",a.bubbleOpacity,.72,1,.02,`${Math.round(a.bubbleOpacity*100)}%`)}${this.range("气泡时长","bubbleDurationSeconds",a.bubbleDurationSeconds,3,20,1,`${a.bubbleDurationSeconds} 秒`)}</article></div>
      <article class="card">${sectionHeading('控制台风格','主题与强调色会实时应用到整个控制台',resetAccent)}<div class="theme-grid">${[["cream","柔光暖白","sun","#fff8fb"],["dark","暮色深灰","moon",safeAccent(a.accentColor)],["system","跟随系统","monitor",`linear-gradient(135deg,#fff8fb 50%,${safeAccent(a.accentColor)} 50%)`]].map(([v,l,iconName,c])=>`<button type="button" data-theme="${v}" class="theme-swatch ${a.theme===v?'selected':''}"><i class="theme-preview" style="background:${c}">${icon(iconName as IconName)}</i><span><b>${l}</b><small>${v==='system'?'随 Windows 外观切换':v==='dark'?'夜间更柔和':'与当前粉白界面一致'}</small></span>${a.theme===v?icon('check','selected-check'):''}</button>`).join('')}</div>${this.colorPicker()}</article>`;
  }

  private states(): string { const states:PetState[]=["BOOT","APPEAR","IDLE","LISTENING","USER_TYPING","THINKING","RESPONDING","SUCCESS","ERROR","OFFLINE","LOW_BATTERY","SLEEP","DRAGGING","REACTION","DISAPPEAR"]; return `<article class="card compact-card">${sectionHeading('陪伴模式','模式会持续生效，直到你再次切换')}<div class="mode-grid wide">${[["auto","自动"],["dnd","勿扰"],["rest","休息"],["energy_saving","节能"],["low_battery","低电量模拟"],["manual","临时状态"]].map(([v,l])=>`<button type="button" data-mode="${v}" class="choice-button ${this.settings.manualMode===v?'selected':''}">${l}${this.settings.manualMode===v?icon('check'):''}</button>`).join('')}</div></article><div class="two-col state-columns"><article class="card">${sectionHeading('15 个顶层状态','点击后保持 30 秒，再自动恢复陪伴')}<div class="state-list">${states.map(s=>`<button type="button" data-state="${s}" class="list-choice ${this.runtime.state===s?'selected':''}"><span><b>${s}</b><small>${this.stateDescription(s)}</small></span>${this.runtime.state===s?'<em>当前</em>':icon('chevron')}</button>`).join('')}</div></article><article class="card">${sectionHeading('24 个正式动作','一次性动作结束后自动恢复')}<div class="action-list">${(animations as AnimationDefinition[]).map(a=>`<button type="button" data-action="${escapeHtml(a.id)}" class="list-choice"><span><b>${escapeHtml(a.name)}</b><small>${escapeHtml(a.id)} · ${a.frames} 帧</small></span>${icon('chevron')}</button>`).join('')}</div><button type="button" data-action="idle_breath" class="primary full">${buttonLabel('refresh','停止并恢复自动')}</button></article></div>`; }

  private statesV2(): string {
    const states: PetState[] = ["BOOT", "APPEAR", "IDLE", "LISTENING", "USER_TYPING", "THINKING", "RESPONDING", "SUCCESS", "ERROR", "OFFLINE", "LOW_BATTERY", "SLEEP", "DRAGGING", "REACTION", "DISAPPEAR"];
    const definitions = new Map((animations as AnimationDefinition[]).map((item) => [item.id, item]));
    const summary = (state: PetState) => stateActionMap[state].map((id) => definitions.get(id)?.name ?? id).join(" / ");
    const modes: Array<[Settings["manualMode"], string, string]> = [
      ["auto", "自动", "自动识别切换"], ["dnd", "勿扰", "只安静陪伴"], ["rest", "休息", "进入休息动作"],
      ["low_battery", "低电量", "模拟低电量状态"], ["energy_saving", "节能", "降低动画开销"], ["manual", "临时状态", this.manualCountdownLabel()]
    ];
    return `<article class="card compact-card">${sectionHeading("陪伴模式", "选择持续的陪伴节奏；临时状态由下方状态卡触发")}<div class="mode-grid mode-grid-six">${modes.map(([value, label, description]) => `<button type="button" data-mode="${value}" class="choice-button mode-choice ${this.settings.manualMode === value ? "selected" : ""}"><span><b>${label}</b><small>${value === "manual" ? `<span data-live="manual-countdown">${description}</span>` : description}</small></span>${this.settings.manualMode === value ? icon("check") : ""}</button>`).join("")}</div></article><article class="card state-map-card">${sectionHeading("顶层状态与对应动作", "每张状态卡相当于一个动作组；标有“随机”的组会轮换播放其中一个动作")}<div class="state-list state-map-list">${states.map((state) => `<button type="button" data-state="${state}" class="list-choice ${this.runtime.state === state ? "selected" : ""}"><span><b>${this.stateDescription(state)}</b><small>${stateActionMap[state].length > 1 ? "随机：" : "动作："}${escapeHtml(summary(state))}</small></span>${this.runtime.state === state ? "<em>当前</em>" : icon("chevron")}</button>`).join("")}</div></article><article class="card">${sectionHeading("动作预览", "单击可立即播放；一次性动作结束后会自动回到待机")}<div class="action-list">${(animations as AnimationDefinition[]).map((action) => `<button type="button" data-action="${escapeHtml(action.id)}" class="list-choice"><span><b>${escapeHtml(action.name)}</b><small>${escapeHtml(action.id)} · ${action.frames} 帧 · ${action.playMode === "loop" ? "循环" : "单次"}</small></span>${icon("chevron")}</button>`).join("")}</div><button type="button" data-action="idle_breath" class="primary full">${buttonLabel("refresh", "停止并恢复自动")}</button></article>`;
  }

  private privacy(): string {
    const s=this.settings.sensing;
    const name=this.petName();
    const rows:Array<[keyof typeof s,string,string]>=[['foregroundApp','前台应用','识别当前应用类别与持续时间'],['windowTitle','窗口与文档标题','仅在内存中使用'],['keyboardMouse','键鼠活动频率','绝不保存键值或文本'],['clipboard','剪贴板文本','仅随主动 AI 请求读取'],['selectedText','当前选中文本','通过 UI Automation 尝试读取，不模拟复制'],['meeting','会议状态','识别会议应用并静默'],['microphone','麦克风占用','只判断是否占用，不录音'],['power','电源和电量','低电量时切换状态'],['network','网络状态','断网时使用本地回复']];
    return `${!this.settings.firstRunConsent?`<article class="consent"><div class="consent-icon">${icon('shield')}</div><div><span class="eyebrow">隐私优先</span><h2>在启用内容感知前，请确认</h2><p>${name}不会记录具体按键、不会录音、不会截图。窗口标题、选中文本与剪贴板不会写入磁盘，只在你主动对话时按设置发送。</p></div><button type="button" data-command="consent" class="primary">${buttonLabel('check','我了解并同意启用')}</button></article>`:''}
      <div class="two-col"><article class="card form-card">${sectionHeading('总开关','随时暂停或完全关闭本地感知')}${this.switcher("本地感知","enabled",s.enabled,"关闭后只保留基本动画和手动聊天",'sensing')}${this.switcher("自动附带当前上下文","autoContext",s.autoContext,"每次主动对话前展示并脱敏",'sensing')}<div class="button-cluster"><button type="button" data-command="pause-10">暂停 10 分钟</button><button type="button" data-command="pause-tomorrow">暂停到明天</button><button type="button" data-command="disable-sensing" class="danger-text">完全关闭</button></div></article>
      <article class="card">${sectionHeading('实时感知诊断','数据随系统活动实时更新')}<div class="health-list"><div class="health-row"><span>数据来源</span><b data-live="sensor-source">${this.sensorSourceName()}</b></div><div class="health-row"><span>前台应用</span><b class="truncate" data-live="foreground">${escapeHtml(this.foregroundLabel())}</b></div><div class="health-row"><span>键盘（1 秒 / 10 秒）</span><b><span data-live="keyboard-rate">${this.activity.keyboardCount1s}</span> / <span data-live="keyboard-10s">${this.activity.keyboardCount10s}</span></b></div><div class="health-row"><span>鼠标点击与滚轮（1 秒）</span><b data-live="mouse-rate">${this.activity.mouseClicks1s + this.activity.mouseWheel1s}</b></div><div class="health-row"><span>系统空闲</span><b data-live="idle-seconds">${this.activity.idleSeconds} 秒</b></div></div><p class="diagnostic-note">${icon('lock')}这里只展示次数和结构化状态。传感器不会读取键码、按键内容、音频或屏幕图像。</p></article></div>
      <article class="card">${sectionHeading('感知项目',`逐项决定${name}能够读取的结构化状态`)}<div class="permission-list">${rows.map(([k,l,d])=>this.switcher(l,k,Boolean(s[k]),d,'sensing')).join('')}</div></article>
      <div class="two-col"><article class="card form-card">${sectionHeading('内容黑名单','命中关键词时不读取上下文')}<textarea class="blacklist-input" data-list="blockedApps" placeholder="每行一个应用或标题关键词" aria-label="内容黑名单" spellcheck="false" autocapitalize="off">${escapeHtml(s.blockedApps.join('\n'))}</textarea></article><article class="card">${sectionHeading('上下文预览','发送给 AI 前可随时核对')}<pre class="context-preview">点击刷新查看当前将发送给 AI 的内容</pre><button type="button" data-command="context-preview" class="secondary full">${buttonLabel('eye','刷新预览')}</button></article></div>`;
  }

  private reminders(): string { const r=this.settings.reminders; return `<div class="two-col"><article class="card form-card">${sectionHeading('工作节奏','用温和提醒保持专注与休息平衡')}${this.number("专注时长","focusMinutes",r.focusMinutes,"分钟")}${this.number("休息时长","breakMinutes",r.breakMinutes,"分钟")}${this.number("饮水间隔","hydrationMinutes",r.hydrationMinutes,"分钟")}${this.number("主动陪伴冷却","proactiveCooldownMinutes",r.proactiveCooldownMinutes,"分钟")}${this.number("每日主动次数","proactiveDailyLimit",r.proactiveDailyLimit,"次")}</article><article class="card form-card">${sectionHeading('静默与启动','静默期间停止自动状态切换与主动打扰；手动聊天仍可使用')}${this.switcher("定时静默","scheduledSilent",r.scheduledSilent,"开启后，才会按下方时间进入静默",'reminder')}${this.timePicker("静默开始","quietStart",r.quietStart,!r.scheduledSilent)}${this.timePicker("静默结束","quietEnd",r.quietEnd,!r.scheduledSilent)}${this.switcher("会议时静默","meetingSilent",r.meetingSilent,"检测到会议时不主动打扰",'reminder')}${this.switcher("全屏时静默","fullscreenSilent",r.fullscreenSilent,"演示和视频时保持安静",'reminder')}${this.switcher("Windows 自启动","autostart",r.autostart,"登录后延迟显示",'reminder')}${this.number("启动延迟","startupDelaySeconds",r.startupDelaySeconds,"秒")}</article></div>`; }

  private ai(): string {
    const a=this.settings.ai, used=this.monthlyAiUsage(), remaining=Math.max(0,a.monthlyLimit-used);
    return `<div class="two-col"><article class="card form-card ai-config-card">${sectionHeading('DeepSeek API 配置','配置 API Key 后才可使用在线智能对话')}<label><span class="field-label">DeepSeek API 地址</span><div class="locked-url-row"><input data-base-url readonly value="${escapeHtml(a.baseUrl)}" spellcheck="false" aria-label="DeepSeek API 地址"><button type="button" data-command="edit-base-url" class="field-edit-button" aria-label="编辑 DeepSeek API 地址" title="编辑 API 地址">${buttonLabel('edit','编辑')}</button></div><small class="field-help">默认使用 DeepSeek 官方接口。为防止误触，只有点击“编辑”后才能修改。</small></label>${this.select("模型","model",a.model,[["deepseek-v4-flash","V4 Flash · 快速"],["deepseek-v4-pro","V4 Pro · 高质量"]],"ai")}<label><span class="field-label">API Key</span><div class="secret-row"><input type="password" class="api-key" placeholder="输入 DeepSeek API Key 后安全保存" autocomplete="off"><button type="button" data-command="save-key" class="secondary">${buttonLabel('key','安全保存')}</button></div></label>${this.number("月度调用上限","monthlyLimit",a.monthlyLimit,"次",'ai')}<button type="button" data-command="test-ai" class="primary full">${buttonLabel('activity','测试连接')}</button><p class="connection-result inline-result" aria-live="polite"></p></article><article class="card form-card">${sectionHeading('对话与问候','控制推理、上下文和桌面气泡文案')}${this.switcher("AI 智能问候文案","smartCompanionSpeech",a.smartCompanionSpeech,"开启且 API 可用时批量生成临时、不重复的点击与主动问候；否则使用内置文案",'ai')}${this.switcher("深度思考","deepThinking",a.deepThinking,"复杂任务使用更强推理",'ai')}${this.switcher("自动附带当前上下文","includeContext",a.includeContext,"遵循感知页的黑名单和脱敏规则",'ai')}<div class="ai-quota"><div>${icon('brain')}<span><b>本月调用上限</b><small>已用 ${this.compactCount(used)} 次 · 剩余 ${this.compactCount(remaining)} 次</small></span></div><strong>${this.compactCount(a.monthlyLimit)} 次</strong></div><button type="button" data-command="clear-chats" class="danger-text full">${buttonLabel('trash','清空本地聊天历史')}</button></article></div><article class="card permission-card">${sectionHeading('工具权限','每项下拉框直接控制对应工具的执行方式')}<div class="permission-explainer">${icon('shield')}<div><b>这两个权限确实参与执行</b><p>“每次询问”会在工具真正调用时弹出确认；“直接允许”跳过该次确认；“禁止使用”会在执行层直接拒绝。</p></div></div><div class="permission-controls">${this.permissionControl('打开网页','open_url',a.toolPermissions.open_url,'仅允许打开 HTTP/HTTPS 链接')}${this.permissionControl('读取当前上下文','read_current_context',a.toolPermissions.read_current_context,'仅返回已脱敏的临时上下文')}<div class="permission-control locked"><div><b>启动应用</b><small>应用白名单尚未配置，因此执行层固定拒绝</small></div><span>${icon('lock')} 暂未开放</span></div></div><div class="fixed-policy"><b>固定安全策略</b><p><span><i class="permission-dot safe"></i>提醒、计时器、动作、通知和打开控制台可直接执行</span><span><i class="permission-dot never"></i>Shell、任意命令、文件写入与删除永不开放</span></p></div></article>`;
  }

  private statistics(): string {
    const days=this.stats?.days??[];
    const max=Math.max(1,...days.map(d=>d.activeSeconds));
    const total=days.reduce((result,day)=>({active:result.active+day.activeSeconds,focus:result.focus+day.focusSeconds,input:result.input+day.inputEvents,switches:result.switches+day.appSwitches,ai:result.ai+day.aiCalls,local:result.local+day.localReplies}),{active:0,focus:0,input:0,switches:0,ai:0,local:0});
    const categoryTotals=days.reduce<Record<string,number>>((result,day)=>{for(const [key,value] of Object.entries(day.categories))result[key]=(result[key]??0)+Number(value);return result},{});
    const rangeLabel=this.statsRange===1?'今天':`近 ${this.statsRange} 天`;
    const refreshAction=`<button type="button" data-command="refresh-stats">${buttonLabel('refresh','刷新')}</button>`;
    return `<article class="card stats-toolbar"><div>${sectionHeading('统计范围','活跃时间按每秒去重；输入事件只累计次数，不保存内容')}</div><div class="range-tabs" role="group" aria-label="统计范围">${[1,3,7,30].map(value=>`<button type="button" data-stats-range="${value}" class="${this.statsRange===value?'selected':''}" aria-pressed="${this.statsRange===value}">${value===1?'今天':`${value} 天`}</button>`).join('')}</div></article>
      <div class="metric-grid">${this.metric('activity',`${rangeLabel}活跃`,this.duration(total.active),'系统空闲小于 60 秒')}${this.metric('clock',`${rangeLabel}专注`,this.duration(total.focus),'设计 / 办公 / 开发')}${this.metric('keyboard','输入事件',`${this.compactCount(total.input)} 次`,'键盘、点击与滚轮次数')}${this.metric('refresh','应用切换',`${this.compactCount(total.switches)} 次`,'前台进程变化')}</div>
      <article class="card chart-card">${sectionHeading(`${rangeLabel}活跃趋势`,'每天的聚合活跃时长；悬浮柱状图查看详情',refreshAction)}<div class="chart-grid-lines" aria-hidden="true"><i></i><i></i><i></i></div><div class="bar-chart ${days.length>14?'dense':''}" role="img" aria-label="${rangeLabel}活跃趋势柱状图">${days.length?days.map(d=>{const height=d.activeSeconds?Math.max(3,d.activeSeconds/max*100):0;return `<div class="chart-column" tabindex="0" style="--bar-height:${height}%"><span class="chart-tooltip"><b>${escapeHtml(d.date)}</b><small>活跃 ${this.duration(d.activeSeconds)}</small><small>专注 ${this.duration(d.focusSeconds)} · 输入 ${this.compactCount(d.inputEvents)}</small></span><i></i><small class="chart-date">${escapeHtml(d.date.slice(5))}</small></div>`}).join(''):`<div class="empty-chart">${icon('chart')}<b>暂无统计数据</b><small>使用一段时间后，趋势会显示在这里</small></div>`}</div></article>
      <div class="two-col"><article class="card">${sectionHeading(`${rangeLabel}应用类别`,'根据进程名与窗口标题实时归类，新产生的数据会进入对应类别')}<div class="category-bars">${statisticCategories.map(key=>{const value=categoryTotals[key]??0,percent=Math.min(100,value/Math.max(1,total.active)*100);return `<div class="category-row"><span class="category-name">${escapeHtml(this.categoryName(key))}</span><span class="bar-track" tabindex="0"><i style="width:${percent}%"></i><span class="category-tooltip">${this.duration(value)} · 占活跃 ${percent.toFixed(1)}%</span></span><b>${this.duration(value)}</b></div>`}).join('')}</div></article><article class="card">${sectionHeading('陪伴与 AI','本地与在线回复概况')}<div class="health-list"><div class="health-row"><span>AI 调用</span><b>${this.compactCount(total.ai)} 次</b></div><div class="health-row"><span>本地降级回复</span><b>${this.compactCount(total.local)} 次</b></div><div class="health-row"><span>当前应用识别</span><b>${escapeHtml(this.categoryName(this.activity.appCategory))}</b></div><div class="health-row"><span>统计最后刷新</span><b>${new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</b></div></div></article></div>`;
  }

  private storage(): string {
    const currentDirectory=this.settings.dataDirectory;
    return `<div class="two-col"><article class="card form-card">${sectionHeading('数据位置','管理聚合统计与聊天记录的本地目录')}<label><span class="field-label">当前目录</span><div class="read-only-field">${icon('folder')}<input readonly value="${escapeHtml(currentDirectory)}" title="${escapeHtml(currentDirectory)}"></div></label><p class="info-note">${icon('shield')}迁移会复制并校验数据，成功后删除旧目录，最终只保留一个数据位置。其他电脑首次安装会自动使用各自 Windows 账户的应用数据目录，不会继承开发电脑的路径。</p><button type="button" data-command="choose-directory" class="primary full">${buttonLabel('folder','选择新的存储文件夹')}</button></article><article class="card">${sectionHeading('数据保留','每日聚合默认保留 90 天')}<p class="storage-summary">窗口标题、剪贴板和选中文本不会写入磁盘。API Key 留在 Windows DPAPI 加密存储中。下方操作无法撤销，执行前会再次确认。</p><div class="danger-zone"><button type="button" data-command="clear-stats">${buttonLabel('trash','清空统计')}<small>删除全部本地聚合统计</small></button><button type="button" data-command="clear-chats">${buttonLabel('trash','清空聊天')}<small>删除全部本地聊天记录</small></button><button type="button" data-command="reset-all" class="danger">${buttonLabel('rotate','恢复全部默认设置')}<small>清空数据并重置所有偏好</small></button></div></article></div>`;
  }

  private updatesPage():string{
    const status=this.updateStatus;
    const label=this.updateLabel();
    const stateClass=this.updateStateClass();
    return `<article class="about-update-hero" data-update-phase="${status.phase}"><div class="version-orb"><span data-update-current>v${escapeHtml(status.currentVersion)}</span><small>Windows</small></div><div class="update-hero-copy"><span class="eyebrow">${this.petName()}桌宠 · 正式发布通道</span><h2 data-update-heading>${escapeHtml(this.updateHeadline())}</h2><p>通过公开 GitHub Releases 检查更新。自动检查只读取版本信息，不会上传设置、聊天、统计或 API Key。</p><div class="update-actions"><span data-update-primary-action>${this.updatePrimaryAction()}</span><button type="button" data-command="open-release-page" class="secondary">${buttonLabel('external','打开官方发布页')}</button></div></div><span class="update-state-pill ${stateClass}" data-update-state>${escapeHtml(label)}</span></article>
      <article class="card update-card"><div class="update-summary"><div><span>当前版本</span><b data-update-current>v${escapeHtml(status.currentVersion)}</b></div><div><span>可用版本</span><b data-update-available>${status.availableVersion?`v${escapeHtml(status.availableVersion)}`:'—'}</b></div><div><span>更新状态</span><b data-update-label>${escapeHtml(label)}</b></div></div><div class="update-progress" aria-label="更新下载进度"><i data-update-progress style="width:${status.downloadPercent}%"></i></div><p class="update-message" data-update-message>${escapeHtml(status.message)}</p></article>
      <div class="about-grid"><article class="card about-card"><div class="about-icon">${icon('shield')}</div><h3>隐私承诺</h3><ul><li>不记录具体按键，不录音，也不截图。</li><li>窗口标题、选中文本和剪贴板不会写入磁盘，只按你的设置临时用于主动对话。</li><li>API Key 由当前 Windows 账户的 DPAPI 加密保存；更新检查不会读取它。</li></ul><button type="button" data-tab="privacy" class="text-link">查看感知与隐私设置 ${icon('chevron')}</button></article><article class="card about-card"><div class="about-icon">${icon('refresh')}</div><h3>覆盖安装与数据</h3><ul><li>安装器使用固定应用标识 <code>com.qpet.ai</code>，会识别已有安装并原位升级。</li><li>升级不会删除设置、聊天、统计或你选择的数据目录。</li><li>完整卸载会按安全标记清理应用数据；手动迁移成功后会删除旧目录。</li></ul><p class="release-note">从发布页手动下载更高版本安装包并运行，也会覆盖当前安装。请勿修改应用标识。</p></article><article class="card about-card"><div class="about-icon">${icon('heart')}</div><h3>关于${this.petName()}桌宠</h3><p>一款面向 Windows 10/11 的轻量、隐私可控桌面陪伴工具。AI 对话使用 DeepSeek 接口，需要自行配置 API Key；其余陪伴与本地统计可独立使用。</p><dl><div><dt>当前版本</dt><dd>v${escapeHtml(status.currentVersion)}</dd></div><div><dt>发布渠道</dt><dd>公开 GitHub Releases</dd></div></dl><button type="button" data-command="show-onboarding" class="text-link">重新查看首次使用指引 ${icon('chevron')}</button></article></div>
      <article class="card copyright-statement"><div class="copyright-heading"><div class="about-icon">${icon('lock')}</div><div><span class="eyebrow">原创成果与发布归属</span><h3>珊珊桌宠版权声明</h3></div></div><p>“珊珊桌宠”由开发者浩涵设计、开发并持续发布。软件程序、界面设计、角色表现、动画素材、文字内容、安装包及相关发布成果，在适用法律允许范围内的著作权及相关权益归浩涵所有。</p><p>未经开发者浩涵书面许可，不得擅自复制、修改、再发布、出售、冒用官方名义或将本项目成果用于未经授权的商业用途。通过 <code>haohan-liu/mengchong-exe</code> 发布的版本为本项目官方发布渠道。</p><div class="copyright-meta"><span><small>开发者</small><b>浩涵</b></span><span><small>项目名称</small><b>珊珊桌宠</b></span><span><small>版权标识</small><b>© 2026 浩涵</b></span><span><small>权利声明</small><b>保留所有权利</b></span></div><small class="third-party-note">本项目使用的第三方开源组件仍分别遵循其各自许可证与版权声明。</small></article>`;
  }

  private onboarding():string{
    if(!this.onboardingOpen)return '';
    const firstRun=!this.settings.firstRunConsent;
    const steps=[
      {icon:'heart' as IconName,kicker:'快速认识',title:`欢迎使用${this.petNameText()}`,body:`${this.petNameText()}会常驻桌面。拖动可调整位置，点击可以互动；右键桌宠或使用托盘菜单，可以打开聊天、控制台以及退出程序。`},
      {icon:'shield' as IconName,kicker:'隐私确认',title:'本地感知由你决定',body:'它只读取工作节奏等结构化活动信号，不读取具体按键、不录音、不截图。你可以现在开启，也可以保持关闭后再到“感知与隐私”逐项设置。'},
      {icon:'brain' as IconName,kicker:'智能对话',title:'对话功能使用 DeepSeek 接口',body:'在线智能对话需要你自己的 DeepSeek API Key。进入“智能体 API”页面安全保存 Key 并测试连接后，才能正常使用 DeepSeek 对话；Key 会由当前 Windows 账户加密保存。'},
      {icon:'check' as IconName,kicker:'准备完成',title:'现在可以开始使用了',body:'本地陪伴、动作与统计可以直接使用；DeepSeek 对话、隐私范围和更新入口都可以随时在控制台中调整。'}
    ];
    const step=steps[this.onboardingStep]??steps[0]!;
    let primaryActions='';
    if(this.onboardingStep===0)primaryActions='<button type="button" data-onboarding-next class="tour-primary">开始了解</button>';
    if(this.onboardingStep===1)primaryActions='<button type="button" data-command="onboarding-private" class="tour-secondary">暂不开启</button><button type="button" data-command="onboarding-enable" class="tour-primary">同意并开启</button>';
    if(this.onboardingStep===2)primaryActions='<button type="button" data-command="onboarding-ai-later" class="tour-secondary">稍后配置</button><button type="button" data-command="onboarding-open-ai" class="tour-primary">去配置 API Key</button>';
    if(this.onboardingStep===3)primaryActions='<button type="button" data-command="finish-onboarding" class="tour-primary">进入控制台</button>';
    return `<div class="tour-mask tour-step-${this.onboardingStep}" data-onboarding role="dialog" aria-modal="true" aria-labelledby="onboarding-title"><div class="tour-spotlight" aria-hidden="true"></div><section class="tour-card"><header><span class="tour-icon">${icon(step.icon)}</span><div><span class="eyebrow">${escapeHtml(step.kicker)}</span><h2 id="onboarding-title">${escapeHtml(step.title)}</h2></div><span class="tour-count">${this.onboardingStep+1} / ${steps.length}</span></header><p>${escapeHtml(step.body)}</p>${this.onboardingStep===2?'<div class="tour-api-note"><b>需要准备</b><span>DeepSeek API Key</span><small>默认接口：https://api.deepseek.com</small></div>':''}<footer>${!firstRun?'<button type="button" data-onboarding-close class="tour-quiet">关闭指引</button>':''}${this.onboardingStep>0?'<button type="button" data-onboarding-prev class="tour-quiet">上一步</button>':''}<span class="tour-action-group">${primaryActions}</span></footer><div class="tour-progress">${steps.map((_,index)=>`<i class="${index<=this.onboardingStep?'active':''}"></i>`).join('')}</div></section></div>`;
  }

  private updateLabel():string{return ({disabled:'仅正式安装版启用',idle:'等待检查',checking:'正在检查',"up-to-date":'已是最新版本',available:'发现新版本',downloading:'正在下载',downloaded:'等待重启安装',error:'检查失败'} as Record<UpdateStatus['phase'],string>)[this.updateStatus.phase]}
  private updateHeadline():string{return this.updateStatus.phase==='available'||this.updateStatus.phase==='downloaded'?'发现可以安装的新版本':'让每次升级都清楚、可控'}
  private updateStateClass():string{return this.updateStatus.phase==='available'||this.updateStatus.phase==='downloaded'?'attention':this.updateStatus.phase==='error'?'error':'ok'}
  private updatePrimaryAction():string{
    const status=this.updateStatus;
    if(status.phase==='disabled')return `<button type="button" disabled>${buttonLabel('refresh','正式安装版可用')}</button>`;
    if(status.phase==='checking')return `<button type="button" disabled>${buttonLabel('refresh','正在检查')}</button>`;
    if(status.phase==='available')return `<button type="button" data-command="download-update" class="primary">${buttonLabel('refresh','下载新版本')}</button>`;
    if(status.phase==='downloading')return `<button type="button" disabled>${buttonLabel('refresh',`下载 ${Math.round(status.downloadPercent)}%`)}</button>`;
    if(status.phase==='downloaded')return `<button type="button" data-command="install-update" class="primary">${buttonLabel('refresh','立即重启安装')}</button>`;
    return `<button type="button" data-command="check-update" class="secondary">${buttonLabel('refresh','检查更新')}</button>`;
  }

  // 更新状态只修改当前页面中的文字、按钮和进度，不重新渲染整个控制台。
  // 这样从“正在检查”切换到“检查结果”时不会出现两次整页闪烁。
  private syncUpdatePanel():void{
    const status=this.updateStatus,label=this.updateLabel();
    const hero=this.root.querySelector<HTMLElement>('[data-update-phase]');
    if(!hero)return;
    hero.dataset.updatePhase=status.phase;
    this.root.querySelectorAll<HTMLElement>('[data-update-current]').forEach(el=>el.textContent=`v${status.currentVersion}`);
    const available=this.root.querySelector<HTMLElement>('[data-update-available]');
    if(available)available.textContent=status.availableVersion?`v${status.availableVersion}`:'—';
    const heading=this.root.querySelector<HTMLElement>('[data-update-heading]');
    if(heading)heading.textContent=this.updateHeadline();
    const state=this.root.querySelector<HTMLElement>('[data-update-state]');
    if(state){state.textContent=label;state.className=`update-state-pill ${this.updateStateClass()}`}
    const labelTarget=this.root.querySelector<HTMLElement>('[data-update-label]');
    if(labelTarget)labelTarget.textContent=label;
    const progress=this.root.querySelector<HTMLElement>('[data-update-progress]');
    const message=this.root.querySelector<HTMLElement>('[data-update-message]');
    if(progress)progress.style.width=`${status.downloadPercent}%`;
    if(message)message.textContent=status.message;
    const actionSlot=this.root.querySelector<HTMLElement>('[data-update-primary-action]');
    if(actionSlot){
      actionSlot.innerHTML=this.updatePrimaryAction();
      const button=actionSlot.querySelector<HTMLButtonElement>('[data-command]');
      button?.addEventListener('click',()=>void this.withBusy(button,()=>this.command(button.dataset.command!)));
    }
    this.syncUpdateAttention();
  }

  private syncUpdateAttention():void{
    const button=this.root.querySelector<HTMLButtonElement>('[data-tab="updates"]');
    if(!button)return;
    const attention=this.updateStatus.phase==='available'||this.updateStatus.phase==='downloaded';
    const existing=button.querySelector('.nav-update-dot');
    if(attention&&!existing)button.querySelector('.nav-chevron')?.insertAdjacentHTML('beforebegin','<i class="nav-update-dot" aria-label="有可用更新"></i>');
    if(!attention)existing?.remove();
  }

  private metric(iconName:IconName,label:string,value:string,description:string):string{return `<article class="metric-card"><div class="metric-icon">${icon(iconName)}</div><div><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b><small>${escapeHtml(description)}</small></div></article>`}
  private petNameText():string{return this.settings.petName?.trim()||'珊珊'}
  private petName():string{return escapeHtml(this.petNameText())}
  private petNameInitial():string{return escapeHtml(Array.from(this.petNameText())[0]??'珊')}
  private range(label:string,key:string,value:number,min:number,max:number,step:number,text:string):string{return `<label class="field-group"><span class="field-label">${escapeHtml(label)}</span><div class="range-row"><input type="range" data-appearance="${escapeHtml(key)}" value="${value}" min="${min}" max="${max}" step="${step}" aria-label="${escapeHtml(label)}"><output>${escapeHtml(text)}</output></div></label>`}
  private number(label:string,key:string,value:number,unit:string,scope='reminder'):string{return `<label class="field-group"><span class="field-label">${escapeHtml(label)}</span><div class="number-row"><input type="number" data-${scope}="${escapeHtml(key)}" value="${value}" min="0"><span>${escapeHtml(unit)}</span></div></label>`}
  private select(label:string,key:string,value:string,options:string[][],scope='appearance'):string {
    const section=scope==='reminder'?'reminders':scope;
    return `<div class="field-group"><span class="field-label">${escapeHtml(label)}</span>${this.selectControl(section,key,value,options,`${label}选项`)}</div>`;
  }
  private selectControl(section:string,key:string,value:string,options:string[][],ariaLabel:string):string {
    const selected=options.find(([option])=>option===value)?.[1]??value;
    return `<div class="custom-select" data-custom-select><button type="button" class="custom-select-trigger" aria-haspopup="listbox" aria-expanded="false" aria-label="${escapeHtml(ariaLabel)}"><span>${escapeHtml(selected)}</span>${icon('chevron')}</button><div class="custom-select-menu popover-panel" role="listbox" hidden>${options.map(([option,label])=>`<button type="button" role="option" aria-selected="${option===value}" class="custom-select-option ${option===value?'selected':''}" data-select-section="${escapeHtml(section)}" data-select-key="${escapeHtml(key)}" data-select-value="${escapeHtml(option)}"><span>${escapeHtml(label)}</span>${option===value?icon('check'):''}</button>`).join('')}</div></div>`;
  }
  private switcher(label:string,key:string,value:boolean,description:string,scope='appearance'):string {
    const section=scope==='reminder'?'reminders':scope;
    return `<div class="switch-row"><span><b>${escapeHtml(label)}</b><small>${escapeHtml(description)}</small></span><button type="button" class="switch-control ${value?'checked':''}" role="switch" aria-checked="${value}" aria-label="${escapeHtml(label)}" data-switch-section="${escapeHtml(section)}" data-switch-key="${escapeHtml(key)}"><i aria-hidden="true"></i></button></div>`;
  }
  private permissionControl(label:string,key:'open_url'|'read_current_context',value:'ask'|'allow'|'deny',description:string):string {
    const state=({ask:'每次询问',allow:'直接允许',deny:'禁止使用'} as const)[value];
    return `<div class="permission-control"><div class="permission-title"><b>${escapeHtml(label)}</b><em class="permission-state state-${value}">${state}</em><small>${escapeHtml(description)}</small></div>${this.selectControl('tool',key,value,[["ask","每次询问（推荐）"],["allow","直接允许"],["deny","禁止使用"]],`${label}权限`)}</div>`;
  }
  private timePicker(label:string,key:string,value:string,disabled=false):string {
    const match=/^(\d{2}):(\d{2})$/.exec(value), hour=match?.[1]??'00', minute=match?.[2]??'00';
    const column=(part:'hour'|'minute',selected:string,count:number)=>`<div class="time-column" role="listbox" aria-label="${part==='hour'?'小时':'分钟'}">${Array.from({length:count},(_,index)=>String(index).padStart(2,'0')).map(option=>`<button type="button" role="option" aria-selected="${option===selected}" class="time-option ${option===selected?'selected':''}" data-time-part="${part}" data-time-value="${option}">${option}</button>`).join('')}</div>`;
    return `<div class="field-group time-picker ${disabled?'is-disabled':''}" data-time-key="${escapeHtml(key)}" data-hour="${hour}" data-minute="${minute}"><span class="field-label">${escapeHtml(label)}</span><button type="button" class="time-picker-trigger" aria-haspopup="dialog" aria-expanded="false" ${disabled?'disabled aria-disabled="true"':''}><span data-time-preview>${hour}:${minute}</span>${icon('clock')}</button><div class="time-picker-panel popover-panel" role="dialog" aria-label="${escapeHtml(label)}" hidden><div class="time-picker-head"><b>${escapeHtml(label)}</b><span><i>${hour}</i>:<i>${minute}</i></span></div><div class="time-columns">${column('hour',hour,24)}<div class="time-divider">:</div>${column('minute',minute,60)}</div><div class="time-picker-actions"><button type="button" data-time-cancel>取消</button><button type="button" data-time-apply class="primary">完成</button></div></div></div>`;
  }
  private colorPicker():string {
    const a=this.settings.appearance,color=safeAccent(a.accentColor).toLowerCase(),[h,s,l]=hexToHsl(color);
    const swatches=(values:ReadonlyArray<readonly [string,string]>,kind:string)=>values.map(([label,value])=>`<button type="button" class="color-swatch ${value.toLowerCase()===color?'selected':''}" data-color-value="${value}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)} ${value}" style="--swatch:${value}">${value.toLowerCase()===color?icon('check'):''}</button>`).join('')||`<span class="color-empty">还没有最近使用色</span>`;
    const recent=(a.recentAccentColors??[]).map((value,index)=>[`最近 ${index+1}`,safeAccent(value)] as const);
    return `<div class="color-row color-picker"><span><b>强调色</b><small>用于按钮、选中态与图表</small></span><button type="button" class="color-picker-trigger" aria-haspopup="dialog" aria-expanded="false"><i style="--swatch:${color}"></i><span data-accent-label>${color.toUpperCase()}</span>${icon('chevron')}</button><div class="color-picker-panel popover-panel" role="dialog" aria-label="强调色色板" data-preview-color="${color}" hidden><div class="color-panel-head"><div><b>强调色色板</b><small>推荐配色与自定义颜色</small></div><i class="color-preview" style="--swatch:${color}"></i></div><section><b>推荐配色</b><div class="color-swatches">${swatches(recommendedAccents,'recommended')}</div></section><section><b>最近使用</b><div class="color-swatches recent-swatches">${swatches(recent,'recent')}</div></section><section class="color-custom"><div class="hex-row"><label for="accent-hex">HEX</label><input id="accent-hex" data-color-hex value="${color.toUpperCase()}" maxlength="7" spellcheck="false"></div>${[['色相','hue',h,359],['饱和度','saturation',s,100],['明度','lightness',l,100]].map(([label,key,current,max])=>`<label><span>${label}</span><input type="range" data-color-channel="${key}" value="${current}" min="0" max="${max}" step="1"><output>${current}${key==='hue'?'°':'%'}</output></label>`).join('')}</section><div class="color-panel-actions"><button type="button" data-color-cancel>取消</button><button type="button" data-color-apply class="primary">应用颜色</button></div></div></div>`;
  }
  private duration(seconds:number):string{return formatDuration(seconds)}
  private compactCount(value:number):string{return formatCount(value)}
  private monthlyAiUsage():number { const now=new Date(),month=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;return (this.stats?.days??[]).filter(day=>day.date.startsWith(month)).reduce((sum,day)=>sum+day.aiCalls,0) }
  private modeLabel():string{return ({auto:'陪伴中',dnd:'勿扰中',rest:'休息中',energy_saving:'节能中',low_battery:'低电量模拟',manual:'临时状态'} as Record<string,string>)[this.settings.manualMode]??'陪伴中'}
  private modeHeadline():string{const name=this.petName();return ({auto:`${name}正在你身边`,dnd:`${name}正在安静陪伴`,rest:`${name}正在休息`,energy_saving:`${name}已进入节能模式`,low_battery:`${name}正在模拟低电量`,manual:`${name}正在体验临时状态`} as Record<string,string>)[this.settings.manualMode]??`${name}正在你身边`}
  private stateDescription(s:PetState):string{return ({BOOT:'启动',APPEAR:'出现',IDLE:'待机',LISTENING:'倾听',USER_TYPING:'输入',THINKING:'思考',RESPONDING:'回答',SUCCESS:'成功',ERROR:'错误',OFFLINE:'离线',LOW_BATTERY:'低电量',SLEEP:'睡眠',DRAGGING:'拖拽',REACTION:'互动',DISAPPEAR:'离开'} as Record<string,string>)[s] ?? s}

  private startShowcaseAnimation(): void {
    const image = this.root.querySelector<HTMLImageElement>('[data-showcase-pet]');
    if (!image) return;
    let frame = 0;
    this.showcaseTimer = window.setInterval(() => {
      frame = (frame + 1) % 8;
      image.src = `./sprites/idle_breath/idle_breath_${String(frame).padStart(3, '0')}.png`;
    }, 125);
  }

  private syncStateSelection(selected?: HTMLButtonElement): void {
    const selectedState=selected?.dataset.state ?? this.runtime.state;
    this.root.querySelectorAll<HTMLButtonElement>("[data-state]").forEach((button) => {
      const current = button.dataset.state === selectedState;
      button.classList.toggle("selected", current);
      button.querySelector("em")?.remove();
      if (current) {
        button.querySelector(".ui-icon")?.remove();
        const badge = document.createElement("em");
        badge.textContent = "当前";
        button.append(badge);
      }
    });
    this.syncModeSelection();
  }

  private syncScheduledSilentControls(enabled: boolean): void {
    this.root.querySelectorAll<HTMLElement>('[data-time-key="quietStart"], [data-time-key="quietEnd"]').forEach((picker) => {
      picker.classList.toggle('is-disabled', !enabled);
      const trigger = picker.querySelector<HTMLButtonElement>('.time-picker-trigger');
      if (trigger) {
        trigger.disabled = !enabled;
        trigger.setAttribute('aria-disabled', String(!enabled));
        if (!enabled) trigger.setAttribute('aria-expanded', 'false');
      }
      if (!enabled) {
        const panel = picker.querySelector<HTMLElement>('.time-picker-panel');
        if (panel) panel.hidden = true;
      }
    });
  }

  private bind(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(el=>el.addEventListener("click",()=>void this.withBusy(el,()=>this.openTab(el.dataset.tab!))));
    this.root.querySelector(".close-window")?.addEventListener("click",()=>void window.petAPI.console.close());
    this.root.querySelector<HTMLButtonElement>('[data-onboarding-next]')?.addEventListener('click',()=>{this.onboardingStep=Math.min(3,this.onboardingStep+1);this.render()});
    this.root.querySelector<HTMLButtonElement>('[data-onboarding-prev]')?.addEventListener('click',()=>{this.onboardingStep=Math.max(0,this.onboardingStep-1);this.render()});
    this.root.querySelector<HTMLButtonElement>('[data-onboarding-close]')?.addEventListener('click',()=>{this.onboardingOpen=false;this.render(true)});
    this.root.querySelectorAll<HTMLInputElement>("[data-appearance]").forEach(el=>{
      const update=async()=>{await this.updateNested('appearance',el.dataset.appearance!,this.value(el));this.notify('外观设置已保存')};
      if(el instanceof HTMLInputElement&&el.type==='range')el.addEventListener('input',()=>{
        const key=el.dataset.appearance!,value=Number(el.value);
        (this.settings.appearance as unknown as Record<string,unknown>)[key]=value;
        const output=el.closest('.range-row')?.querySelector<HTMLOutputElement>('output');
        if(output)output.value=this.rangeOutput(key,value);
        if(key==='scale'||key==='bubbleScale')window.petAPI.pet.previewScale(this.settings.appearance.scale,this.settings.appearance.bubbleScale);
        window.clearTimeout(this.rangeSaveTimer);
        this.rangeSaveTimer=window.setTimeout(()=>void this.save().then(()=>this.notify('外观设置已保存')),220);
      });
      else el.addEventListener("change",()=>void update());
    });
    this.root.querySelectorAll<HTMLInputElement>("[data-reminder]").forEach(el=>el.addEventListener("change",()=>void this.updateNested('reminders',el.dataset.reminder!,this.value(el)).then(()=>this.notify('提醒设置已保存'))));
    this.root.querySelectorAll<HTMLInputElement>("[data-ai]").forEach(el=>el.addEventListener("change",()=>void this.updateNested('ai',el.dataset.ai!,this.value(el)).then(()=>this.notify('智能体设置已保存'))));
    this.root.querySelectorAll<HTMLButtonElement>("[data-switch-section]").forEach(el=>el.addEventListener("click",()=>void this.withBusy(el,async()=>{
      const section=el.dataset.switchSection as 'appearance'|'sensing'|'reminders'|'ai',key=el.dataset.switchKey!,next=el.getAttribute('aria-checked')!=='true';
      await this.updateNested(section,key,next);
      if(section==='sensing'&&key==='enabled'&&next)await this.resumeSensing();
      this.runtime=await window.petAPI.pet.getRuntime();
      el.classList.toggle('checked',next);
      el.setAttribute('aria-checked',String(next));
      if(section==='reminders'&&key==='scheduledSilent')this.syncScheduledSilentControls(next);
      this.updateLiveValues();
      this.notify(`${el.getAttribute('aria-label')??'开关'}已${next?'开启':'关闭'}`);
    })));
    this.root.querySelectorAll<HTMLButtonElement>(".custom-select-trigger").forEach(el=>el.addEventListener("click",()=>{
      const control=el.closest<HTMLElement>('.custom-select'),panel=control?.querySelector<HTMLElement>('.custom-select-menu');
      if(!control||!panel)return;
      const open=panel.hidden;
      this.closePopovers(control);
      panel.hidden=!open;
      el.setAttribute('aria-expanded',String(open));
    }));
    this.root.querySelectorAll<HTMLButtonElement>("[data-select-value]").forEach(el=>el.addEventListener("click",()=>void this.withBusy(el,async()=>{
      const section=el.dataset.selectSection!,key=el.dataset.selectKey!,value=el.dataset.selectValue!;
      if(section==='tool'){
        this.settings.ai.toolPermissions[key as 'open_url'|'read_current_context']=value as 'ask'|'allow'|'deny';
        await this.save();
        this.render(true);
        this.notify('工具权限已更新并立即生效');
        return;
      }
      if(section==='appearance'||section==='sensing'||section==='reminders'||section==='ai')await this.updateNested(section,key,value);
      this.render(true);
      this.notify('选项已更新');
    })));
    this.root.querySelectorAll<HTMLButtonElement>("[data-theme]").forEach(el=>el.addEventListener("click",()=>void this.withBusy(el,async()=>{await this.updateNested('appearance','theme',el.dataset.theme!);this.render(true);this.notify('控制台主题已更新')})));
    this.root.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(el=>el.addEventListener("click",()=>void this.withBusy(el,async()=>{const mode=el.dataset.mode as Settings['manualMode'];this.settings.manualMode=mode;if(mode==='manual'){this.settings.manualState=this.runtime.state;this.settings.manualUntil=Date.now()+30_000}else{this.settings.manualState=null;this.settings.manualUntil=null}await this.save();this.runtime=await window.petAPI.pet.getRuntime();this.syncModeSelection();this.syncManualCountdown();this.updateLiveValues();this.notify('陪伴模式已切换')})));
    this.root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach(el=>el.addEventListener("click",()=>void this.withBusy(el,async()=>{const ok=await window.petAPI.pet.setAction(el.dataset.action!);this.runtime=await window.petAPI.pet.getRuntime();this.notify(ok?'动作已发送给桌宠':'动作资源不可用',!ok)})));
    this.root.querySelectorAll<HTMLButtonElement>("[data-state]").forEach(el=>el.addEventListener("click",()=>void this.withBusy(el,async()=>{const ok=await window.petAPI.pet.setState(el.dataset.state!);this.runtime=await window.petAPI.pet.getRuntime();if(ok)this.syncStateSelection(el);this.updateLiveValues();this.notify(ok?'状态与对应动作已触发，将保持 30 秒':'状态不可用',!ok)})));
    this.root.querySelectorAll<HTMLButtonElement>("[data-command]").forEach(el=>el.addEventListener("click",()=>void this.withBusy(el,()=>this.command(el.dataset.command!))));
    this.root.querySelectorAll<HTMLButtonElement>("[data-stats-range]").forEach(el=>el.addEventListener("click",()=>void this.withBusy(el,async()=>{this.statsRange=Number(el.dataset.statsRange)||30;await this.refreshStatistics(true)})));
    const nameInput=this.root.querySelector<HTMLInputElement>('[data-pet-name]');
    nameInput?.addEventListener('input',()=>{const value=nameInput.value.trim();const initial=this.root.querySelector<HTMLElement>('.name-preview-mark');if(initial)initial.textContent=Array.from(value)[0]??'珊'});
    nameInput?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();this.root.querySelector<HTMLButtonElement>('[data-command="save-name"]')?.click()}});
    this.root.querySelector<HTMLInputElement>('[data-base-url]')?.addEventListener('keydown',event=>{
      if(event.key==='Enter'){event.preventDefault();this.root.querySelector<HTMLButtonElement>('[data-command="save-base-url"]')?.click()}
      if(event.key==='Escape'){const input=event.target as HTMLInputElement;input.value=this.settings.ai.baseUrl;input.readOnly=true;this.render(true)}
    });
    this.root.querySelector<HTMLTextAreaElement>("[data-list=blockedApps]")?.addEventListener("change",event=>void this.updateNested('sensing','blockedApps',(event.target as HTMLTextAreaElement).value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean)).then(()=>this.notify('内容黑名单已保存')));
    this.bindTimePickers();
    this.bindColorPicker();
  }

  private bindTimePickers():void {
    this.root.querySelectorAll<HTMLButtonElement>('.time-picker-trigger').forEach(trigger=>trigger.addEventListener('click',()=>{
      const picker=trigger.closest<HTMLElement>('.time-picker'),panel=picker?.querySelector<HTMLElement>('.time-picker-panel');if(!picker||!panel)return;
      const open=panel.hidden;this.closePopovers(picker);panel.hidden=!open;trigger.setAttribute('aria-expanded',String(open));
      if(open)queueMicrotask(()=>panel.querySelectorAll<HTMLElement>('.time-option.selected').forEach(option=>option.scrollIntoView({block:'center'})));
    }));
    this.root.querySelectorAll<HTMLButtonElement>('[data-time-part]').forEach(option=>option.addEventListener('click',()=>{
      const picker=option.closest<HTMLElement>('.time-picker');if(!picker)return;
      const part=option.dataset.timePart as 'hour'|'minute',value=option.dataset.timeValue!;picker.dataset[part]=value;
      picker.querySelectorAll<HTMLButtonElement>(`[data-time-part="${part}"]`).forEach(button=>{const selected=button===option;button.classList.toggle('selected',selected);button.setAttribute('aria-selected',String(selected))});
      const time=`${picker.dataset.hour}:${picker.dataset.minute}`;picker.querySelectorAll<HTMLElement>('[data-time-preview], .time-picker-head span').forEach(target=>target.textContent=time);
    }));
    this.root.querySelectorAll<HTMLButtonElement>('[data-time-cancel]').forEach(button=>button.addEventListener('click',()=>this.closePopovers()));
    this.root.querySelectorAll<HTMLButtonElement>('[data-time-apply]').forEach(button=>button.addEventListener('click',()=>void this.withBusy(button,async()=>{
      const picker=button.closest<HTMLElement>('.time-picker');if(!picker)return;
      await this.updateNested('reminders',picker.dataset.timeKey!,`${picker.dataset.hour}:${picker.dataset.minute}`);
      this.closePopovers();this.notify('静默时间已保存');
    })));
  }

  private bindColorPicker():void {
    const picker=this.root.querySelector<HTMLElement>('.color-picker'),trigger=picker?.querySelector<HTMLButtonElement>('.color-picker-trigger'),panel=picker?.querySelector<HTMLElement>('.color-picker-panel');
    if(!picker||!trigger||!panel)return;
    trigger.addEventListener('click',()=>{const open=panel.hidden;this.closePopovers(picker);panel.hidden=!open;trigger.setAttribute('aria-expanded',String(open));if(!open)this.previewAccent(this.settings.appearance.accentColor)});
    panel.querySelectorAll<HTMLInputElement>('[data-color-channel]').forEach(input=>input.addEventListener('input',()=>{
      const values=Object.fromEntries([...panel.querySelectorAll<HTMLInputElement>('[data-color-channel]')].map(item=>[item.dataset.colorChannel,Number(item.value)]));
      this.syncColorPanel(panel,hslToHex(values.hue??0,values.saturation??0,values.lightness??0));
    }));
    panel.querySelector<HTMLInputElement>('[data-color-hex]')?.addEventListener('input',event=>{const value=(event.target as HTMLInputElement).value.trim();if(/^#[0-9a-f]{6}$/i.test(value))this.syncColorPanel(panel,value,true)});
    panel.querySelectorAll<HTMLButtonElement>('[data-color-value]').forEach(button=>button.addEventListener('click',()=>void this.withBusy(button,()=>this.applyAccentColor(button.dataset.colorValue!))));
    panel.querySelector<HTMLButtonElement>('[data-color-cancel]')?.addEventListener('click',()=>this.closePopovers());
    const apply=panel.querySelector<HTMLButtonElement>('[data-color-apply]');apply?.addEventListener('click',()=>void this.withBusy(apply,()=>this.applyAccentColor(panel.dataset.previewColor!)));
  }

  private syncColorPanel(panel:HTMLElement,color:string,fromHex=false):void {
    const safe=safeAccent(color).toLowerCase(),[h,s,l]=hexToHsl(safe);panel.dataset.previewColor=safe;
    const preview=panel.querySelector<HTMLElement>('.color-preview');if(preview)preview.style.setProperty('--swatch',safe);
    const hex=panel.querySelector<HTMLInputElement>('[data-color-hex]');if(hex&&!fromHex)hex.value=safe.toUpperCase();
    for(const [key,value,suffix] of [['hue',h,'°'],['saturation',s,'%'],['lightness',l,'%']] as const){const input=panel.querySelector<HTMLInputElement>(`[data-color-channel="${key}"]`);if(input&&fromHex)input.value=String(value);const output=input?.closest('label')?.querySelector<HTMLOutputElement>('output');if(output)output.value=`${value}${suffix}`}
    this.previewAccent(safe);
  }

  private previewAccent(color:string):void {
    const safe=safeAccent(color).toLowerCase(),shell=this.root.querySelector<HTMLElement>('.console-shell');shell?.style.setProperty('--accent',safe);
    const dot=this.root.querySelector<HTMLElement>('.color-picker-trigger > i');dot?.style.setProperty('--swatch',safe);
    const label=this.root.querySelector<HTMLElement>('[data-accent-label]');if(label)label.textContent=safe.toUpperCase();
  }

  private async applyAccentColor(color:string,remember=true):Promise<void> {
    const safe=safeAccent(color).toLowerCase(),previous=safeAccent(this.settings.appearance.accentColor).toLowerCase();
    this.previewAccent(safe);this.settings.appearance.accentColor=safe;
    if(remember)this.settings.appearance.recentAccentColors=[safe,previous,...(this.settings.appearance.recentAccentColors??[])].filter((value,index,list)=>list.indexOf(value)===index).slice(0,6);
    await this.save();this.render(true);this.notify('强调色已实时应用');
  }

  private closePopovers(except?:Element):void {
    this.root.querySelectorAll<HTMLElement>('.popover-panel:not([hidden])').forEach(panel=>{
      if(except?.contains(panel))return;
      panel.hidden=true;
      const owner=panel.closest('.custom-select, .time-picker, .color-picker');owner?.querySelector<HTMLElement>('[aria-expanded="true"]')?.setAttribute('aria-expanded','false');
    });
    if(!except?.classList.contains('color-picker'))this.previewAccent(this.settings.appearance.accentColor);
  }

  private value(el:HTMLInputElement):unknown{if(el.type==='number'||el.type==='range')return Number(el.value);return el.value}
  private async updateNested(section:'appearance'|'sensing'|'reminders'|'ai',key:string,value:unknown):Promise<void>{(this.settings[section] as unknown as Record<string,unknown>)[key]=value;await this.save()}
  private async resumeSensing():Promise<void>{
    const resume=window.petAPI.pet.resumeSensing;
    if(typeof resume!=='function')throw new Error('感知服务版本已更新，请完全退出桌宠后重新打开');
    await resume();
  }
  private async save():Promise<void>{
    try{this.settings=await window.petAPI.settings.update(this.settings)}
    catch(error){this.notify(`保存失败：${error instanceof Error?error.message:String(error)}`,true);throw error}
  }

  private async openTab(tab:string):Promise<void>{
    if(tab===this.active)return;
    this.root.querySelector('.workspace')?.setAttribute('aria-busy','true');
    this.active=tab;
    this.runtime=await window.petAPI.pet.getRuntime();
    this.activity=this.runtime.activity;
    if(tab==='stats'||tab==='home'||tab==='ai')this.stats=await window.petAPI.statistics.get(tab==='stats'?this.statsRange:31);
    this.render();
  }

  private async refreshStatistics(renderPage=false):Promise<void>{
    this.stats=await window.petAPI.statistics.get(this.active==='stats'?this.statsRange:31);
    if(renderPage)this.render(true);
  }

  private sensingActive():boolean{return this.settings.firstRunConsent&&this.settings.sensing.enabled&&(!this.runtime.sensingPausedUntil||this.runtime.sensingPausedUntil<=Date.now())}
  private sensingPaused():boolean{return Boolean(this.settings.firstRunConsent&&this.settings.sensing.enabled&&this.runtime.sensingPausedUntil&&this.runtime.sensingPausedUntil>Date.now())}
  private sensingLabel():string{if(!this.settings.firstRunConsent)return '等待首次确认';if(!this.settings.sensing.enabled)return '已关闭';if(this.runtime.sensingPausedUntil&&this.runtime.sensingPausedUntil>Date.now())return `暂停至 ${new Date(this.runtime.sensingPausedUntil).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}`;return '感知已开启'}
  private sensingControlLabel():string{return !this.settings.sensing.enabled?buttonLabel('play','开启感知'):this.sensingPaused()?buttonLabel('play','恢复感知'):buttonLabel('pause','暂停感知 10 分钟')}
  private sensorSourceName():string{return this.activity.sensorSource==='native'?'Rust 原生传感器':this.activity.sensorSource==='compat'?'Win32 兼容传感器':'Electron 基础降级'}
  private foregroundLabel():string{return this.activity.foregroundProcess==='unknown'?'等待前台应用数据':`${this.activity.foregroundProcess} · ${this.categoryName(this.activity.appCategory)}`}
  private typingLabel():string{return this.activity.keyboardPulse?`正在输入（10 秒 ${this.activity.keyboardCount10s} 次）`:'当前没有输入脉冲'}
  private percent(value:number):string{return `${Math.max(0,value||0).toFixed(1)}%`}
  private updateResourceIndicators(performance:ActivitySnapshot['performance']):void{
    const levels:Record<string,number>={
      'pet-cpu':performance.petCpuPercent,
      'pet-memory':performance.petMemoryMb/700*100,
      'system-cpu':performance.systemCpuPercent,
      'system-memory':performance.systemMemoryPercent
    };
    this.root.querySelectorAll<HTMLElement>('[data-resource]').forEach(dot=>{
      const value=levels[dot.dataset.resource??'']??0;
      dot.classList.toggle('is-warn',value>=55&&value<80);
      dot.classList.toggle('is-busy',value>=80);
      dot.setAttribute('title',value>=80?'占用较高':value>=55?'占用适中':'占用正常');
    });
  }
  private categoryName(value:string):string{return ({design:'设计',office:'办公',development:'开发',communication:'沟通',entertainment:'娱乐',other:'其他'} as Record<string,string>)[value]??value}
  private rangeOutput(key:string,value:number):string{return key==='scale'||key==='bubbleScale'?`${Math.round(value*100)}%`:key==='bubbleOpacity'?`${Math.round(value*100)}%`:key==='bubbleDurationSeconds'?`${value} 秒`:String(value)}

  private syncAppearanceScale(scale=this.settings.appearance.scale,bubbleScale=this.settings.appearance.bubbleScale):void{
    for(const [key,value] of [['scale',scale],['bubbleScale',bubbleScale]] as const){
      const range=this.root.querySelector<HTMLInputElement>(`[data-appearance="${key}"]`);
      if(!range)continue;
      range.value=String(value);
      const output=range.closest('.range-row')?.querySelector<HTMLOutputElement>('output');
      if(output)output.value=this.rangeOutput(key,value);
    }
  }

  private setLive(name:string,value:string):void{this.root.querySelectorAll<HTMLElement>(`[data-live="${name}"]`).forEach(element=>{if(element.textContent!==value)element.textContent=value})}
  private syncModeSelection():void{
    const selectedMode=this.settings.manualMode;
    this.root.querySelector<HTMLElement>('.console-shell')?.classList.toggle('energy-saving',selectedMode==='energy_saving');
    this.root.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button=>{
      const selected=button.dataset.mode===selectedMode;
      button.classList.toggle('selected',selected);
      if(button.classList.contains('quick-mode-card')){
        const indicator=button.querySelector('em');
        if(selected&&!indicator)button.insertAdjacentHTML('beforeend',`<em>${icon('check')} 当前</em>`);
        if(!selected)indicator?.remove();
        return;
      }
      const selectedIcon=button.querySelector('.ui-icon');
      if(selected&&!selectedIcon)button.insertAdjacentHTML('beforeend',icon('check'));
      if(!selected)selectedIcon?.remove();
    });
  }
  private manualCountdownLabel():string{
    if(this.settings.manualMode!=="manual"||!this.settings.manualUntil)return "30 秒后恢复自动";
    return `${Math.max(0,Math.ceil((this.settings.manualUntil-Date.now())/1000))} 秒后恢复自动`;
  }
  private syncManualCountdown():void{
    window.clearInterval(this.manualCountdownTimer);
    const label=this.root.querySelector<HTMLElement>('[data-live="manual-countdown"]');
    if(!label)return;
    const update=()=>{this.setLive('manual-countdown',this.manualCountdownLabel())};
    update();
    if(this.settings.manualMode==='manual'&&this.settings.manualUntil&&this.settings.manualUntil>Date.now())this.manualCountdownTimer=window.setInterval(update,250);
  }
  private updateLiveValues():void{
    if(!this.activity)return;
    const performance=this.activity.performance;
    this.setLive('sensing-status',this.sensingLabel());
    this.setLive('sensor-source',this.sensorSourceName());
    this.setLive('system-cpu',this.percent(performance.systemCpuPercent));
    this.setLive('system-memory',this.percent(performance.systemMemoryPercent));
    this.setLive('pet-cpu',this.percent(performance.petCpuPercent));
    this.setLive('pet-memory',`${performance.petMemoryMb.toFixed(1)} MB`);
    this.updateResourceIndicators(performance);
    this.root.querySelectorAll('.status-dot').forEach(dot=>dot.classList.toggle('off',!this.sensingActive()));
    this.root.querySelectorAll('.status-text').forEach(status=>{status.classList.toggle('ok',this.sensingActive());status.classList.toggle('warn',!this.sensingActive())});
    this.updateSensingControl();
    if(this.active!=='home'&&this.active!=='privacy')return;
    this.setLive('mode-headline',this.modeHeadline());
    this.setLive('mode-label',this.modeLabel());
    this.setLive('foreground',this.foregroundLabel());
    this.setLive('typing',this.typingLabel());
    this.setLive('keyboard-rate',String(this.activity.keyboardCount1s));
    this.setLive('keyboard-10s',String(this.activity.keyboardCount10s));
    this.setLive('mouse-rate',String(this.activity.mouseClicks1s+this.activity.mouseWheel1s));
    this.setLive('idle-seconds',`${this.activity.idleSeconds} 秒`);
    this.setLive('sensor-memory',performance.sensorMemoryMb?`${performance.sensorMemoryMb.toFixed(1)} MB`:'基础降级层');
    this.setLive('pet-processes',String(performance.petProcessCount));
    this.setLive('event-loop-lag',`${performance.eventLoopLagMs} ms`);
  }

  private updateSensingControl():void {
    const button=this.root.querySelector<HTMLButtonElement>('.sensing-toggle');
    if(button){button.innerHTML=this.sensingControlLabel();button.classList.toggle('is-paused',this.sensingPaused());button.setAttribute('aria-pressed',String(this.sensingPaused()))}
    window.clearTimeout(this.pauseExpiryTimer);
    if(this.runtime.sensingPausedUntil&&this.runtime.sensingPausedUntil>Date.now())this.pauseExpiryTimer=window.setTimeout(()=>{this.runtime.sensingPausedUntil=null;this.updateLiveValues()},this.runtime.sensingPausedUntil-Date.now()+80);
  }

  private notify(message:string,error=false):void{
    const toast=this.root.querySelector<HTMLElement>('.toast');
    if(!toast)return;
    const target=toast.querySelector<HTMLElement>('.toast-message');
    if(target)target.textContent=message;
    toast.classList.toggle('error',error);
    toast.classList.add('visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer=window.setTimeout(()=>toast.classList.remove('visible'),2200);
  }

  private async withBusy(button:HTMLButtonElement,task:()=>Promise<void>):Promise<void>{
    if(button.disabled)return;
    button.disabled=true;
    button.classList.add('is-loading');
    button.setAttribute('aria-busy','true');
    try{await task()}
    catch(error){this.notify(`操作失败：${error instanceof Error?error.message:String(error)}`,true)}
    finally{if(button.isConnected){button.disabled=false;button.classList.remove('is-loading');button.removeAttribute('aria-busy')}}
  }

  private confirmAction(title:string,message:string,confirmLabel:string):Promise<boolean>{
    const dialog=this.root.querySelector<HTMLDialogElement>('.confirm-dialog');
    if(!dialog)return Promise.resolve(false);
    dialog.querySelector('h2')!.textContent=title;
    dialog.querySelector('p')!.textContent=message;
    dialog.querySelector<HTMLButtonElement>('.confirm-submit')!.textContent=confirmLabel;
    return new Promise(resolve=>{
      const finish=()=>resolve(dialog.returnValue==='confirm');
      dialog.addEventListener('close',finish,{once:true});
      dialog.showModal();
    });
  }

  private async command(command:string):Promise<void>{
    try{
      if(command==='reset-position'){await window.petAPI.settings.resetPosition();this.notify('桌宠已回到屏幕右下角')}
      if(command==='reset-behavior'){
        Object.assign(this.settings.appearance,{scale:1,alwaysOnTop:true,lockPosition:false});
        await this.save();await window.petAPI.settings.resetPosition();this.render(true);this.notify('桌宠尺寸与行为已恢复默认');
      }
      if(command==='reset-motion'){
        Object.assign(this.settings.appearance,{animationIntensity:'full',bubbleScale:1,bubbleFontSize:15,bubbleOpacity:.94,bubbleDurationSeconds:8});
        await this.save();this.render(true);this.notify('动效与气泡已恢复默认');
      }
      if(command==='reset-accent'){await this.applyAccentColor('#d77d6b',false)}
      if(command==='save-name'){const input=this.root.querySelector<HTMLInputElement>('[data-pet-name]');const value=Array.from((input?.value??'').replace(/[\u0000-\u001f\u007f]/g,'').trim()).slice(0,12).join('');if(!value){this.notify('名字不能为空',true);input?.focus();return}if(value===this.settings.petName){this.notify('名字没有变化');return}this.settings.petName=value;await this.save();await window.petAPI.console.syncTitle(value);document.title=`${value}桌宠控制台`;this.render(true);this.notify(`以后就叫我${value}啦`)}
      if(command==='choose-directory'){const value=await window.petAPI.settings.chooseDataDirectory();if(value){this.settings.dataDirectory=value;await this.save();this.render(true);this.notify('数据目录迁移完成')}}
      if(command==='save-key'){const input=this.root.querySelector<HTMLInputElement>('.api-key');const value=input?.value.trim()??'';if(!value){this.notify('请先输入 API Key',true);return}const ok=await window.petAPI.settings.setApiKey(value);if(input)input.value='';this.notify(ok?'API Key 已加密保存':'系统加密不可用',!ok)}
      if(command==='edit-base-url'){const input=this.root.querySelector<HTMLInputElement>('[data-base-url]'),button=this.root.querySelector<HTMLButtonElement>('[data-command="edit-base-url"]');if(!input||!button)return;input.readOnly=false;button.dataset.command='save-base-url';button.classList.add('editing');button.innerHTML=buttonLabel('check','保存并锁定');input.focus();input.select()}
      if(command==='save-base-url'){const input=this.root.querySelector<HTMLInputElement>('[data-base-url]'),button=this.root.querySelector<HTMLButtonElement>('[data-command="save-base-url"]');if(!input||!button)return;let url:URL;try{url=new URL(input.value.trim())}catch{this.notify('请输入有效的 HTTPS API 地址',true);input.focus();return}if(url.protocol!=='https:'){this.notify('API 地址必须使用 HTTPS',true);input.focus();return}this.settings.ai.baseUrl=url.toString().replace(/\/$/,'');await this.save();input.value=this.settings.ai.baseUrl;input.readOnly=true;button.dataset.command='edit-base-url';button.classList.remove('editing');button.innerHTML=buttonLabel('edit','编辑');this.notify('API 地址已保存并重新锁定')}
      if(command==='test-ai'){const target=this.root.querySelector<HTMLElement>('.connection-result')!;target.textContent='正在测试连接…';target.classList.add('visible');target.textContent=await window.petAPI.settings.testDeepSeek()}
      if(command==='clear-chats'){if(!await this.confirmAction('清空聊天历史？','全部本地聊天记录将被永久删除，此操作无法撤销。','确认清空'))return;await window.petAPI.storage.clearChats();this.notify('聊天历史已清空')}
      if(command==='clear-stats'){if(!await this.confirmAction('清空统计数据？','全部本地聚合统计将被永久删除，此操作无法撤销。','确认清空'))return;await window.petAPI.statistics.clear();await this.refreshStatistics(true);this.notify('统计数据已清空')}
      if(command==='refresh-stats'){await this.refreshStatistics(true);this.notify('统计已刷新')}
      if(command==='check-update'){this.updateStatus=await window.petAPI.updates.check();this.syncUpdatePanel();this.notify(this.updateStatus.message,this.updateStatus.phase==='error')}
      if(command==='download-update'){this.updateStatus=await window.petAPI.updates.download();this.syncUpdatePanel();this.notify(this.updateStatus.message,this.updateStatus.phase==='error')}
      if(command==='install-update'){if(!await this.confirmAction('立即安装更新？','桌宠会安全退出并重新启动，设置、聊天和统计数据都会保留。','重启并安装'))return;const started=await window.petAPI.updates.install();if(!started)this.notify('更新尚未下载完成',true)}
      if(command==='open-release-page'){await window.petAPI.updates.openReleases();this.notify('已打开官方发布页')}
      if(command==='show-onboarding'){this.onboardingOpen=true;this.onboardingStep=0;this.render(true)}
      if(command==='onboarding-private'){this.settings.firstRunConsent=true;this.settings.sensing.enabled=false;await this.save();this.onboardingStep=2;this.runtime=await window.petAPI.pet.getRuntime();this.render();this.notify('本地感知保持关闭，可稍后开启')}
      if(command==='onboarding-enable'){this.settings.firstRunConsent=true;this.settings.sensing.enabled=true;await this.save();await this.resumeSensing();this.onboardingStep=2;this.runtime=await window.petAPI.pet.getRuntime();this.render();this.notify('本地感知已按说明开启')}
      if(command==='onboarding-ai-later'){this.onboardingStep=3;this.render()}
      if(command==='onboarding-open-ai'){this.onboardingOpen=false;this.onboardingStep=0;await this.openTab('ai');this.notify('请粘贴 DeepSeek API Key 并安全保存')}
      if(command==='finish-onboarding'){this.onboardingOpen=false;this.onboardingStep=0;this.render();this.notify(`欢迎使用${this.petNameText()}桌宠`)}
      if(command==='reset-all'){if(!await this.confirmAction('恢复全部默认设置？',`所有偏好、统计与聊天记录都会被清空，${this.petNameText()}将恢复初始状态。`,'恢复默认设置'))return;await window.petAPI.storage.resetAll();location.reload()}
      if(command==='consent'){this.settings.firstRunConsent=true;this.settings.sensing.enabled=true;await this.save();await this.resumeSensing();this.onboardingOpen=false;this.runtime=await window.petAPI.pet.getRuntime();this.render(true);this.notify('本地感知已启用')}
      if(command==='context-preview'){const preview=this.root.querySelector('.context-preview')!;preview.textContent='正在读取并脱敏当前上下文…';const context=await window.petAPI.chat.contextPreview();preview.textContent=JSON.stringify(context,null,2)}
      if(command==='chat'){await window.petAPI.pet.openChat();this.notify('智能体聊天已打开')}
      if(command==='toggle-sensing'){
        if(!this.settings.sensing.enabled){this.settings.sensing.enabled=true;await this.save();await this.resumeSensing();this.notify('本地感知已开启')}
        else if(this.sensingPaused()){await this.resumeSensing();this.notify('本地感知已恢复')}
        else{await window.petAPI.pet.pauseSensing(10);this.notify('感知已暂停 10 分钟，可再次点击立即恢复')}
        this.runtime=await window.petAPI.pet.getRuntime();this.updateLiveValues();
      }
      if(command==='pause'||command==='pause-10'){await window.petAPI.pet.pauseSensing(10);this.runtime=await window.petAPI.pet.getRuntime();this.updateLiveValues();this.notify('感知已暂停 10 分钟')}
      if(command==='pause-tomorrow'){const now=new Date();const tomorrow=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1);await window.petAPI.pet.pauseSensing(Math.ceil((tomorrow.getTime()-now.getTime())/60000));this.runtime=await window.petAPI.pet.getRuntime();this.updateLiveValues();this.notify('感知已暂停到明天')}
      if(command==='disable-sensing'){this.settings.sensing.enabled=false;await this.save();this.render(true);this.notify('本地感知已关闭')}
    }catch(error){this.notify(`操作失败：${error instanceof Error?error.message:String(error)}`,true)}
  }
}

void new ConsoleApp().mount();
