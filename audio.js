"use strict";

// すべて発振器によるオリジナルの音。音声ファイルや外部ライブラリは不要です。
(() => {
  class GameAudio {
    constructor() {
      this.bgmEnabled = true; this.sfxEnabled = true; this.active = false; this.visible = true;
      this.context = null; this.timer = null; this.musicNodes = new Set(); this.sfxNodes = new Set();
      this.supported = Boolean(window.AudioContext || window.webkitAudioContext);
      this.nextNoteTime = 0; this.beat = 0;
    }
    async unlock() {
      if (!this.supported) return false;
      try {
        if (!this.context) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          this.context = new AudioContextClass();
          this.musicGain = this.context.createGain(); this.musicGain.gain.value = 0.16;
          this.sfxGain = this.context.createGain(); this.sfxGain.gain.value = 0.24;
          this.musicGain.connect(this.context.destination); this.sfxGain.connect(this.context.destination);
        }
        if (this.context.state !== "running" && this.context.state !== "closed") await this.context.resume();
        return this.context.state === "running";
      } catch { return false; }
    }
    tone(frequency, at, duration, volume, wave, music = false, endFrequency = frequency) {
      if (!this.context || this.context.state !== "running" || !this.visible) return;
      const osc = this.context.createOscillator(), envelope = this.context.createGain();
      const nodes = music ? this.musicNodes : this.sfxNodes;
      nodes.add(osc); osc.type = wave;
      osc.frequency.setValueAtTime(frequency, at);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), at + duration);
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(volume, at + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.001, at + duration);
      osc.connect(envelope); envelope.connect(music ? this.musicGain : this.sfxGain);
      osc.onended = () => { nodes.delete(osc); osc.disconnect(); envelope.disconnect(); };
      osc.start(at); osc.stop(at + duration + 0.02);
    }
    stopNodes(nodes) {
      for (const osc of nodes) { try { osc.stop(); } catch { /* すでに停止している場合 */ } }
      nodes.clear();
    }
    stopMusic() {
      if (this.timer !== null) clearInterval(this.timer);
      this.timer = null; this.stopNodes(this.musicNodes);
    }
    schedule() {
      if (!this.active || !this.bgmEnabled || !this.visible || this.context?.state !== "running") return;
      const now = this.context.currentTime;
      if (this.nextNoteTime < now - 0.1) this.nextNoteTime = now + 0.04;
      // 120 BPM、8小節。跳ねるメロディーと柔らかなベースのループ。
      const melody = [72, 76, 79, 76, 74, 76, 79, 83, 81, 79, 76, 74, 72, 0, 67, 71,
        69, 72, 76, 79, 77, 76, 74, 72, 71, 74, 79, 77, 76, 74, 71, 0,
        72, 79, 76, 79, 83, 79, 76, 74, 69, 72, 77, 76, 74, 72, 69, 0,
        65, 69, 72, 76, 74, 72, 69, 67, 71, 74, 79, 74, 72, 0, 79, 0];
      const bass = [48, 45, 53, 43, 48, 45, 53, 43];
      const frequency = midi => 440 * 2 ** ((midi - 69) / 12);
      while (this.nextNoteTime < now + 0.16) {
        const index = this.beat % melody.length, note = melody[index];
        if (note) this.tone(frequency(note), this.nextNoteTime, 0.18, 0.4, "triangle", true);
        if (index % 2 === 0) this.tone(frequency(bass[Math.floor(index / 8)]), this.nextNoteTime, 0.23, 0.45, "sine", true);
        if (index % 4 === 0) this.tone(130, this.nextNoteTime, 0.08, 0.22, "sine", true, 50);
        this.beat++; this.nextNoteTime += 0.25;
      }
    }
    startMusic() {
      this.stopMusic();
      if (!this.active || !this.bgmEnabled || !this.visible || this.context?.state !== "running") return;
      this.nextNoteTime = this.context.currentTime + 0.04; this.beat = 0;
      this.schedule(); this.timer = setInterval(() => this.schedule(), 50);
    }
    async start() {
      this.active = true;
      const unlocked = await this.unlock();
      if (unlocked) this.startMusic();
      return unlocked;
    }
    async resumeFromGesture() { if (this.active && await this.unlock()) this.startMusic(); }
    finish() { this.active = false; this.stopMusic(); this.effect("finish"); }
    stop() { this.active = false; this.stopMusic(); this.stopNodes(this.sfxNodes); }
    async setBgm(enabled) {
      this.bgmEnabled = enabled;
      if (!enabled) this.stopMusic();
      else if (this.active && await this.unlock()) this.startMusic();
    }
    async setSfx(enabled) {
      this.sfxEnabled = enabled;
      if (!enabled) this.stopNodes(this.sfxNodes);
      else if (this.active) await this.unlock();
    }
    setVisible(visible) {
      this.visible = visible;
      if (!visible) { this.stopMusic(); this.stopNodes(this.sfxNodes); }
      else if (this.active) this.resumeFromGesture();
    }
    effect(kind) {
      if (!this.sfxEnabled || !this.context || !this.visible) return;
      const now = this.context.currentTime + 0.01;
      const sequences = {
        normal: [[880, 0, 0.09], [1320, 0.07, 0.14]],
        blue: [[784, 0, 0.12], [1175, 0.07, 0.12], [1568, 0.14, 0.2]],
        rainbow: [[1047, 0, 0.12], [1319, 0.06, 0.12], [1568, 0.12, 0.12], [2093, 0.18, 0.23]],
        speed: [[440, 0, 0.1], [659, 0.07, 0.1], [880, 0.14, 0.1], [1319, 0.21, 0.2]],
        pond: [[280, 0, 0.15, 120], [400, 0.06, 0.2, 180]],
        finish: [[784, 0, 0.18], [659, 0.18, 0.18], [523, 0.36, 0.45]]
      };
      for (const [frequency, delay, duration, end] of sequences[kind] || []) {
        this.tone(frequency, now + delay, duration, 0.55, "sine", false, end || frequency);
      }
    }
  }
  window.CoinHopAudio = GameAudio;
})();
