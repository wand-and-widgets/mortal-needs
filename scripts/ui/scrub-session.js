// Pointer previews are local. A caller receives a single value only on release.
export class ScrubSession {
  constructor(value, x, { min = 0, max = 100 } = {}) {
    this.startValue = value;
    this.startX = x;
    this.min = min;
    this.max = max;
    this.value = value;
    this.moved = false;
    this.finished = false;
  }
  move(x, fine = false) {
    if (this.finished) return this.value;
    const delta = x - this.startX;
    if (Math.abs(delta) >= 3) this.moved = true;
    if (this.moved) this.value = Math.round(Math.max(this.min, Math.min(this.max,
      this.startValue + delta * (this.max - this.min) / (fine ? 600 : 120))));
    return this.value;
  }
  finish(cancelled = false) {
    if (this.finished) return null;
    this.finished = true;
    return cancelled || !this.moved || this.value === this.startValue ? null : this.value;
  }
}
