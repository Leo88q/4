/**
 * Persistence: in-memory maps + optional JSON snapshot (data/db.json).
 * Swap for PostgreSQL in production (see docs/architecture.md) — the Store
 * interface is intentionally tiny.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Book } from './provenance.js';

export class Store {
  /** @param {string} dataDir */
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'db.json');
    this.players = new Map();
    this.sessions = new Map();
    this.artifacts = new Map();
    this.book = new Book();
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.players = new Map((raw.players ?? []).map((p) => [p.id, p]));
      this.sessions = new Map((raw.sessions ?? []).map((s) => [s.id, s]));
      this.artifacts = new Map((raw.artifacts ?? []).map((a) => [a.id, a]));
      this.book = new Book(raw.book ?? []);
    } catch {
      /* fresh store */
    }
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({
      players: [...this.players.values()],
      sessions: [...this.sessions.values()],
      artifacts: [...this.artifacts.values()],
      book: this.book.entries,
    }));
    fs.renameSync(tmp, this.file);
  }

  /** Best daily results per player. */
  dailyLeaderboard(date) {
    const rows = [];
    for (const a of this.artifacts.values()) {
      if (a.kind !== 'daily' || a.date !== date) continue;
      rows.push(a);
    }
    rows.sort((x, y) => y.score.total - x.score.total || x.createdAt - y.createdAt);
    return rows.slice(0, 20).map((a) => ({
      rank: 0,
      playerId: a.playerId,
      player: a.playerName,
      total: a.score.total,
      artifactId: a.id,
      title: a.meta.title,
    })).map((r, i) => ({ ...r, rank: i + 1 }));
  }

  attestation(playerId) {
    const works = [...this.artifacts.values()].filter((a) => a.playerId === playerId);
    const avg = works.length
      ? Math.round(works.reduce((s, a) => s + a.score.total, 0) / works.length)
      : 0;
    const player = this.players.get(playerId);
    const rank = avg >= 90 ? 'Академик' : avg >= 75 ? 'Консерватор' : avg >= 60 ? 'Мастер' : avg >= 40 ? 'Подмастерье' : 'Стажёр';
    return {
      playerId,
      address: player?.address ?? null,
      name: player?.name ?? null,
      works: works.length,
      avgIndex: avg,
      rank,
      bestIndex: works.length ? Math.max(...works.map((a) => a.score.total)) : 0,
      titles: works.filter((a) => a.score.total >= 90).length,
    };
  }
}
