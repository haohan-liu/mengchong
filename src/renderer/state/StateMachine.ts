import type { AnimationDefinition, PetState } from "../../types";

const priority: Record<PetState, number> = {
  BOOT: 0, APPEAR: 1, IDLE: 1, SLEEP: 2, LOW_BATTERY: 3, REACTION: 4,
  LISTENING: 5, USER_TYPING: 6, THINKING: 7, RESPONDING: 8, SUCCESS: 9,
  OFFLINE: 10, ERROR: 10, DRAGGING: 11, DISAPPEAR: 12
};

const stateActions: Record<PetState, string[]> = {
  BOOT: ["idle_breath"], APPEAR: ["wave_hello"], IDLE: ["idle_breath", "idle_blink", "idle_look_around"],
  LISTENING: ["listen"], USER_TYPING: ["user_typing", "type_fast"], THINKING: ["thinking", "loading"],
  RESPONDING: ["talk_normal"], SUCCESS: ["success"], ERROR: ["error"], OFFLINE: ["offline"],
  LOW_BATTERY: ["low_battery"], SLEEP: ["stand_sleep", "good_night"], DRAGGING: ["dragged"],
  REACTION: ["clicked"], DISAPPEAR: ["good_night"]
};

export class StateMachine {
  private state: PetState = "BOOT";
  private action = "idle_breath";
  private token = 0;
  private idleTimer = 0;
  private lastIdleAction = "";

  constructor(private readonly definitions: Map<string, AnimationDefinition>, private readonly play: (definition: AnimationDefinition) => void) {}

  get currentState(): PetState { return this.state; }
  get currentAction(): string { return this.action; }

  transition(next: PetState, requestedAction?: string, force = false): number {
    if (!force && priority[next] < priority[this.state] && this.state !== "IDLE") return this.token;
    const candidates = requestedAction ? [requestedAction] : stateActions[next];
    const available = candidates.filter((id) => this.definitions.has(id));
    const nextAction = available[Math.floor(Math.random() * Math.max(available.length, 1))] ?? "idle_breath";
    if (!force && next === this.state && nextAction === this.action) return this.token;
    this.state = next;
    this.action = nextAction;
    const definition = this.definitions.get(this.action) ?? this.definitions.get("idle_breath")!;
    this.token += 1;
    this.play(definition);
    this.scheduleIdle();
    void window.petAPI.pet.setState(next);
    void window.petAPI.pet.setAction(definition.id);
    return this.token;
  }

  reaction(action: string): void { this.transition("REACTION", action, true); }

  animationCompleted(action: string): void {
    const definition = this.definitions.get(action);
    void window.petAPI.pet.notifyAnimationEnd(action);
    if (!definition || definition.playMode !== "once") return;
    const returnTo = definition.returnTo ?? "idle_breath";
    this.state = "IDLE";
    this.action = returnTo;
    this.play(this.definitions.get(returnTo)!);
    this.scheduleIdle();
    void window.petAPI.pet.setState("IDLE");
    void window.petAPI.pet.setAction(returnTo);
  }

  private scheduleIdle(): void {
    window.clearTimeout(this.idleTimer);
    if (this.state !== "IDLE") return;
    const delay = 8000 + Math.random() * 10000;
    this.idleTimer = window.setTimeout(() => {
      const pool = stateActions.IDLE.filter((id) => id !== this.lastIdleAction && id !== "idle_breath");
      const action = pool[Math.floor(Math.random() * pool.length)] ?? "idle_breath";
      this.lastIdleAction = action;
      this.action = action;
      this.play(this.definitions.get(action)!);
      this.scheduleIdle();
    }, delay);
  }
}
