import { beforeEach, describe, expect, it, vi } from "vitest";
import { StateMachine } from "../src/renderer/state/StateMachine";
import type { AnimationDefinition } from "../src/types";

const definition = (id: string, playMode: "loop" | "once" = "loop"): AnimationDefinition => ({ id, category: "test", name: id, frames: 2, fps: 8, playMode, prompt: "", returnTo: playMode === "once" ? "idle_breath" : null });

describe("StateMachine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(globalThis, {
      window: {
        setTimeout, clearTimeout,
        petAPI: { pet: { setState: vi.fn(), setAction: vi.fn(), notifyAnimationEnd: vi.fn() } }
      }
    });
  });

  it("keeps the higher-priority state until forced", () => {
    const map = new Map([definition("idle_breath"), definition("thinking")].map((item) => [item.id, item]));
    const machine = new StateMachine(map, vi.fn());
    machine.transition("THINKING", "thinking", true);
    machine.transition("IDLE", "idle_breath");
    expect(machine.currentState).toBe("THINKING");
    machine.transition("IDLE", "idle_breath", true);
    expect(machine.currentState).toBe("IDLE");
  });

  it("returns once actions to idle_breath", () => {
    const map = new Map([definition("idle_breath"), definition("success", "once")].map((item) => [item.id, item]));
    const machine = new StateMachine(map, vi.fn());
    machine.transition("SUCCESS", "success", true);
    machine.animationCompleted("success");
    expect(machine.currentState).toBe("IDLE");
    expect(machine.currentAction).toBe("idle_breath");
  });

  it("does not restart an unchanged state and action", () => {
    const play = vi.fn();
    const map = new Map([definition("idle_breath")].map((item) => [item.id, item]));
    const machine = new StateMachine(map, play);
    machine.transition("IDLE", "idle_breath", true);
    machine.transition("IDLE", "idle_breath");
    expect(play).toHaveBeenCalledTimes(1);
    expect(window.petAPI.pet.setState).toHaveBeenCalledTimes(1);
    expect(window.petAPI.pet.setAction).toHaveBeenCalledTimes(1);
  });
});
