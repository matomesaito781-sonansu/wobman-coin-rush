"use strict";

// ゲームからはこの非同期APIだけを使用します。将来は同じAPIのFirestore実装に差し替えます。
// ここには外部SDK・通信・Firebaseの初期化処理はありません。
(() => {
  const STORAGE_KEY = "coin-hop-ranking-v1";
  const STAGES = ["meadow", "park", "pond", "plaza"];
  const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("ja", { granularity: "grapheme" }) : null;
  function normalizeName(value) {
    if (typeof value !== "string") throw new Error("ユーザー名は2〜12文字で入力してください。");
    const name = value.normalize("NFC").trim();
    const length = segmenter ? [...segmenter.segment(name)].length : [...name].length;
    if (length < 2 || length > 12 || /[\u0000-\u001f\u007f]/u.test(name)) throw new Error("ユーザー名は2〜12文字で入力してください。");
    return name;
  }
  const nameKey = name => name.normalize("NFKC").toLocaleLowerCase("ja");
  const validScore = value => Number.isSafeInteger(value) && value >= 0;
  const emptyData = () => ({ version: 1, activePlayerId: null, players: [], stages: Object.fromEntries(STAGES.map(id => [id, []])), sequence: 0 });

  class LocalRankingRepository {
    constructor(storage, now = Date.now) {
      this.scope = "local"; this.label = "この端末のランキング"; this.now = now;
      this.persistent = true; this.memory = emptyData();
      try { this.storage = storage === undefined ? window.localStorage : storage; }
      catch { this.storage = null; this.persistent = false; }
    }
    read() {
      if (!this.storage) return this.memory;
      try {
        const raw = this.storage.getItem(STORAGE_KEY);
        if (!raw) return this.memory;
        const parsed = JSON.parse(raw), data = emptyData();
        if (parsed?.version !== 1 || !Array.isArray(parsed.players)) throw new Error("保存形式が不正");
        for (const player of parsed.players) {
          try {
            const name = normalizeName(player.name);
            if (typeof player.id === "string" && player.id.length <= 100 && !data.players.some(p => p.id === player.id)) data.players.push({ id: player.id, name });
          } catch { /* 読み込めるプレイヤーを保持 */ }
        }
        data.activePlayerId = data.players.some(p => p.id === parsed.activePlayerId) ? parsed.activePlayerId : null;
        for (const stage of STAGES) {
          for (const entry of Array.isArray(parsed.stages?.[stage]) ? parsed.stages[stage] : []) {
            if (!data.players.some(p => p.id === entry.playerId) || !validScore(entry.score) || !validScore(entry.order) || !validScore(entry.achievedAt)) continue;
            const existing = data.stages[stage].find(e => e.playerId === entry.playerId);
            const clean = { playerId: entry.playerId, score: entry.score, order: entry.order, achievedAt: entry.achievedAt };
            if (!existing) data.stages[stage].push(clean);
            else if (clean.score > existing.score || (clean.score === existing.score && clean.order < existing.order)) Object.assign(existing, clean);
            data.sequence = Math.max(data.sequence, clean.order);
          }
        }
        if (validScore(parsed.sequence)) data.sequence = Math.max(data.sequence, parsed.sequence);
        this.memory = data;
      } catch { this.persistent = false; }
      return this.memory;
    }
    write(data) {
      this.memory = data;
      try {
        if (!this.storage) throw new Error("保存できません");
        this.storage.setItem(STORAGE_KEY, JSON.stringify(data)); this.persistent = true;
      } catch {
        // 古い保存内容を読み戻して新しい一時データを失わないよう、メモリーへ切り替えます。
        this.storage = null; this.persistent = false;
      }
    }
    async getProfile() {
      const data = this.read(), player = data.players.find(p => p.id === data.activePlayerId);
      return player ? { ...player } : null;
    }
    async listPlayers() { return this.read().players.map(player => ({ ...player })); }
    async saveProfile(value, createNew = false) {
      const name = normalizeName(value), data = this.read();
      let player = createNew ? null : data.players.find(p => p.id === data.activePlayerId);
      if (data.players.some(p => p.id !== player?.id && nameKey(p.name) === nameKey(name))) throw new Error("その名前のプレイヤーがいます。一覧から切り替えてください。");
      if (player) player.name = name;
      else {
        const id = window.crypto?.randomUUID?.() || `player-${this.now()}-${Math.random().toString(36).slice(2)}`;
        player = { id, name }; data.players.push(player);
      }
      data.activePlayerId = player.id; this.write(data); return { ...player };
    }
    async selectPlayer(id) {
      const data = this.read(), player = data.players.find(p => p.id === id);
      if (!player) throw new Error("プレイヤーが見つかりません。");
      data.activePlayerId = id; this.write(data); return { ...player };
    }
    async submitScore({ stageId, playerId, score }) {
      if (!STAGES.includes(stageId) || !validScore(score)) throw new Error("スコアの形式が正しくありません。");
      const data = this.read();
      if (!data.players.some(p => p.id === playerId)) throw new Error("ユーザー名を登録してください。");
      let entry = data.stages[stageId].find(item => item.playerId === playerId);
      const improved = !entry || score > entry.score;
      if (improved) {
        const next = { playerId, score, achievedAt: Math.max(0, Math.trunc(this.now())), order: ++data.sequence };
        if (entry) Object.assign(entry, next);
        else { entry = next; data.stages[stageId].push(entry); }
        this.write(data);
      }
      // 同点や低いスコアでは、自己ベストの先着順を変更しません。
      return { improved, entry: { ...entry }, persistent: this.persistent };
    }
    async listTop(stageId, limit = 30) {
      if (!STAGES.includes(stageId)) throw new Error("ステージが見つかりません。");
      const data = this.read();
      const ordered = [...data.stages[stageId]].sort((a, b) => b.score - a.score || a.order - b.order || a.playerId.localeCompare(b.playerId));
      return ordered.slice(0, Math.min(30, Math.max(0, Math.trunc(limit)))).map((entry, index) => ({
        ...entry, rank: index + 1, name: data.players.find(p => p.id === entry.playerId).name
      }));
    }
  }
  window.CoinRushRanking = Object.freeze({ LocalRankingRepository, normalizeName, STORAGE_KEY });
})();
