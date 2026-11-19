"use strict";

(() => {
  const { World, STAGES, TYPES, WIDTH, HEIGHT, DURATION } = window.CoinHopCore;
  const $ = id => document.getElementById(id);
  const canvas = $("game-canvas"), ctx = canvas.getContext("2d");
  const overlay = $("overlay"), startButton = $("start-button"), restartButton = $("restart-button");
  const stageSelect = $("stage-select"), announcement = $("announcement");
  const audio = new window.CoinHopAudio();
  const world = new World();
  // 将来の接続時は、この1行を同じ非同期APIのFirestoreアダプターに差し替えます。
  const rankingRepository = new window.CoinRushRanking.LocalRankingRepository();
  let profile = null, creatingPlayer = false, profileReady = false, sessionPlayer = null;
  let runVersion = 0, rankingVersion = 0;
  const pressedKeys = new Set(), touchDirections = new Map();
  const directions = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const character = new Image();
  const STORAGE_KEY = "coin-hop-best-v2";
  let characterReady = false, lastTime = performance.now(), particles = [], popups = [];
  let displayedScore = -1, displayedSeconds = -1;
  let records = readRecords();
  const background = document.createElement("canvas");
  background.width = WIDTH; background.height = HEIGHT;
  const bg = background.getContext("2d");

  function validScore(value) { return Number.isSafeInteger(value) && value >= 0; }
  function readRecords() {
    const result = Object.fromEntries(STAGES.map(stage => [stage.id, 0]));
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      for (const stage of STAGES) if (validScore(saved?.[stage.id])) result[stage.id] = saved[stage.id];
      const old = Number(localStorage.getItem("coin-hop-best-v1"));
      if (validScore(old)) result.meadow = Math.max(result.meadow, old);
    } catch { /* 保存を禁止している環境でも、その場で記録を保持 */ }
    return result;
  }
  function showPoints(element, points) {
    element.replaceChildren(document.createTextNode(String(points)));
    const unit = document.createElement("span"); unit.textContent = "pt"; element.append(unit);
  }
  function showBest() {
    showPoints($("best"), records[world.stage.id]);
    $("best-stage").textContent = "端末ベスト";
    $("stage-records").replaceChildren(...STAGES.map((stage, index) => {
      const item = document.createElement("span");
      item.className = stage.id === world.stage.id ? "current-record" : "";
      item.textContent = `${index + 1}. ${stage.name} ${records[stage.id]}pt`;
      return item;
    }));
  }
  function clearInput() {
    pressedKeys.clear(); touchDirections.clear(); world.player.moving = false;
    document.querySelectorAll("[data-direction]").forEach(button => button.classList.remove("pressed"));
  }
  function updateStorageNotice() {
    $("storage-notice").textContent = rankingRepository.persistent ? "" : "ブラウザに保存できないため、このページを開いている間だけ名前とランキングを保持します。";
  }
  function syncStartAvailability() {
    const allowed = characterReady && profileReady && profile !== null && !creatingPlayer;
    startButton.disabled = !allowed; restartButton.disabled = !allowed;
  }
  function setPlaying(playing) {
    document.body.classList.toggle("is-playing", playing);
    for (const id of ["username", "save-profile", "new-player", "player-select"]) $(id).disabled = playing;
    if (playing) $("player-panel").open = false;
  }
  async function updateProfileUi() {
    $("player-name").textContent = profile?.name || "未登録";
    $("username").value = profile?.name || "";
    const players = await rankingRepository.listPlayers();
    const empty = document.createElement("option"); empty.value = ""; empty.textContent = "新しいプレイヤー";
    $("player-select").replaceChildren(empty, ...players.map(player => {
      const option = document.createElement("option"); option.value = player.id; option.textContent = player.name; return option;
    }));
    $("player-select").value = profile?.id || "";
    syncStartAvailability(); updateStorageNotice();
  }
  async function renderRanking() {
    const version = ++rankingVersion;
    $("ranking-message").textContent = "記録を読み込んでいます…";
    try {
      const entries = await rankingRepository.listTop($("ranking-stage").value, 30);
      if (version !== rankingVersion) return;
      $("ranking-body").replaceChildren(...entries.map(entry => {
        const row = document.createElement("tr");
        if (entry.playerId === profile?.id) row.className = "my-ranking";
        for (const value of [entry.rank, entry.name, `${entry.score}pt`]) {
          const cell = document.createElement("td"); cell.textContent = String(value); row.append(cell);
        }
        return row;
      }));
      $("ranking-message").textContent = entries.length ? "各プレイヤーの自己ベストのみ表示。同点は先に記録した人が上位です。" : "このステージにはまだ記録がありません。まずは1ゲーム！";
      updateStorageNotice();
    } catch {
      if (version === rankingVersion) $("ranking-message").textContent = "ランキングを読み込めませんでした。ステージを選び直すと再試行できます。";
    }
  }
  async function initializeProfile() {
    try {
      profile = await rankingRepository.getProfile(); profileReady = true;
      await updateProfileUi(); $("player-panel").open = !profile;
      $("profile-message").textContent = profile ? "名前を変更しても自己ベストは引き継がれます。" : "初めてのプレイです。ユーザー名を登録してください。";
      await renderRanking();
    } catch { $("profile-message").textContent = "名前の読み込みに失敗しました。ページを再読み込みしてください。"; }
  }
  function updateHud(now) {
    if (displayedScore !== world.score) { showPoints($("score"), world.score); displayedScore = world.score; }
    const seconds = Math.ceil(world.remaining);
    if (displayedSeconds !== seconds) { $("time").textContent = String(seconds); displayedSeconds = seconds; }
    $("time-bar").style.width = `${world.remaining / DURATION * 100}%`;
    $("timer-stat").classList.toggle("urgent", world.remaining <= 10);
    const boost = world.status === "playing" && now < world.boostUntil;
    const slow = world.status === "playing" && now < world.slowUntil;
    $("boost-status").hidden = !boost; $("slow-status").hidden = !slow;
    if (boost) $("boost-status").textContent = `ϟ 加速 ${((world.boostUntil - now) / 1000).toFixed(1)}秒`;
    if (slow) $("slow-status").textContent = `◉ 減速 ${((world.slowUntil - now) / 1000).toFixed(1)}秒`;
    $("speed-status").textContent = `移動速度 ×${world.status === "playing" ? world.multiplier(now) : 1}`;
  }
  function prepareStage() {
    runVersion++; setPlaying(false);
    audio.stop(); clearInput(); particles = []; popups = [];
    world.setStage(Number(stageSelect.value));
    displayedScore = -1; displayedSeconds = -1;
    buildBackground(); showBest(); updateHud(performance.now());
    $("stage-description").textContent = world.stage.description;
    $("field-name").textContent = world.stage.label;
    $("overlay-kicker").textContent = `STAGE ${Number(stageSelect.value) + 1} / READY, SET, RUSH!`;
    $("overlay-title").textContent = "wobまんちゃんと遊ぼう！";
    $("overlay-description").textContent = `${world.stage.name}で60秒のコインラッシュ。矢印キーで移動しよう！`;
    $("final-score").hidden = true; $("result-message").hidden = true;
    $("overlay-hint").textContent = "金1pt・青2pt・虹3pt・緑はスピードアップ";
    startButton.textContent = "ゲームスタート ✦";
    $("save-status").hidden = true; $("view-ranking").hidden = true;
    $("ranking-stage").value = world.stage.id; renderRanking(); syncStartAvailability();
    overlay.classList.remove("is-result"); overlay.hidden = false;
  }
  function startGame() {
    if (!characterReady || !profileReady || !profile || creatingPlayer) { $("player-panel").open = true; $("username").focus(); return; }
    runVersion++; sessionPlayer = { ...profile }; setPlaying(true);
    clearInput(); particles = []; popups = [];
    const now = performance.now(); world.start(now); lastTime = now;
    overlay.hidden = true; overlay.classList.remove("is-result"); updateHud(now);
    announcement.textContent = `${world.stage.name}でゲームスタート。制限時間60秒です。`;
    canvas.focus({ preventScroll: true });
    // AudioContextはこのクリック操作で初めて作成・再開します。
    audio.start().then(ok => {
      $("audio-notice").textContent = ok ? "" : "音声を再生できませんでした。音のスイッチを押すと再試行できます。";
    });
    if (matchMedia("(max-width: 650px)").matches) $("game").scrollIntoView({ block: "start" });
  }
  function finishGame() {
    clearInput(); audio.finish(); setPlaying(false);
    const stageId = world.stage.id, latest = readRecords();
    for (const stage of STAGES) records[stage.id] = Math.max(records[stage.id], latest[stage.id]);
    const newRecord = world.score > records[stageId];
    records[stageId] = Math.max(records[stageId], world.score);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); } catch { /* 遊び続けられます */ }
    showBest(); updateHud(performance.now());
    $("overlay-kicker").textContent = "TIME'S UP!";
    $("overlay-title").textContent = "ナイス・コインラッシュ！";
    $("overlay-description").textContent = `${world.stage.name}の60秒チャレンジ、おつかれさま！`;
    $("final-score-value").textContent = String(world.score);
    $("final-score").hidden = false; $("result-message").hidden = false;
    $("result-message").textContent = newRecord ? "★ このステージのベストを更新！" : "もう一度、ベストスコアに挑戦しよう！";
    $("overlay-hint").textContent = `${world.stage.name}のベスト：${records[stageId]}ポイント`;
    startButton.textContent = "もう一度あそぶ ✦";
    overlay.classList.add("is-result"); overlay.hidden = false;
    announcement.textContent = `ゲーム終了。${world.stage.name}で${world.score}ポイントです。`;
    startButton.focus({ preventScroll: true });
    $("view-ranking").hidden = false; $("save-status").hidden = false;
    $("save-status").textContent = "ランキングに保存しています…";
    $("ranking-stage").value = stageId;
    const version = runVersion;
    // 開始時のプレイヤーと終了時のスコアを固定し、非同期保存中の再挑戦に備えます。
    rankingRepository.submitScore({ stageId, playerId: sessionPlayer.id, score: world.score }).then(result => {
      if (version === runVersion) $("save-status").textContent = result.persistent ? "この端末のランキングに保存しました。" : "このページ内のランキングに記録しました（ブラウザ保存不可）。";
      updateStorageNotice(); renderRanking();
    }).catch(() => {
      if (version === runVersion) $("save-status").textContent = "ランキングを保存できませんでした。";
    });
  }
  function reactToEvent(event) {
    if (event.type === "finish") { finishGame(); return; }
    if (event.type === "pond") {
      audio.effect("pond"); popups.push({ x: event.x, y: event.y - 40, life: 0.9, text: "SLOW!", color: "#286c9f" }); return;
    }
    const coin = event.coin, config = TYPES[coin.type]; audio.effect(coin.type);
    popups.push({ x: coin.x, y: coin.y - 24, life: 0.8, text: coin.type === "speed" ? "SPEED UP!" : `+${config.points}`, color: config.edge });
    if (!reducedMotion.matches) for (let i = 0; i < 9; i++) {
      const angle = Math.PI * 2 * i / 9, speed = 45 + Math.random() * 70;
      particles.push({ x: coin.x, y: coin.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 0.5, color: i % 2 ? "#fff8d0" : config.color });
    }
  }
  function ellipse(x, y, rx, ry, color, target = ctx) {
    target.fillStyle = color; target.beginPath(); target.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); target.fill();
  }
  function roundedRect(x, y, width, height, radius, color, target = ctx) {
    const r = Math.min(radius, width / 2, height / 2);
    target.fillStyle = color; target.beginPath(); target.moveTo(x + r, y);
    target.arcTo(x + width, y, x + width, y + height, r); target.arcTo(x + width, y + height, x, y + height, r);
    target.arcTo(x, y + height, x, y, r); target.arcTo(x, y, x + width, y, r); target.closePath(); target.fill();
  }
  function buildBackground() {
    bg.fillStyle = "#a8dfab"; bg.fillRect(0, 0, WIDTH, HEIGHT);
    for (let y = 0; y < HEIGHT; y += 60) for (let x = 0; x < WIDTH; x += 60) {
      bg.fillStyle = (x / 60 + y / 60) % 2 ? "#b0e5b0" : "#ace2ad"; bg.fillRect(x + 1, y + 1, 58, 58);
    }
    if (world.stage.ponds.length) {
      bg.strokeStyle = "#dfe4af"; bg.lineWidth = 52; bg.lineCap = "round";
      bg.beginPath(); bg.moveTo(60, 470); bg.bezierCurveTo(170, 320, 410, 335, 480, 265); bg.bezierCurveTo(550, 200, 730, 235, 900, 65); bg.stroke();
    }
    bg.strokeStyle = "#75bd8399"; bg.lineWidth = 3; bg.setLineDash([7, 9]); bg.strokeRect(19, 19, WIDTH - 38, HEIGHT - 38); bg.setLineDash([]);
    for (let i = 0; i < 85; i++) {
      const x = 30 + ((i * 137 + 19) % 900), y = 40 + ((i * 83 + 31) % 465);
      if (i % 4 === 0) {
        const color = i % 3 ? "#fff3bf" : "#f9b9c7";
        for (let petal = 0; petal < 5; petal++) { const angle = petal * Math.PI * 2 / 5; ellipse(x + Math.cos(angle) * 3.5, y + Math.sin(angle) * 3.5, 2.5, 2.5, color, bg); }
        ellipse(x, y, 1.8, 1.8, "#eeb95b", bg);
      } else {
        bg.strokeStyle = "#80bf8b"; bg.lineWidth = 2; bg.beginPath(); bg.moveTo(x - 3, y); bg.lineTo(x, y + 4); bg.lineTo(x + 3, y - 2); bg.stroke();
      }
    }
    for (const pond of world.stage.ponds) {
      ellipse(pond.x, pond.y + 3, pond.rx + 9, pond.ry + 8, "#7bb992", bg);
      ellipse(pond.x, pond.y, pond.rx + 5, pond.ry + 5, "#ddedc0", bg);
      ellipse(pond.x, pond.y, pond.rx, pond.ry, "#5db9d9", bg);
      ellipse(pond.x, pond.y + 7, pond.rx - 12, pond.ry - 12, "#71c8e3", bg);
      for (let i = -1; i <= 1; i++) {
        bg.strokeStyle = "#b2edf2"; bg.lineWidth = 3; bg.beginPath(); bg.moveTo(pond.x - 25 + i * 17, pond.y + i * 20);
        bg.quadraticCurveTo(pond.x + i * 17, pond.y + 5 + i * 20, pond.x + 25 + i * 17, pond.y + i * 20); bg.stroke();
      }
      ellipse(pond.x - pond.rx * 0.5, pond.y - 12, 11, 6, "#589e6a", bg); ellipse(pond.x + pond.rx * 0.5, pond.y + 17, 9, 5, "#68aa71", bg);
    }
    const fences = world.stage.fences;
    for (let i = 0; i + 3 < fences.length; i += 4) {
      const top = fences[i], bottom = fences[i + 1];
      roundedRect(top.x + 12, top.y + 12, top.width - 24, bottom.y - top.y - 10, 4, "#81b67e", bg);
      bg.font = "bold 13px sans-serif"; bg.textAlign = "center"; bg.fillStyle = "#46764f"; bg.fillText("FLOWER GARDEN", top.x + top.width / 2, (top.y + bottom.y) / 2 + 8);
    }
  }
  function drawFence(rect) {
    const { x, y, width, height } = rect;
    roundedRect(x - 3, y + 5, width + 6, height + 6, 4, "#46774b33");
    if (width >= height) {
      roundedRect(x, y - 11, width, 8, 3, "#cf9560"); roundedRect(x, y + 1, width, 7, 3, "#b77b4b");
      const count = Math.ceil(width / 35);
      for (let i = 0; i <= count; i++) {
        const px = x + Math.min(width - 10, i * width / count); roundedRect(px, y - 22, 10, 35, 3, "#9d633c"); roundedRect(px + 1, y - 22, 7, 30, 3, "#e1ae78");
      }
    } else {
      roundedRect(x + 2, y - 11, 7, height + 20, 3, "#b77b4b");
      const count = Math.ceil(height / 35);
      for (let i = 0; i <= count; i++) roundedRect(x, y + Math.min(height - 10, i * height / count) - 19, 13, 31, 3, "#d3a06c");
    }
  }
  function drawCoin(coin, seconds) {
    const config = TYPES[coin.type], bob = reducedMotion.matches ? 0 : Math.sin(seconds * 3 + coin.phase) * 3;
    ellipse(coin.x, coin.y + 15, 15, 5, "#4e9e7040"); ellipse(coin.x, coin.y + bob + 3, 16, 17, config.edge); ellipse(coin.x, coin.y + bob, 16, 17, "#fff7d0");
    let color = config.color;
    if (coin.type === "rainbow") {
      color = ctx.createLinearGradient(coin.x - 12, coin.y - 12, coin.x + 12, coin.y + 12);
      ["#ff9ba6", "#ffe883", "#9de4a1", "#79cfff", "#c7a0ff"].forEach((stop, i) => color.addColorStop(i / 4, stop));
    }
    ellipse(coin.x, coin.y + bob, 12, 13, color); ctx.fillStyle = config.edge; ctx.font = "900 19px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(config.symbol, coin.x, coin.y + bob + 6); ellipse(coin.x - 6, coin.y + bob - 8, 3, 2, "#fffdf0");
  }
  function drawPlayer() {
    if (!characterReady) return;
    const player = world.player;
    const bounce = player.moving && !reducedMotion.matches ? Math.abs(Math.sin(player.stride * 11)) * 5 : 0;
    ellipse(player.x, player.y + 23, 24 - bounce * 0.4, 7 - bounce * 0.3, "#30784e40");
    // 元画像をそのまま等倍率で縮小。左右反転・切り抜き・変形は行いません。
    const scale = Math.min(76 / character.naturalWidth, 76 / character.naturalHeight);
    const width = character.naturalWidth * scale, height = character.naturalHeight * scale;
    ctx.drawImage(character, player.x - width / 2, player.y + 25 - height - bounce, width, height);
  }
  function render(now) {
    ctx.clearRect(0, 0, WIDTH, HEIGHT); ctx.drawImage(background, 0, 0);
    const objects = world.coins.map(coin => ({ y: coin.y + 15, draw: () => drawCoin(coin, now / 1000) }));
    objects.push({ y: world.player.y + 23, draw: drawPlayer });
    world.stage.fences.forEach(rect => objects.push({ y: rect.y + rect.height, draw: () => drawFence(rect) }));
    objects.sort((a, b) => a.y - b.y).forEach(object => object.draw());
    for (const particle of particles) { ctx.globalAlpha = Math.min(1, particle.life * 3); ellipse(particle.x, particle.y, 3, 3, particle.color); }
    for (const popup of popups) {
      ctx.globalAlpha = Math.min(1, popup.life * 3); ctx.textAlign = "center"; ctx.font = "900 22px sans-serif"; ctx.lineWidth = 4;
      ctx.strokeStyle = "#fff9de"; ctx.strokeText(popup.text, popup.x, popup.y); ctx.fillStyle = popup.color; ctx.fillText(popup.text, popup.x, popup.y);
    }
    ctx.globalAlpha = 1;
  }
  function frame(now) {
    const dt = Math.min(Math.max((now - lastTime) / 1000, 0), 0.05); lastTime = now;
    world.update(dt, now, new Set([...pressedKeys, ...touchDirections.values()])); world.events.forEach(reactToEvent);
    if (world.status === "playing") updateHud(now);
    for (const particle of particles) { particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.vy += 140 * dt; particle.life -= dt; }
    for (const popup of popups) { popup.y -= 32 * dt; popup.life -= dt; }
    particles = particles.filter(particle => particle.life > 0); popups = popups.filter(popup => popup.life > 0); render(now); requestAnimationFrame(frame);
  }
  function updateAudioButtons() {
    for (const [id, label, enabled] of [["bgm-button", "BGM", audio.bgmEnabled], ["sfx-button", "効果音", audio.sfxEnabled]]) {
      $(id).textContent = `${label} ${enabled ? "ON" : "OFF"}`; $(id).setAttribute("aria-pressed", String(enabled));
    }
  }
  $("bgm-button").addEventListener("click", () => { audio.setBgm(!audio.bgmEnabled); updateAudioButtons(); });
  $("sfx-button").addEventListener("click", () => { audio.setSfx(!audio.sfxEnabled); updateAudioButtons(); });
  if (!audio.supported) {
    $("bgm-button").disabled = true; $("sfx-button").disabled = true;
    $("audio-notice").textContent = "このブラウザは音声機能に対応していません。ゲームは音なしで遊べます。";
  }
  window.addEventListener("keydown", event => {
    if (!directions.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (world.status === "playing" && !["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)) { event.preventDefault(); pressedKeys.add(event.key); }
  });
  window.addEventListener("keyup", event => pressedKeys.delete(event.key)); window.addEventListener("blur", clearInput);
  document.addEventListener("visibilitychange", () => {
    clearInput(); if (document.hidden) audio.setVisible(false);
    if (world.status === "playing") { world.update(0, performance.now()); world.events.forEach(reactToEvent); updateHud(performance.now()); }
    if (!document.hidden) audio.setVisible(true);
  });
  document.querySelectorAll("[data-direction]").forEach(button => {
    button.addEventListener("pointerdown", event => {
      if (world.status !== "playing") return;
      event.preventDefault(); button.setPointerCapture(event.pointerId); touchDirections.set(event.pointerId, button.dataset.direction);
      button.classList.add("pressed");
      // iOS等で音声が中断された場合は、新しい操作のタイミングで再開します。
      if (audio.context && audio.context.state !== "running") audio.resumeFromGesture();
    });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) button.addEventListener(name, event => {
      touchDirections.delete(event.pointerId); button.classList.remove("pressed");
    });
    button.addEventListener("contextmenu", event => event.preventDefault());
  });
  $("game").addEventListener("touchmove", event => { if (world.status === "playing") event.preventDefault(); }, { passive: false });
  $("profile-form").addEventListener("submit", async event => {
    event.preventDefault(); if (world.status === "playing") return;
    try {
      profile = await rankingRepository.saveProfile($("username").value, creatingPlayer);
      creatingPlayer = false; await updateProfileUi(); $("player-panel").open = false;
      $("profile-message").textContent = "名前を保存しました。"; renderRanking();
    } catch (error) { $("profile-message").textContent = error.message; $("username").setAttribute("aria-invalid", "true"); return; }
    $("username").removeAttribute("aria-invalid");
  });
  $("player-select").addEventListener("change", async () => {
    if (world.status === "playing") return;
    if (!$("player-select").value) { beginNewPlayer(); return; }
    try {
      profile = await rankingRepository.selectPlayer($("player-select").value); creatingPlayer = false;
      await updateProfileUi(); $("profile-message").textContent = "プレイヤーを切り替えました。"; renderRanking();
    } catch (error) { $("profile-message").textContent = error.message; }
  });
  function beginNewPlayer() {
    if (world.status === "playing") return;
    creatingPlayer = true; $("username").value = ""; $("player-select").value = "";
    $("profile-message").textContent = "新しいプレイヤーの名前を2〜12文字で入力してください。";
    $("player-panel").open = true; syncStartAvailability(); $("username").focus();
  }
  $("new-player").addEventListener("click", beginNewPlayer);
  $("ranking-stage").addEventListener("change", renderRanking);
  $("view-ranking").addEventListener("click", () => { $("ranking").focus({ preventScroll: true }); $("ranking").scrollIntoView({ block: "start" }); });
  stageSelect.addEventListener("change", prepareStage); startButton.addEventListener("click", startGame); restartButton.addEventListener("click", startGame);
  window.addEventListener("pagehide", () => audio.stop());
  character.onload = () => { characterReady = true; syncStartAvailability(); $("asset-status").textContent = ""; };
  character.onerror = () => {
    characterReady = false; startButton.disabled = true; restartButton.disabled = true;
    $("asset-status").textContent = "画像を読み込めません。assetsフォルダーにwobman.pngを置いて再読み込みしてください。";
  };
  prepareStage(); initializeProfile(); updateAudioButtons(); character.src = "assets/wobman.png"; requestAnimationFrame(frame);
})();
