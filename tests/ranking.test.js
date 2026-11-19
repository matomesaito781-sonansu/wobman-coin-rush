"use strict";
(async () => {
  const { LocalRankingRepository: Repository, normalizeName, STORAGE_KEY } = window.CoinRushRanking;
  const results = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  function storage() { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; }
  async function rejects(action) { let rejected = false; try { await action(); } catch { rejected = true; } assert(rejected, "不正な入力を受け入れました"); }
  async function test(name, fn) { try { await fn(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error.message }); } }
  const entry = (stageId, playerId, score) => ({ stageId, playerId, score });
  await test("名前の2〜12文字の境界・日本語・空白除去", async () => {
    assert(normalizeName("  まん  ") === "まん", "前後空白が残っています");
    assert(normalizeName("あ".repeat(12)).length === 12, "12文字を受け入れません");
    await rejects(() => normalizeName("あ")); await rejects(() => normalizeName("あ".repeat(13))); await rejects(() => normalizeName("\n\t"));
  });
  await test("名前と選択中プレイヤーを再読み込みして保持", async () => {
    const db = storage(), repo = new Repository(db), player = await repo.saveProfile("まんちゃん");
    const reloaded = await new Repository(db).getProfile(); assert(reloaded.id === player.id && reloaded.name === player.name, "名前が消えました");
  });
  await test("同一プレイヤーの自己ベスト1件のみ掲載", async () => {
    const repo = new Repository(storage()), p = await repo.saveProfile("プレイヤー");
    for (const score of [3, 8, 5, 8, 2]) await repo.submitScore(entry("meadow", p.id, score));
    const list = await repo.listTop("meadow"); assert(list.length === 1 && list[0].score === 8, "自己ベスト以外が残りました");
  });
  await test("4ステージの記録を独立して保持", async () => {
    const repo = new Repository(storage()), p = await repo.saveProfile("ステージ");
    for (const [index, stage] of ["meadow", "park", "pond", "plaza"].entries()) await repo.submitScore(entry(stage, p.id, index + 1));
    for (const [index, stage] of ["meadow", "park", "pond", "plaza"].entries()) assert((await repo.listTop(stage))[0].score === index + 1, "別ステージへ混入");
  });
  await test("同一ミリ秒の同点でも、記録した順に順位付け", async () => {
    const repo = new Repository(storage(), () => 1000);
    for (const name of ["先着", "後着"]) { const p = await repo.saveProfile(name, true); await repo.submitScore(entry("park", p.id, 10)); }
    const list = await repo.listTop("park"); assert(list[0].name === "先着" && list[1].name === "後着", "先着順ではありません");
  });
  await test("同点再プレイは元の記録順を変更しない", async () => {
    const repo = new Repository(storage()), first = await repo.saveProfile("先着"); await repo.submitScore(entry("park", first.id, 10));
    const second = await repo.saveProfile("後着", true); await repo.submitScore(entry("park", second.id, 10));
    const before = (await repo.listTop("park"))[0]; await repo.submitScore(entry("park", first.id, 10));
    const after = (await repo.listTop("park"))[0]; assert(before.order === after.order && after.playerId === first.id, "同点で順序を上書き");
  });
  await test("新しい自己ベストは、そのスコアの新しい記録順になる", async () => {
    const repo = new Repository(storage()), a = await repo.saveProfile("最初"); await repo.submitScore(entry("pond", a.id, 5));
    const b = await repo.saveProfile("次の人", true); await repo.submitScore(entry("pond", b.id, 9));
    await repo.submitScore(entry("pond", a.id, 9)); assert((await repo.listTop("pond"))[0].playerId === b.id, "改善前の順序を流用");
  });
  await test("TOP30だけを表示し、31位以下の自己ベストも保持", async () => {
    const repo = new Repository(storage()); let first;
    for (let i = 0; i < 35; i++) { const p = await repo.saveProfile(`プレイヤー${i}`, true); if (i === 0) first = p; await repo.submitScore(entry("plaza", p.id, i)); }
    let list = await repo.listTop("plaza", 100); assert(list.length === 30 && list[0].score === 34 && list.at(-1).score === 5, "上位30件の並びが不正");
    await repo.submitScore(entry("plaza", first.id, 40)); list = await repo.listTop("plaza"); assert(list[0].playerId === first.id && list.length === 30, "圏外から更新できません");
  });
  await test("名前変更でもID・自己ベスト・記録順を維持", async () => {
    const repo = new Repository(storage()), p = await repo.saveProfile("旧ニックネーム"); await repo.submitScore(entry("meadow", p.id, 11));
    const before = (await repo.listTop("meadow"))[0]; const renamed = await repo.saveProfile("新ニックネーム"); const after = (await repo.listTop("meadow"))[0];
    assert(renamed.id === p.id && after.name === "新ニックネーム" && after.score === 11 && after.order === before.order, "変更で記録が変化");
  });
  await test("プレイヤー切り替えと重複名の拒否", async () => {
    const repo = new Repository(storage()), a = await repo.saveProfile("ＡＢ"), b = await repo.saveProfile("別の人", true);
    await rejects(() => repo.saveProfile("ab", true)); await repo.selectPlayer(a.id);
    assert((await repo.getProfile()).id === a.id && b.id !== a.id, "プレイヤーが混同");
  });
  await test("HTML風の名前は名前の文字列のまま保持", async () => {
    const repo = new Repository(storage()), p = await repo.saveProfile("<b>名前</b>"); await repo.submitScore(entry("park", p.id, 2));
    assert((await repo.listTop("park"))[0].name === "<b>名前</b>", "名前が変換されました");
  });
  await test("保存不可でも、このページ内では名前・ランキングを保持", async () => {
    const repo = new Repository({ getItem() { throw new Error("禁止"); }, setItem() { throw new Error("禁止"); } });
    const p = await repo.saveProfile("保存テスト"); await repo.submitScore(entry("meadow", p.id, 4));
    assert(!repo.persistent && (await repo.listTop("meadow"))[0].score === 4 && (await repo.getProfile()).name === p.name, "一時保存できません");
  });
  await test("既存の最高記録や他の保存キーを書き換えない", async () => {
    const db = storage(); db.setItem("coin-hop-best-v2", '{"meadow":99}'); db.setItem("existing-user-name", "大切な名前");
    const repo = new Repository(db); await repo.saveProfile("新しい名前");
    assert(db.getItem("coin-hop-best-v2") === '{"meadow":99}' && db.getItem("existing-user-name") === "大切な名前", "既存キーが変わりました");
  });
  await test("負数・小数・無限大・不明なステージを拒否", async () => {
    const repo = new Repository(storage()), p = await repo.saveProfile("検証用");
    for (const score of [-1, 1.5, Infinity, NaN]) await rejects(() => repo.submitScore(entry("meadow", p.id, score)));
    await rejects(() => repo.submitScore(entry("unknown", p.id, 1))); assert((await repo.listTop("meadow")).length === 0, "不正な記録が残りました");
  });
  await test("0点も終了記録として登録できる", async () => {
    const repo = new Repository(storage()), p = await repo.saveProfile("ゼロ点"); await repo.submitScore(entry("meadow", p.id, 0));
    assert((await repo.listTop("meadow"))[0].score === 0, "0点を保存できません");
  });
  await test("時刻を戻しても同点の先着順を維持", async () => {
    let time = 2000; const repo = new Repository(storage(), () => time);
    const a = await repo.saveProfile("時計の前"); await repo.submitScore(entry("meadow", a.id, 1)); time = 1000;
    const b = await repo.saveProfile("時計の後", true); await repo.submitScore(entry("meadow", b.id, 1));
    assert((await repo.listTop("meadow"))[0].playerId === a.id, "時計変更で順位が逆転");
  });
  await test("壊れた保存データでも初期画面を読み込める", async () => {
    const db = storage(); db.setItem(STORAGE_KEY, "invalid json"); const repo = new Repository(db);
    assert(await repo.getProfile() === null && (await repo.listTop("meadow")).length === 0, "初期化に失敗");
  });
  window.rankingTestResults = results;
  const passed = results.filter(result => result.passed).length;
  document.getElementById("summary").textContent = `${passed} / ${results.length} 件 成功`;
  document.getElementById("results").replaceChildren(...results.map(result => {
    const li = document.createElement("li"); li.className = result.passed ? "pass" : "fail"; li.textContent = `${result.passed ? "PASS" : "FAIL"} ${result.name}${result.error ? `：${result.error}` : ""}`; return li;
  }));
})();
