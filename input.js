"use strict";
(() => {
  // 入力の距離はCSSピクセル。Canvasの解像度や端末の拡大率に依存させません。
  class FloatingJoystick {
    constructor(deadZone = 10, maxTravel = 36) {
      this.deadZone = deadZone; this.maxTravel = maxTravel; this.reset();
    }
    reset() { this.pointerId = null; this.origin = null; this.knob = null; this.vector = { x: 0, y: 0 }; }
    begin(pointerId, x, y) {
      if (this.pointerId !== null || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      this.pointerId = pointerId; this.origin = { x, y }; this.knob = { x, y }; this.vector = { x: 0, y: 0 }; return true;
    }
    move(pointerId, x, y) {
      if (pointerId !== this.pointerId || !this.origin || !Number.isFinite(x) || !Number.isFinite(y)) return;
      const dx = x - this.origin.x, dy = y - this.origin.y, length = Math.hypot(dx, dy);
      const displayScale = length ? Math.min(this.maxTravel, length) / length : 0;
      this.knob = { x: this.origin.x + dx * displayScale, y: this.origin.y + dy * displayScale };
      this.vector = length > this.deadZone ? { x: dx / length, y: dy / length } : { x: 0, y: 0 };
    }
    end(pointerId) { if (pointerId === this.pointerId) this.reset(); }
  }
  window.CoinRushInput = Object.freeze({ FloatingJoystick });
})();
