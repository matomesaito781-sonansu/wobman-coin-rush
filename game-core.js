"use strict";

// 描画・音声から独立したルール。座標、当たり判定、効果時間をここで管理します。
(() => {
  const WIDTH = 960, HEIGHT = 540, DURATION = 60;
  const RADIUS = 21, BASE_SPEED = 275, STEP = 20;
  const BOUNDS = Object.freeze({ left: 42, top: 52, right: 918, bottom: 498 });
  const LAYOUTS = Object.freeze({
    landscape: Object.freeze({ width: WIDTH, height: HEIGHT, bounds: BOUNDS }),
    portrait: Object.freeze({ width: 540, height: 800, bounds: Object.freeze({ left: 42, top: 52, right: 498, bottom: 758 }) })
  });
  const TYPES = Object.freeze({
    normal: { points: 1, weight: 70, color: "#ffd04b", edge: "#b77b16", symbol: "1" },
    blue: { points: 2, weight: 15, color: "#66c6ff", edge: "#246eae", symbol: "2" },
    rainbow: { points: 3, weight: 8, color: "#ffb6e9", edge: "#8846b5", symbol: "3" },
    speed: { points: 0, weight: 7, color: "#a4f57c", edge: "#448446", symbol: "ϟ" }
  });
  function enclosure(x, y, width, height) {
    const t = 14;
    return [{ x, y, width, height: t }, { x, y: y + height - t, width, height: t },
      { x, y, width: t, height }, { x: x + width - t, y, width: t, height }];
  }
  const STAGES = [
    { id: "meadow", name: "草原", label: "MEADOW", description: "障害物のない、のびのび草原。", fences: [], ponds: [] },
    { id: "park", name: "公園", label: "CLOVER PARK", description: "柵をよけて、コインを探そう。", fences: [...enclosure(180, 120, 190, 130), ...enclosure(610, 300, 180, 130), { x: 610, y: 115, width: 170, height: 14 }], ponds: [] },
    { id: "pond", name: "散歩道", label: "POND WALK", description: "池に入ると、2秒間スローダウン。", fences: [], ponds: [{ x: 270, y: 185, rx: 105, ry: 65 }, { x: 710, y: 365, rx: 115, ry: 65 }] },
    { id: "plaza", name: "広場", label: "RUSH PLAZA", description: "柵と池を抜けて、最高記録へ！", fences: [...enclosure(150, 130, 170, 145), ...enclosure(635, 310, 175, 120)], ponds: [{ x: 700, y: 165, rx: 115, ry: 60 }, { x: 380, y: 400, rx: 105, ry: 60 }] }
  ];
  STAGES.forEach(stage => {
    stage.fences.forEach(Object.freeze);
    stage.ponds.forEach(Object.freeze);
    Object.freeze(stage.fences); Object.freeze(stage.ponds); Object.freeze(stage);
  });
  Object.freeze(STAGES);

  function projectPoint(layout, x, y) {
    return layout === "portrait" ? { x: HEIGHT - y, y: x * LAYOUTS.portrait.height / WIDTH } : { x, y };
  }
  function createStage(index, layout) {
    const source = STAGES[index] || STAGES[0], dimensions = LAYOUTS[layout];
    const fences = layout === "portrait" ? source.fences.map(rect => ({
      x: HEIGHT - rect.y - rect.height, y: rect.x * dimensions.height / WIDTH,
      width: rect.height, height: rect.width * dimensions.height / WIDTH
    })) : source.fences;
    const ponds = layout === "portrait" ? source.ponds.map(pond => ({
      ...projectPoint(layout, pond.x, pond.y), rx: pond.ry, ry: pond.rx * dimensions.height / WIDTH
    })) : source.ponds;
    return { ...source, ...dimensions, layout, fences, ponds };
  }

  function circleHitsRect(x, y, radius, rect) {
    const closestX = Math.max(rect.x, Math.min(x, rect.x + rect.width));
    const closestY = Math.max(rect.y, Math.min(y, rect.y + rect.height));
    return Math.hypot(x - closestX, y - closestY) < radius;
  }
  function insidePond(x, y, pond, margin = 0) {
    return ((x - pond.x) / (pond.rx + margin)) ** 2 + ((y - pond.y) / (pond.ry + margin)) ** 2 < 1;
  }
  function canStand(stage, x, y, radius = RADIUS) {
    const bounds = stage.bounds || BOUNDS;
    return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom &&
      !stage.fences.some(rect => circleHitsRect(x, y, radius, rect));
  }
  function clearSegment(stage, x1, y1, x2, y2, radius = RADIUS) {
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 4));
    for (let i = 0; i <= steps; i++) {
      if (!canStand(stage, x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps, radius)) return false;
    }
    return true;
  }

  // 角では円と矩形の接触法線に沿って押し戻し、接線方向の移動を残します。
  // X/Yを個別に止める方式で発生する、角への引っかかりを防ぎます。
  function resolveMove(stage, x, y, previousX, previousY) {
    const radius = RADIUS + 0.01;
    const bounds = stage.bounds || BOUNDS;
    for (let pass = 0; pass < 6; pass++) {
      x = Math.max(bounds.left, Math.min(bounds.right, x));
      y = Math.max(bounds.top, Math.min(bounds.bottom, y));
      for (const rect of stage.fences) {
        const closestX = Math.max(rect.x, Math.min(x, rect.x + rect.width));
        const closestY = Math.max(rect.y, Math.min(y, rect.y + rect.height));
        const dx = x - closestX, dy = y - closestY, distance = Math.hypot(dx, dy);
        if (distance >= radius) continue;
        if (distance > 0.0001) {
          x = closestX + dx / distance * radius;
          y = closestY + dy / distance * radius;
        } else {
          const exits = [
            { distance: x - rect.x, x: rect.x - radius, y },
            { distance: rect.x + rect.width - x, x: rect.x + rect.width + radius, y },
            { distance: y - rect.y, x, y: rect.y - radius },
            { distance: rect.y + rect.height - y, x, y: rect.y + rect.height + radius }
          ];
          const nearest = exits.reduce((a, b) => a.distance < b.distance ? a : b);
          x = nearest.x; y = nearest.y;
        }
      }
      if (canStand(stage, x, y)) return { x, y };
    }
    return { x: previousX, y: previousY };
  }

  // スタート地点から到達できる格子点だけを幅優先探索で集めます。
  // 閉じた柵の内側は除外され、コインはさらに池や柵から離して配置します。
  function findReachable(stage) {
    const bounds = stage.bounds || BOUNDS;
    const center = { x: (stage.width || WIDTH) / 2, y: (stage.height || HEIGHT) / 2 };
    const columns = Math.floor((bounds.right - bounds.left) / STEP) + 1;
    const rows = Math.floor((bounds.bottom - bounds.top) / STEP) + 1;
    const nodes = Array.from({ length: columns * rows }, (_, index) => ({
      x: bounds.left + (index % columns) * STEP,
      y: bounds.top + Math.floor(index / columns) * STEP
    }));
    let start = -1, distance = Infinity;
    nodes.forEach((node, index) => {
      const d = Math.hypot(node.x - center.x, node.y - center.y);
      if (d < distance && clearSegment(stage, center.x, center.y, node.x, node.y)) { start = index; distance = d; }
    });
    if (start < 0) throw new Error("スタート地点に通行可能な経路がありません。");
    const queue = [start], visited = new Set(queue);
    for (let head = 0; head < queue.length; head++) {
      const index = queue[head], column = index % columns, row = Math.floor(index / columns);
      const neighbors = [];
      if (column > 0) neighbors.push(index - 1);
      if (column + 1 < columns) neighbors.push(index + 1);
      if (row > 0) neighbors.push(index - columns);
      if (row + 1 < rows) neighbors.push(index + columns);
      for (const next of neighbors) {
        if (visited.has(next)) continue;
        if (clearSegment(stage, nodes[index].x, nodes[index].y, nodes[next].x, nodes[next].y)) {
          visited.add(next); queue.push(next);
        }
      }
    }
    return queue.map(index => nodes[index]);
  }

  class World {
    constructor(stageIndex = 0, random = Math.random, layout = "landscape") {
      this.random = random;
      this.layout = LAYOUTS[layout] ? layout : "landscape";
      this.setStage(stageIndex);
    }
    setStage(index) {
      this.stageIndex = STAGES[index] ? index : 0;
      this.stage = createStage(this.stageIndex, this.layout);
      this.width = this.stage.width; this.height = this.stage.height; this.bounds = this.stage.bounds;
      this.reachable = findReachable(this.stage);
      this.spawnPoints = this.reachable.filter(point => canStand(this.stage, point.x, point.y, RADIUS + 7) && !this.stage.ponds.some(pond => insidePond(point.x, point.y, pond, 28)));
      this.reset();
    }
    setLayout(layout) {
      if (!LAYOUTS[layout] || layout === this.layout) return false;
      const oldLayout = this.layout, oldPlayer = { ...this.player };
      const saved = Object.fromEntries(["status", "score", "deadline", "remaining", "boostUntil", "slowUntil"].map(key => [key, this[key]]));
      const base = oldLayout === "portrait" ? { x: oldPlayer.y * WIDTH / LAYOUTS.portrait.height, y: HEIGHT - oldPlayer.x } : oldPlayer;
      this.layout = layout; this.setStage(this.stageIndex);
      Object.assign(this, saved);
      const mapped = projectPoint(layout, base.x, base.y);
      const nearest = this.reachable.reduce((a, b) => Math.hypot(a.x - mapped.x, a.y - mapped.y) < Math.hypot(b.x - mapped.x, b.y - mapped.y) ? a : b);
      const safe = clearSegment(this.stage, nearest.x, nearest.y, mapped.x, mapped.y) ? mapped : nearest;
      Object.assign(this.player, safe, { stride: oldPlayer.stride, moving: false });
      this.inPond = this.stage.ponds.some(pond => insidePond(this.player.x, this.player.y, pond));
      this.coins = []; for (let i = 0; i < 8; i++) this.spawnCoin();
      return true;
    }
    reset() {
      this.status = "ready"; this.score = 0; this.deadline = 0; this.remaining = DURATION;
      this.player = { x: this.width / 2, y: this.height / 2, radius: RADIUS, moving: false, stride: 0 };
      this.boostUntil = 0; this.slowUntil = 0; this.inPond = false;
      this.coins = []; this.events = []; this.spawnElapsed = 0;
      for (let i = 0; i < 8; i++) this.spawnCoin();
    }
    start(now) { this.reset(); this.status = "playing"; this.deadline = now + DURATION * 1000; }
    multiplier(now) { return (now < this.boostUntil ? 1.5 : 1) * (now < this.slowUntil ? 0.5 : 1); }
    chooseType() {
      let value = this.random() * 100;
      for (const [type, config] of Object.entries(TYPES)) { value -= config.weight; if (value < 0) return type; }
      return "normal";
    }
    spawnCoin() {
      if (this.coins.length >= 8 || !this.spawnPoints.length) return;
      for (let attempt = 0; attempt < 160; attempt++) {
        const base = this.spawnPoints[Math.floor(this.random() * this.spawnPoints.length)];
        const x = base.x + (this.random() - 0.5) * 12;
        const y = base.y + (this.random() - 0.5) * 12;
        if (!canStand(this.stage, x, y, RADIUS + 7) || !clearSegment(this.stage, base.x, base.y, x, y, RADIUS + 7)) continue;
        if (this.stage.ponds.some(pond => insidePond(x, y, pond, 28))) continue;
        if (Math.hypot(x - this.player.x, y - this.player.y) < 78) continue;
        if (this.coins.some(coin => Math.hypot(x - coin.x, y - coin.y) < 58)) continue;
        this.coins.push({ x, y, type: this.chooseType(), phase: this.random() * Math.PI * 2 });
        return;
      }
    }
    takeCoin(coin, now) {
      this.score += TYPES[coin.type].points;
      if (coin.type === "speed") this.boostUntil = now + 5000; // 再取得は5秒に更新、倍率は重ねない
      this.events.push({ type: "coin", coin });
    }
    update(rawDt, now, keys = new Set(), analog = null) {
      this.events = [];
      if (this.status !== "playing") return;
      this.remaining = Math.max(0, (this.deadline - now) / 1000);
      if (this.remaining <= 0) {
        this.status = "finished"; this.player.moving = false;
        this.events.push({ type: "finish" }); return;
      }
      const dt = Math.min(Math.max(rawDt, 0), 0.05);
      let dx = Number(keys.has("ArrowRight")) - Number(keys.has("ArrowLeft"));
      let dy = Number(keys.has("ArrowDown")) - Number(keys.has("ArrowUp"));
      if (analog && Number.isFinite(analog.x) && Number.isFinite(analog.y) && Math.hypot(analog.x, analog.y) > 0) { dx = analog.x; dy = analog.y; }
      const length = Math.hypot(dx, dy);
      const beforeX = this.player.x, beforeY = this.player.y;
      if (length) {
        dx /= length; dy /= length;
        // 最大加速時でも細かく移動し、薄い柵のすり抜けを防ぎます。
        const steps = Math.max(1, Math.ceil(BASE_SPEED * 1.5 * dt / 5));
        for (let step = 0; step < steps; step++) {
          const distance = BASE_SPEED * this.multiplier(now) * dt / steps;
          const resolved = resolveMove(this.stage, this.player.x + dx * distance, this.player.y + dy * distance, this.player.x, this.player.y);
          this.player.x = resolved.x; this.player.y = resolved.y;
          const wet = this.stage.ponds.some(pond => insidePond(this.player.x, this.player.y, pond));
          if (wet && !this.inPond) { this.slowUntil = now + 2000; this.events.push({ type: "pond", x: this.player.x, y: this.player.y }); }
          this.inPond = wet;
        }
      }
      this.player.moving = Math.hypot(this.player.x - beforeX, this.player.y - beforeY) > 0.01;
      if (this.player.moving) this.player.stride += dt;
      this.coins = this.coins.filter(coin => {
        if (Math.hypot(this.player.x - coin.x, this.player.y - coin.y) < RADIUS + 15) { this.takeCoin(coin, now); return false; }
        return true;
      });
      this.spawnElapsed += dt;
      if (this.spawnElapsed >= 0.65) { this.spawnElapsed %= 0.65; this.spawnCoin(); }
    }
  }
  window.CoinHopCore = Object.freeze({ World, STAGES, TYPES, WIDTH, HEIGHT, DURATION, BOUNDS, BASE_SPEED, RADIUS, LAYOUTS, projectPoint, canStand, clearSegment, insidePond });
})();
