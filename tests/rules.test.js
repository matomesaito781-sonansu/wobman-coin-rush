"use strict";
(() => {
  function runTests() {
    const { World, STAGES, TYPES, BOUNDS, BASE_SPEED, RADIUS, canStand, clearSegment, insidePond } = window.CoinHopCore;
    const results = [];
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const near = (a, b, epsilon = 0.001) => Math.abs(a - b) < epsilon;
    function test(name, body) {
      try { body(); results.push({ name, passed: true }); }
      catch (error) { results.push({ name, passed: false, error: error.message }); }
    }
    function rng(seed = 42) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
    function worldAt(index = 0) { const world = new World(index, rng()); world.start(0); return world; }
    function travel(world, keys, frames = 80, start = 0) {
      for (let i = 1; i <= frames; i++) {
        world.update(0.016, start + i * 16, new Set(keys));
        assert(canStand(world.stage, world.player.x, world.player.y), "障害物と重なりました");
      }
    }

    for (let index = 0; index < STAGES.length; index++) {
      test(`ステージ${index + 1}：60秒で開始し、安全な出現場所を持つ`, () => {
        const world = worldAt(index);
        assert(world.remaining === 60 && world.status === "playing", "初期状態が不正");
        assert(world.spawnPoints.length > 100 && world.coins.length === 8, "出現候補が不足");
        assert(canStand(world.stage, world.player.x, world.player.y), "開始地点が柵と重複");
      });
      test(`ステージ${index + 1}：500枚のコインが通行可能・到達可能・池の外に出現`, () => {
        const world = worldAt(index);
        for (let i = 0; i < 500; i++) {
          world.coins = []; world.spawnCoin();
          assert(world.coins.length === 1, "コインを補充できません");
          const coin = world.coins[0];
          assert(canStand(world.stage, coin.x, coin.y, RADIUS + 7), "柵や画面外に出現");
          assert(!world.stage.ponds.some(pond => insidePond(coin.x, coin.y, pond, 28)), "池に出現");
          assert(world.reachable.some(point => Math.hypot(point.x - coin.x, point.y - coin.y) < 10 && clearSegment(world.stage, point.x, point.y, coin.x, coin.y)), "到達経路がありません");
        }
      });
      test(`ステージ${index + 1}：60秒ぴったりで終了し、終了後は移動・加点なし`, () => {
        const world = worldAt(index);
        world.update(0, 59999); assert(world.status === "playing", "早すぎる終了");
        const before = { ...world.player };
        world.coins = [{ x: before.x, y: before.y, type: "rainbow" }];
        world.update(0.016, 60000, new Set(["ArrowRight"]));
        assert(world.status === "finished" && world.remaining === 0, "終了判定が不正");
        assert(world.score === 0 && world.player.x === before.x, "時間切れ後に移動・加点");
        assert(world.events.filter(event => event.type === "finish").length === 1, "終了通知が不正");
        world.update(0.05, 61000, new Set(["ArrowRight"]));
        assert(world.score === 0 && world.events.length === 0, "終了処理が繰り返されました");
      });
    }
    test("閉じた柵の内側をコイン候補から除外", () => {
      for (const index of [1, 3]) {
        const world = worldAt(index), fences = world.stage.fences;
        for (let i = 0; i + 3 < fences.length; i += 4) {
          const top = fences[i], bottom = fences[i + 1];
          assert(!world.reachable.some(point => point.x > top.x && point.x < top.x + top.width && point.y > top.y && point.y < bottom.y), "柵の内側に到達可能点があります");
        }
      }
    });
    for (const [name, x, y, key, check] of [
      ["左側", 110, 180, "ArrowRight", p => p.x <= 180 - RADIUS + 0.001],
      ["右側", 440, 180, "ArrowLeft", p => p.x >= 370 + RADIUS - 0.001],
      ["上側", 270, 65, "ArrowDown", p => p.y <= 120 - RADIUS + 0.001],
      ["下側", 270, 290, "ArrowUp", p => p.y >= 250 + RADIUS - 0.001]
    ]) test(`最大加速でも柵の${name}を通り抜けない`, () => {
      const world = worldAt(1); world.player.x = x; world.player.y = y; world.boostUntil = 60000;
      travel(world, [key], 160); assert(check(world.player), "柵を越えました");
    });
    test("柵の角に斜め入力しても埋まらず、側面に沿って進める", () => {
      const world = worldAt(1); world.player.x = 145; world.player.y = 90; world.boostUntil = 60000;
      travel(world, ["ArrowRight", "ArrowDown"], 55);
      assert(canStand(world.stage, world.player.x, world.player.y), "角に埋まりました");
      const y = world.player.y; travel(world, ["ArrowDown"], 60, 1000);
      assert(world.player.y > y, "側面で動けなくなりました");
    });
    test("画面端からはみ出さない", () => {
      const world = worldAt(); world.player.x = BOUNDS.right - 1; world.player.y = BOUNDS.bottom - 1;
      travel(world, ["ArrowRight", "ArrowDown"]);
      assert(world.player.x === BOUNDS.right && world.player.y === BOUNDS.bottom, "画面外へ移動");
    });
    test("斜め移動と直進の速さが同じ", () => {
      const straight = worldAt(), diagonal = worldAt();
      straight.coins = []; diagonal.coins = [];
      straight.update(0.05, 50, new Set(["ArrowRight"]));
      diagonal.update(0.05, 50, new Set(["ArrowRight", "ArrowDown"]));
      assert(near(straight.player.x - 480, BASE_SPEED * 0.05), "直進の速度が不正");
      assert(near(Math.hypot(diagonal.player.x - 480, diagonal.player.y - 270), BASE_SPEED * 0.05), "斜め移動が速くなりました");
    });
    for (const [type, expected] of [["normal", 1], ["blue", 2], ["rainbow", 3], ["speed", 0]]) {
      test(`${type}コイン：取得は一度だけ、${expected}ポイント`, () => {
        const world = worldAt(); world.coins = [{ x: 480, y: 270, type }];
        world.update(0, 1000); assert(world.score === expected && world.coins.length === 0, "得点や消去が不正");
        world.update(0, 1016); assert(world.score === expected, "二重に加点");
        if (type === "speed") assert(world.boostUntil === 6000, "加速が5秒ではありません");
      });
    }
    test("特殊コインの出現率が通常より低い（10,000回）", () => {
      const world = worldAt(), counts = Object.fromEntries(Object.keys(TYPES).map(type => [type, 0]));
      for (let i = 0; i < 10000; i++) counts[world.chooseType()]++;
      assert(counts.normal > 6500 && counts.normal < 7500, "通常の出現率が不正");
      for (const type of ["blue", "rainbow", "speed"]) assert(counts[type] > 300 && counts[type] < counts.normal, `${type}の出現率が不正`);
    });
    test("加速は5秒、再取得で期限更新、倍率は1.5のまま", () => {
      const world = worldAt(); world.takeCoin({ type: "speed" }, 1000);
      assert(world.multiplier(5999) === 1.5 && world.multiplier(6000) === 1, "加速の終了時刻が不正");
      world.takeCoin({ type: "speed" }, 3000);
      assert(world.boostUntil === 8000 && world.multiplier(6001) === 1.5, "再取得が不正");
    });
    test("池への進入時だけ減速し、池の中でも2秒で通常速度へ戻る", () => {
      const world = worldAt(2); world.player.x = 270; world.player.y = 119; world.coins = [];
      world.update(0.016, 1000, new Set(["ArrowDown"]));
      assert(world.inPond && world.slowUntil === 3000 && world.multiplier(2999) === 0.5, "池の減速が不正");
      assert(world.events.filter(event => event.type === "pond").length === 1, "進入音イベントがありません");
      world.update(0, 3000); assert(world.multiplier(3000) === 1 && world.events.length === 0, "減速が延長されました");
      world.update(0.016, 3100, new Set(["ArrowDown"]));
      assert(world.slowUntil === 3000, "池の中で減速を再適用しました");
    });
    test("池から出て入り直すと、新たに2秒減速", () => {
      const world = worldAt(2); world.player.x = 270; world.player.y = 119; world.coins = [];
      world.update(0.016, 1000, new Set(["ArrowDown"]));
      travel(world, ["ArrowUp"], 6, 1000); assert(!world.inPond, "池から出られません");
      let entryTime = 0;
      for (let i = 0; i < 20; i++) {
        const now = 2000 + i * 16; world.update(0.016, now, new Set(["ArrowDown"]));
        if (world.events.some(event => event.type === "pond")) entryTime = now;
      }
      assert(entryTime > 0 && world.slowUntil === entryTime + 2000, "再進入が不正");
    });
    test("加速と池の減速の重複は0.75倍、各効果は独立して終了", () => {
      const world = worldAt(2); world.takeCoin({ type: "speed" }, 0);
      world.player.x = 270; world.player.y = 119; world.coins = [];
      world.update(0.016, 4000, new Set(["ArrowDown"]));
      assert(world.multiplier(4000) === 0.75, "重複時の速度が不正");
      assert(world.multiplier(5000) === 0.5 && world.multiplier(6000) === 1, "効果終了後の速度が不正");
      const second = worldAt(); second.boostUntil = 6000; second.slowUntil = 3000;
      assert(second.multiplier(2999) === 0.75 && second.multiplier(3000) === 1.5 && second.multiplier(6000) === 1, "減速が先に終わる場合が不正");
    });
    test("リスタート・ステージ変更でスコアと効果をリセット", () => {
      const world = worldAt(3); world.score = 99; world.boostUntil = 9000; world.slowUntil = 8000;
      world.start(1000);
      assert(world.score === 0 && world.remaining === 60 && world.multiplier(1000) === 1 && world.deadline === 61000, "リスタートが不正");
      world.setStage(1); assert(world.status === "ready" && world.stage.id === "park" && world.remaining === 60 && world.score === 0, "ステージ変更が不正");
    });
    return results;
  }
  window.runCoinHopTests = runTests;
  function showResults() {
    const results = runTests(), passed = results.filter(result => result.passed).length;
    const summary = document.getElementById("summary");
    summary.textContent = `${passed} / ${results.length} 件 成功`;
    summary.className = passed === results.length ? "pass" : "fail";
    document.getElementById("results").replaceChildren(...results.map(result => {
      const li = document.createElement("li"); li.className = result.passed ? "pass" : "fail";
      li.textContent = `${result.passed ? "PASS" : "FAIL"} ${result.name}${result.error ? `：${result.error}` : ""}`;
      return li;
    }));
  }
  document.getElementById("run").addEventListener("click", showResults); showResults();
})();
