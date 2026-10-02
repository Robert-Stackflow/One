export class CornerTrigger {
  private active: string | null = null; private entered = 0; private last = -Infinity; private consumed = false;
  update(corner: string | null, now: number, dwell: number, cooldown: number): string | null {
    if (corner !== this.active) { this.active = corner; this.entered = now; this.consumed = false; }
    if (!corner || this.consumed || now - this.entered < dwell || now - this.last < cooldown) return null;
    this.consumed = true; this.last = now; return corner;
  }
  suppress() { this.consumed = true; }
  reset() { this.active = null; this.consumed = false; }
}
