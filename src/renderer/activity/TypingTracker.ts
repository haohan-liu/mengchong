export class TypingTracker {
  private lastInputAt: number | null = null;
  private fast = false;

  update(timestamp: number, keyboardPulse: boolean, keyboardCount10s: number): "typing" | "fast" | null {
    if (keyboardPulse) this.lastInputAt = timestamp;
    const active = keyboardPulse || (this.lastInputAt !== null && timestamp - this.lastInputAt <= 2_200);
    if (!active) {
      this.fast = false;
      return null;
    }
    if (!this.fast && keyboardCount10s >= 12) this.fast = true;
    else if (this.fast && keyboardCount10s < 6) this.fast = false;
    return this.fast ? "fast" : "typing";
  }

  reset(): void {
    this.lastInputAt = null;
    this.fast = false;
  }
}

