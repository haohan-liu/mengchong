import animations from "../../animations_manifest.json";
import { directionalDragAction, isDirectionalDragAction, type ActivitySnapshot, type AnimationDefinition, type DragDirection, type PetSpeechEvent, type PetSpeechKind, type PetState, type Settings } from "../types";
import { Animator } from "./animation/Animator";
import { StateMachine } from "./state/StateMachine";
import { ClickTracker, DragDirectionTracker, dragDirectionForMove, linkedBubbleScale, passedDragThreshold, stepPetScale } from "./interaction";
import { TypingTracker } from "./activity/TypingTracker";

export class PetApp {
  private animator!: Animator;
  private machine!: StateMachine;
  private settings!: Settings;
  private canvas!: HTMLCanvasElement;
  private bubble!: HTMLDivElement;
  private bubbleText!: HTMLDivElement;
  private clickTracker = new ClickTracker();
  private pointerStart: { x: number; y: number } | null = null;
  private activePointerId: number | null = null;
  private dragGesture = 0;
  private dragging = false;
  private dragStarting = false;
  private dragDirection: DragDirection = "right";
  private dragDirectionTracker = new DragDirectionTracker("right", 12);
  private suppressClick = false;
  private speechRequest = 0;
  private queuedSpeech: PetSpeechEvent | null = null;
  private bubbleTimer = 0;
  private bubbleCloseTimer = 0;
  private bounceTimer = 0;
  private wheelScaleTimer = 0;
  private scalePreviewFrame = 0;
  private scaleCommitTimer = 0;
  private pendingScale: number | null = null;
  private pendingBubbleScale: number | null = null;
  private renderedScale: number | null = null;
  private scaleUpdating = false;
  private unlisten: Array<() => void> = [];
  private lastPointer = { x: 0, y: 0, at: 0 };
  private activityMode = "startup";
  private typingTracker = new TypingTracker();

  constructor(private readonly root: HTMLElement) {}

  async mount(): Promise<void> {
    this.settings = await window.petAPI.settings.get();
    this.render();
    this.canvas = this.root.querySelector("canvas")!;
    this.bubble = this.root.querySelector(".pet-bubble-anchor")!;
    this.bubbleText = this.root.querySelector(".bubble-text")!;
    this.applySettings();
    this.animator = new Animator(this.canvas);
    this.animator.setIntensity(this.effectiveIntensity());
    this.animator.setEnergySaving(this.settings.manualMode === "energy_saving");
    const map = new Map((animations as AnimationDefinition[]).map((item) => [item.id, item]));
    this.machine = new StateMachine(map, (definition) => {
      // Only the dragged sprite has a mirrored left-facing variant. Every
      // normal state returns to the authored, non-mirrored orientation.
      if (definition.id !== "dragged") this.animator.setHorizontalFlip(false);
      void this.animator.play(definition);
    });
    this.animator.setCompleteListener((action) => this.machine.animationCompleted(action));
    this.bind();
    this.machine.transition("APPEAR", "wave_hello", true);
    // Keep only the most likely first interaction warm. The multi-click
    // action is decoded on demand, preventing startup from retaining a second
    // full animation sequence just in case it is used.
    window.setTimeout(() => {
      if (this.settings.manualMode !== "energy_saving") void this.animator.preload([map.get("clicked")!].filter(Boolean));
    }, 500);
  }

  private render(): void {
    this.root.innerHTML = `
      <main class="pet-shell" aria-label="桌宠">
        <section class="pet-bubble-anchor" role="status" aria-live="polite" aria-atomic="true" hidden>
          <div class="pet-bubble">
            <div class="bubble-speaker"><strong data-bubble-name>珊珊</strong></div>
            <div class="bubble-text"></div>
            <button class="bubble-close" type="button" aria-label="关闭气泡">×</button>
          </div>
        </section>
        <button class="pet-hit" aria-label="桌宠"><canvas></canvas></button>
        <div class="status-pill"><i></i><span>在你身边</span></div>
        <div class="pet-context" hidden><small>快捷菜单</small><button data-action="console">打开控制台</button><button data-action="chat" data-pet-chat-label>和珊珊聊天</button><button data-action="energy" data-energy-label>开启节能模式</button><button data-action="hide">隐藏到托盘</button><button data-action="quit" class="pet-context-quit">退出桌宠</button></div>
      </main>`;
  }

  private bind(): void {
    const hit = this.root.querySelector<HTMLButtonElement>(".pet-hit")!;
    hit.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      this.pointerStart = { x: event.screenX, y: event.screenY };
      this.activePointerId = event.pointerId;
      this.dragDirectionTracker.reset(event.screenX, this.dragDirection);
      this.dragGesture += 1;
      this.dragging = false;
      this.suppressClick = false;
      hit.setPointerCapture(event.pointerId);
    });
    hit.addEventListener("pointermove", (event) => {
      const point = { x: event.screenX, y: event.screenY };
      if (this.pointerStart && this.activePointerId === event.pointerId) {
        if (!this.dragging && !this.dragStarting && passedDragThreshold(this.pointerStart, point, 8)) {
          // A threshold-crossing pointer gesture is never a click, including
          // the short interval while the native drag IPC is being accepted.
          this.suppressClick = true;
          void this.beginDrag(hit, event.pointerId, this.dragGesture, point);
        }
        if (this.dragging) this.updateDragDirection(point);
        return;
      }
      const now = performance.now();
      const speed = Math.hypot(event.screenX - this.lastPointer.x, event.screenY - this.lastPointer.y) / Math.max(1, now - this.lastPointer.at);
      this.lastPointer = { x: event.screenX, y: event.screenY, at: now };
      if (speed > 1.4 && this.machine.currentState === "IDLE") this.machine.reaction("follow_cursor");
    });
    const finishPointer = (event: PointerEvent) => {
      if (this.activePointerId !== event.pointerId) return;
      this.pointerStart = null;
      this.activePointerId = null;
      this.dragGesture += 1;
      if (hit.hasPointerCapture(event.pointerId)) hit.releasePointerCapture(event.pointerId);
      if (this.dragging) {
        this.dragging = false;
        hit.classList.remove("dragging");
        void window.petAPI.pet.stopDrag();
        this.machine.transition("REACTION", "drop_landing", true);
      }
    };
    hit.addEventListener("pointerup", finishPointer);
    hit.addEventListener("pointercancel", finishPointer);
    hit.addEventListener("click", () => {
      if (this.suppressClick) { this.suppressClick = false; return; }
      const result = this.clickTracker.push(performance.now());
      this.playClickBounce(hit, result === "single" ? "full" : "soft");
      if (result === "single") this.machine.reaction("clicked");
      if (result === "multi") this.machine.reaction("multi_clicked");
      if (result === "single" && this.bubble.hidden) void this.requestSpeech("click");
    });
    hit.addEventListener("wheel", (event) => {
      if (!event.deltaY) return;
      event.preventDefault();
      const current = this.pendingScale ?? this.settings.appearance.scale;
      const next = stepPetScale(current, event.deltaY < 0 ? 1 : -1);
      if (next === current) return;
      this.markWheelScaling(hit);
      this.pendingScale = next;
      this.pendingBubbleScale = linkedBubbleScale(next);
      this.scheduleScalePreview();
      this.applySettings();
      this.scheduleScaleCommit();
    }, { passive: false });
    hit.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const menu = this.root.querySelector<HTMLElement>(".pet-context")!;
      menu.hidden = false;
    });
    this.root.querySelector(".bubble-close")?.addEventListener("click", () => this.closeBubble());
    this.root.querySelector(".pet-context")?.addEventListener("click", (event) => {
      const action = (event.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.action;
      (event.currentTarget as HTMLElement).hidden = true;
      if (action === "console") void window.petAPI.pet.openConsole();
      if (action === "chat") void window.petAPI.pet.openChat();
      if (action === "energy") void this.toggleEnergySaving();
      if (action === "hide") void window.petAPI.pet.hide();
      if (action === "quit") void window.petAPI.pet.quit();
    });
    window.addEventListener("blur", () => { const menu = this.root.querySelector<HTMLElement>(".pet-context"); if (menu) menu.hidden = true; });
    this.unlisten.push(window.petAPI.pet.onActivity((snapshot) => this.handleActivity(snapshot)));
    this.unlisten.push(window.petAPI.pet.onAction((action) => {
      if (isDirectionalDragAction(action)) {
        this.playDirectionalDrag(action === "dragged_left" ? "left" : "right");
        return;
      }
      this.machine.transition(action === "dragged" ? "DRAGGING" : "REACTION", action, true);
    }));
    this.unlisten.push(window.petAPI.pet.onSpeech((speech) => {
      if (!speech.text.trim()) return;
      if (!this.bubble.hidden) { this.queuedSpeech ??= speech; return; }
      this.presentSpeech(speech);
    }));
    this.unlisten.push(window.petAPI.pet.onScalePreview(({ scale, bubbleScale }) => {
      this.pendingScale = scale;
      this.pendingBubbleScale = bubbleScale;
      this.applySettings();
    }));
    this.unlisten.push(window.petAPI.pet.onScaleFrame(({ scale }) => {
      this.renderedScale = scale;
      this.applySettings();
    }));
    this.unlisten.push(window.petAPI.pet.onVisibilityChanged((visible) => {
      void this.animator.setVisible(visible).finally(() => void window.petAPI.pet.acknowledgeVisibility(visible));
    }));
    this.unlisten.push(window.petAPI.settings.onChanged((settings) => {
      this.settings = settings;
      if (this.pendingScale !== null && Math.abs(this.pendingScale - settings.appearance.scale) < .001) this.pendingScale = null;
      if (this.pendingBubbleScale !== null && Math.abs(this.pendingBubbleScale - settings.appearance.bubbleScale) < .001) this.pendingBubbleScale = null;
      this.applySettings();
      this.animator.setIntensity(this.effectiveIntensity());
      this.animator.setEnergySaving(settings.manualMode === "energy_saving");
    }));
    this.unlisten.push(window.petAPI.agentApproval.onRequest((call) => {
      const detail = JSON.stringify(call.arguments, null, 2);
      const approved = window.confirm(`${this.petName()}想执行：${call.name}\n\n${detail}\n\n是否允许本次操作？`);
      void window.petAPI.agentApproval.resolve(call.id, approved);
    }));
  }

  private async beginDrag(hit: HTMLElement, pointerId: number, gesture: number, point: { x: number; y: number }): Promise<void> {
    const origin = this.pointerStart;
    if (!origin) return;
    this.dragStarting = true;
    let started = false;
    try {
      started = await window.petAPI.pet.startDrag(origin, point);
    } catch {
      return;
    } finally {
      this.dragStarting = false;
    }
    if (!started) return;
    if (this.activePointerId !== pointerId || this.dragGesture !== gesture || !this.pointerStart) {
      void window.petAPI.pet.stopDrag();
      return;
    }
    this.dragging = true;
    this.suppressClick = true;
    hit.classList.add("dragging");
    const direction = dragDirectionForMove(origin, point, this.dragDirection);
    this.dragDirectionTracker.reset(point.x, direction);
    this.playDirectionalDrag(direction, true);
  }

  private updateDragDirection(point: { x: number; y: number }): void {
    const direction = this.dragDirectionTracker.update(point.x);
    if (direction === this.dragDirection) return;
    this.playDirectionalDrag(direction);
  }

  private playDirectionalDrag(direction: DragDirection, forceStart = false): void {
    const changed = direction !== this.dragDirection;
    this.dragDirection = direction;
    this.animator.setHorizontalFlip(direction === "left");
    // Start the drag animation once. A turn keeps the current frame and only
    // mirrors it; restarting the state machine here reset frame 0 and its fade
    // on every reversal, which was the visible hitch during left/right turns.
    if (forceStart || this.machine.currentState !== "DRAGGING" || this.machine.currentAction !== "dragged") {
      this.machine.transition("DRAGGING", "dragged", true);
    }
    if (!changed && !forceStart) return;
    // The frame asset stays shared, while the runtime action records which
    // direction is displayed. This keeps the console and diagnostics honest
    // without duplicating 12 PNG frames solely to mirror them.
    void window.petAPI.pet.setAction(directionalDragAction(direction));
  }

  private handleActivity(snapshot: ActivitySnapshot): void {
    const label = this.root.querySelector(".status-pill span")!;
    if (this.settings.manualMode !== "auto") {
      label.textContent = this.modeStatusLabel();
      this.activityMode = this.settings.manualMode;
      return;
    }
    if (this.settings.reminders.scheduledSilent && this.isScheduledSilent()) {
      label.textContent = "定时静默中";
      this.activityMode = "scheduled-silent";
      return;
    }
    if (!snapshot.online) { label.textContent = "网络断开"; this.transitionActivity("offline", "OFFLINE", "offline"); return; }
    if (snapshot.batteryPercent <= 20 && !snapshot.charging) { label.textContent = "电量有点低"; this.transitionActivity("low-battery", "LOW_BATTERY", "low_battery"); return; }
    if (snapshot.presenceState === "resting") { label.textContent = "休息中"; this.typingTracker.reset(); this.transitionActivity("sleep", "SLEEP", "stand_sleep"); return; }
    if (snapshot.presenceState === "away") { label.textContent = "暂离中"; this.typingTracker.reset(); this.transitionActivity("away", "IDLE", "idle_breath"); return; }
    label.textContent = `${snapshot.applicationLabel} · ${snapshot.activityLabel}`;
    if ((this.settings.reminders.meetingSilent && snapshot.meeting) || (this.settings.reminders.fullscreenSilent && snapshot.fullscreen)) { this.activityMode = "silent"; return; }
    const typing = this.typingTracker.update(snapshot.timestamp, snapshot.keyboardPulse, snapshot.keyboardCount10s);
    if (typing === "fast") { this.transitionActivity("typing-fast", "USER_TYPING", "type_fast"); return; }
    if (typing === "typing") { this.transitionActivity("typing", "USER_TYPING", "user_typing"); return; }
    if (this.activityMode !== "idle") {
      this.activityMode = "idle";
      if (this.machine.currentState !== "IDLE") this.machine.transition("IDLE", "idle_breath", true);
    }
  }

  private transitionActivity(mode: string, state: PetState, action: string): void {
    if (this.activityMode === mode) return;
    this.activityMode = mode;
    this.machine.transition(state, action, state === "IDLE");
  }

  private isScheduledSilent(now = new Date()): boolean {
    const toMinutes = (value: string): number | null => {
      const match = /^(\d{2}):(\d{2})$/.exec(value);
      if (!match) return null;
      const hours = Number(match[1]), minutes = Number(match[2]);
      return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
    };
    const start = toMinutes(this.settings.reminders.quietStart);
    const end = toMinutes(this.settings.reminders.quietEnd);
    if (start === null || end === null || start === end) return false;
    const current = now.getHours() * 60 + now.getMinutes();
    return start < end ? current >= start && current < end : current >= start || current < end;
  }

  private closeBubble(): void {
    if (this.bubble.hidden || this.bubble.classList.contains("closing")) return;
    window.clearTimeout(this.bubbleTimer);
    window.clearTimeout(this.bubbleCloseTimer);
    this.bubble.classList.add("closing");
    this.machine.transition("IDLE", "idle_breath", true);
    this.bubbleCloseTimer = window.setTimeout(() => {
      this.bubble.hidden = true;
      this.bubble.classList.remove("closing");
      const queued = this.queuedSpeech;
      this.queuedSpeech = null;
      if (queued) window.setTimeout(() => { if (this.bubble.hidden) this.presentSpeech(queued); }, 180);
    }, 160);
  }
  private say(text: string): void {
    window.clearTimeout(this.bubbleCloseTimer);
    this.bubble.classList.remove("closing");
    this.bubbleText.textContent = text;
    this.bubble.hidden = false;
    window.petAPI.pet.raiseBubble();
    window.clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => this.closeBubble(), this.settings.appearance.bubbleDurationSeconds * 1000);
  }

  private presentSpeech(speech: PetSpeechEvent): void {
    if (speech.kind === "proactive") this.machine.transition("RESPONDING", "talk_normal", true);
    this.say(speech.text);
  }

  private async requestSpeech(kind: PetSpeechKind): Promise<void> {
    const request = ++this.speechRequest;
    try {
      const text = await window.petAPI.pet.nextSpeech(kind);
      if (request !== this.speechRequest || !this.bubble.hidden || !text.trim()) return;
      this.presentSpeech({ text, kind });
    } catch {
      // A transient AI/IPC failure must never interrupt the click animation.
    }
  }

  private playClickBounce(hit: HTMLElement, strength: "full" | "soft"): void {
    window.clearTimeout(this.wheelScaleTimer);
    hit.classList.remove("wheel-scaling");
    window.clearTimeout(this.bounceTimer);
    hit.classList.remove("q-bounce", "q-bounce-soft");
    void hit.offsetWidth;
    const className = strength === "full" ? "q-bounce" : "q-bounce-soft";
    hit.classList.add(className);
    this.bounceTimer = window.setTimeout(() => hit.classList.remove(className), strength === "full" ? 520 : 260);
  }

  private markWheelScaling(hit: HTMLElement): void {
    window.clearTimeout(this.bounceTimer);
    window.clearTimeout(this.wheelScaleTimer);
    hit.classList.remove("q-bounce", "q-bounce-soft");
    hit.classList.add("wheel-scaling");
    this.wheelScaleTimer = window.setTimeout(() => hit.classList.remove("wheel-scaling"), 180);
  }

  private scheduleScaleCommit(): void {
    window.clearTimeout(this.scaleCommitTimer);
    this.scaleCommitTimer = window.setTimeout(() => {
      this.scaleCommitTimer = 0;
      void this.flushScaleUpdates();
    }, 140);
  }

  private scheduleScalePreview(): void {
    if (this.scalePreviewFrame) return;
    this.scalePreviewFrame = window.requestAnimationFrame(() => {
      this.scalePreviewFrame = 0;
      if (this.pendingScale === null || this.pendingBubbleScale === null) return;
      window.petAPI.pet.previewScale(this.pendingScale, this.pendingBubbleScale);
    });
  }

  private async flushScaleUpdates(): Promise<void> {
    if (this.scaleUpdating) return;
    if (this.pendingScale === null || this.pendingBubbleScale === null) return;
    this.scaleUpdating = true;
    try {
      const targetScale = this.pendingScale;
      const targetBubbleScale = this.pendingBubbleScale;
      const next = structuredClone(this.settings);
      next.appearance.scale = targetScale;
      next.appearance.bubbleScale = targetBubbleScale;
      this.settings = await window.petAPI.settings.update(next);
      if (this.pendingScale === targetScale) this.pendingScale = null;
      if (this.pendingBubbleScale === targetBubbleScale) this.pendingBubbleScale = null;
      this.applySettings();
    } finally {
      this.scaleUpdating = false;
      if (this.pendingScale !== null && this.pendingBubbleScale !== null && !this.scaleCommitTimer) this.scheduleScaleCommit();
    }
  }

  private applySettings(): void {
    const targetScale = this.pendingScale ?? this.settings.appearance.scale;
    const scale = this.renderedScale ?? targetScale;
    const configuredBubbleScale = Math.min(1.3, Math.max(.8, this.pendingBubbleScale ?? this.settings.appearance.bubbleScale));
    // During wheel/slider scaling, use the actual native-window frame rather
    // than the final target so the pet, bubble and status pill stay in sync.
    const requestedBubbleScale = this.pendingScale !== null ? linkedBubbleScale(scale) : configuredBubbleScale;
    // At the smallest pet size, shrink the bubble slightly more than its
    // configured scale so it has clear separation from the head and remains
    // fully inside the native transparent window.
    const bubbleScale = Math.min(requestedBubbleScale, Math.min(1, .5 + scale * .5));
    const statusScale = Math.min(1.16, Math.max(.86, .72 + scale * .28));
    const bubbleWidth = Math.min(268, Math.max(128, (360 * scale - 36) / bubbleScale));
    const bubbleGap = Math.min(17, Math.max(9, 4 + scale * 8));
    // Keep the bubble above the character's head even at the 60% minimum
    // size. The previous low-scale anchor could intersect the head.
    const bubbleBottomPercent = Math.min(71.7, 63.5 + scale * 7.5);
    const bubbleFontSize = Math.min(22, Math.max(12, Number(this.settings.appearance.bubbleFontSize) || 15));
    document.documentElement.style.setProperty("--pet-scale", String(scale));
    document.documentElement.style.setProperty("--bubble-scale", String(bubbleScale));
    document.documentElement.style.setProperty("--bubble-width", `${bubbleWidth}px`);
    document.documentElement.style.setProperty("--bubble-gap", `${bubbleGap}px`);
    document.documentElement.style.setProperty("--bubble-bottom", `calc(${bubbleBottomPercent}% + ${bubbleGap}px)`);
    document.documentElement.style.setProperty("--status-scale", String(statusScale));
    document.documentElement.style.setProperty("--status-bottom", `${7 * scale}px`);
    document.documentElement.style.setProperty("--bubble-font", `${bubbleFontSize}px`);
    document.documentElement.style.setProperty("--bubble-opacity", String(this.settings.appearance.bubbleOpacity));
    document.documentElement.style.setProperty("--accent", this.settings.appearance.accentColor);
    const shell = this.root.querySelector<HTMLElement>(".pet-shell");
    shell?.classList.remove("theme-cream", "theme-dark", "theme-system");
    shell?.classList.add(`theme-${this.settings.appearance.theme}`);
    shell?.classList.toggle("energy-saving", this.settings.manualMode === "energy_saving");
    if(this.settings.manualMode!=="auto"){const label=this.root.querySelector<HTMLElement>(".status-pill span");if(label)label.textContent=this.modeStatusLabel()}
    this.updatePetName();
  }

  private modeStatusLabel(): string {
    return ({ dnd: "勿扰中", rest: "休息中", energy_saving: "节能陪伴中", low_battery: "低电量模拟", manual: "临时状态中" } as Record<string, string>)[this.settings.manualMode] ?? "陪伴中";
  }

  private effectiveIntensity(): "full" | "soft" | "minimal" {
    return this.settings.manualMode === "energy_saving" ? "minimal" : this.settings.appearance.animationIntensity;
  }

  private async toggleEnergySaving(): Promise<void> {
    this.settings.manualMode = this.settings.manualMode === "energy_saving" ? "auto" : "energy_saving";
    this.settings = await window.petAPI.settings.update(this.settings);
    this.applySettings();
    this.animator.setIntensity(this.effectiveIntensity());
    this.animator.setEnergySaving(this.settings.manualMode === "energy_saving");
  }

  private petName(): string { return this.settings.petName?.trim() || "珊珊"; }

  private updatePetName(): void {
    const name = this.petName();
    document.title = `${name}桌宠`;
    this.root.querySelector(".pet-shell")?.setAttribute("aria-label", `${name}桌宠`);
    this.root.querySelectorAll<HTMLElement>("[data-pet-name]").forEach((element) => { element.textContent = name; });
    const bubbleName = this.root.querySelector<HTMLElement>("[data-bubble-name]");
    if (bubbleName) bubbleName.textContent = name;
    const initial = this.root.querySelector<HTMLElement>("[data-pet-initial]");
    if (initial) initial.textContent = Array.from(name)[0] ?? "珊";
    const chatLabel = this.root.querySelector<HTMLElement>("[data-pet-chat-label]");
    if (chatLabel) chatLabel.textContent = `和${name}聊天`;
    const menuTitle = this.root.querySelector<HTMLElement>(".pet-context > small");
    if (menuTitle) menuTitle.textContent = `${name}快捷菜单`;
    const energyLabel = this.root.querySelector<HTMLElement>("[data-energy-label]");
    if (energyLabel) energyLabel.textContent = this.settings.manualMode === "energy_saving" ? "退出节能模式" : "开启节能模式";
  }

}
