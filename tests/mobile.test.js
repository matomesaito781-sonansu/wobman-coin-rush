"use strict";
(() => {
  const { World, STAGES, RADIUS, BASE_SPEED, canStand, clearSegment, insidePond } = CoinHopCore;
  const { FloatingJoystick } = CoinRushInput;
  const results = [], assert = (value, message) => { if (!value) throw new Error(message); };
  const near = (a, b) => Math.abs(a - b) < 0.001;
  function test(name, action) { try { action(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error.message }); } }
  function rng(seed = 101) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
  const make = index => new World(index, rng(), "portrait");
  for (let i = 0; i < 4; i++) {
    test(`縦長ステージ${i + 1}：540×800の座標と障害物がフィールド内に収まる`, () => {
      const w = make(i); assert(w.width === 540 && w.height === 800, "フィールドが縦長ではありません");
      assert(canStand(w.stage, w.player.x, w.player.y), "開始地点が柵と重複");
      for (const rect of w.stage.fences) assert(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width < w.width && rect.y + rect.height < w.height, "柵が範囲外");
      for (const pond of w.stage.ponds) assert(pond.x - pond.rx >= 0 && pond.x + pond.rx < w.width && pond.y - pond.ry >= 0 && pond.y + pond.ry < w.height, "池が範囲外");
    });
    test(`縦長ステージ${i + 1}：500枚のコインが到達可能・池と柵の外に出現`, () => {
      const w = make(i);
      for (let n = 0; n < 500; n++) {
        w.coins = []; w.spawnCoin(); assert(w.coins.length === 1, "コインが生成されません");
        const c = w.coins[0];
        assert(canStand(w.stage, c.x, c.y, RADIUS + 7), "柵や範囲外へ出現");
        assert(!w.stage.ponds.some(p => insidePond(c.x, c.y, p, 28)), "池に出現");
        assert(w.reachable.some(p => Math.hypot(p.x - c.x, p.y - c.y) < 10 && clearSegment(w.stage, p.x, p.y, c.x, c.y)), "到達できません");
      }
    });
    test(`縦長ステージ${i + 1}：60秒で終了し、終了後はドラッグ入力でも加点しない`, () => {
      const w = make(i); w.start(1000); w.update(0.016, 60999); assert(w.status === "playing", "早すぎる終了");
      const before = { ...w.player }; w.coins = [{ x: before.x, y: before.y, type: "rainbow" }];
      w.update(0.016, 61000, new Set(), { x: 1, y: 0 });
      assert(w.status === "finished" && w.score === 0 && w.player.x === before.x, "終了後に移動・加点");
    });
  }
  for (const [name, x, y, vector, limit] of [
    ["左", 240, 220, { x: 1, y: 0 }, p => p.x <= 290 - RADIUS],
    ["右", 465, 220, { x: -1, y: 0 }, p => p.x >= 420 + RADIUS],
    ["上", 350, 90, { x: 0, y: 1 }, p => p.y <= 150 - RADIUS],
    ["下", 350, 350, { x: 0, y: -1 }, p => p.y >= 370 * 800 / 960 + RADIUS]
  ]) test(`縦長ステージ：最大加速でも柵の${name}側をドラッグですり抜けない`, () => {
    const w = make(1); w.start(0); w.player.x = x; w.player.y = y; w.boostUntil = 60000;
    for (let frame = 1; frame <= 120; frame++) {
      w.update(0.016, frame * 16, new Set(), vector); assert(canStand(w.stage, w.player.x, w.player.y), "柵に埋まりました");
    }
    assert(limit(w.player), "柵を越えました");
  });
  test("縦長の上下左右の移動範囲に収まり、下端まで移動できる", () => {
    const w = make(0); w.start(0);
    for (const vector of [{ x: 1, y: 1 }, { x: -1, y: -1 }]) {
      for (let frame = 1; frame <= 160; frame++) w.update(0.05, 5000 + frame * 50, new Set(), vector);
      assert(w.player.x >= w.bounds.left && w.player.x <= w.bounds.right && w.player.y >= w.bounds.top && w.player.y <= w.bounds.bottom, "移動範囲外");
    }
    w.player.y = 700; w.update(0.05, 20000, new Set(), { x: 0, y: 1 }); assert(w.player.y > 700, "旧画面の下端で止まりました");
  });
  test("アナログ入力で斜めに動いても、直進と同じ速度", () => {
    const w = make(0); w.start(0); const before = { ...w.player };
    w.update(0.05, 50, new Set(), { x: 3, y: 4 });
    assert(near(Math.hypot(w.player.x - before.x, w.player.y - before.y), BASE_SPEED * .05), "斜めの速度が不正");
  });
  test("縦長でもコイン取得と加速・池の減速が動作", () => {
    const w = make(2); w.start(0);
    w.coins = [{ x: w.player.x, y: w.player.y, type: "blue" }, { x: w.player.x, y: w.player.y, type: "speed" }];
    w.update(0, 1000); assert(w.score === 2 && w.multiplier(1000) === 1.5, "コインの取得が不正");
    const pond = w.stage.ponds[0]; w.player.x = pond.x; w.player.y = pond.y - pond.ry - 1;
    w.update(.016, 2000, new Set(), { x: 0, y: 1 });
    assert(w.inPond && w.multiplier(2000) === .75 && w.slowUntil === 4000, "縦長の池判定が不正");
  });
  test("縦横の切り替えで、スコア・残り時間・効果期限を保持", () => {
    const w = new World(3, rng()); w.start(1000); w.score = 9; w.boostUntil = 9000; w.slowUntil = 7000; w.update(0, 5000);
    const deadline = w.deadline; w.setLayout("portrait");
    assert(w.width === 540 && w.score === 9 && w.remaining === 56 && w.deadline === deadline && w.multiplier(5000) === .75, "切り替えでリセットされました");
    assert(canStand(w.stage, w.player.x, w.player.y), "切り替え後に柵と重複");
    w.setLayout("landscape"); assert(w.width === 960 && w.height === 540 && w.score === 9 && w.deadline === deadline, "PCへ戻せません");
  });
  test("縦長からステージ変更・リスタートしても縦長のまま", () => {
    const w = make(0); w.start(0); w.setStage(3); w.start(1000);
    assert(w.width === 540 && w.height === 800 && w.stage.id === STAGES[3].id && w.remaining === 60 && w.score === 0, "縦長の設定が失われました");
  });
  test("ジョイスティック：触れただけ・10px以内では移動しない", () => {
    const j = new FloatingJoystick(); j.begin(1, 120, 200); j.move(1, 126, 208);
    assert(j.vector.x === 0 && j.vector.y === 0, "デッドゾーンで動きました");
    j.move(1, 131, 200); assert(j.vector.x === 1 && j.vector.y === 0, "閾値を超えても動きません");
  });
  test("ジョイスティック：方向変更・停止・基準点への戻りを即反映", () => {
    const j = new FloatingJoystick(); j.begin(4, 100, 100); j.move(4, 130, 140);
    assert(near(j.vector.x, .6) && near(j.vector.y, .8), "任意の方向に動けません");
    j.move(4, 60, 100); assert(j.vector.x === -1, "方向が変わりません");
    j.move(4, 100, 100); assert(j.vector.x === 0 && j.vector.y === 0, "基準点で止まりません");
    j.end(4); assert(j.pointerId === null && j.vector.x === 0 && j.vector.y === 0, "離しても入力が残りました");
  });
  test("ジョイスティック：別の指や古いポインターで操作を奪われない", () => {
    const j = new FloatingJoystick(); j.begin(1, 20, 20); assert(!j.begin(2, 80, 80), "2本目の指が操作を奪いました");
    j.move(1, 60, 20); j.move(2, 20, 60); j.end(2); assert(j.pointerId === 1 && j.vector.x === 1, "別の指のイベントで変化");
    j.reset(); j.move(1, 80, 20); assert(j.pointerId === null && j.vector.x === 0, "キャンセル後のイベントで移動");
  });
  window.mobileTestResults = results;
  document.getElementById("summary").textContent = `${results.filter(r => r.passed).length} / ${results.length} 件 成功`;
  document.getElementById("results").replaceChildren(...results.map(result => {
    const li = document.createElement("li"); li.className = result.passed ? "pass" : "fail"; li.textContent = `${result.passed ? "PASS" : "FAIL"} ${result.name}${result.error ? `：${result.error}` : ""}`; return li;
  }));
})();
