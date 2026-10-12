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
    this.guilds = new Map();
    this.auctions = new Map();
    this.exhibitions = new Map();
    this.book = new Book();
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.players = new Map((raw.players ?? []).map((p) => [p.id, p]));
      this.sessions = new Map((raw.sessions ?? []).map((s) => [s.id, s]));
      this.artifacts = new Map((raw.artifacts ?? []).map((a) => [a.id, a]));
      this.guilds = new Map((raw.guilds ?? []).map((g) => [g.id, g]));
      this.auctions = new Map((raw.auctions ?? []).map((a) => [a.id, a]));
      this.exhibitions = new Map((raw.exhibitions ?? []).map((e) => [e.id, e]));
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
      guilds: [...this.guilds.values()],
      auctions: [...this.auctions.values()],
      exhibitions: [...this.exhibitions.values()],
      book: this.book.entries,
    }));
    fs.renameSync(tmp, this.file);
  }

  // ---------- async entity interface (shared with PgStore) ----------
  async getPlayer(id) { return this.players.get(id) ?? null; }
  async putPlayer(player) { this.players.set(player.id, player); this.save(); }
  async getSession(id) { return this.sessions.get(id) ?? null; }
  async putSession(session) { this.sessions.set(session.id, session); this.save(); }
  async getArtifact(id) { return this.artifacts.get(id) ?? null; }
  async putArtifact(a) { this.artifacts.set(a.id, a); this.save(); }
  async appendBook(rec) { return this.book.append(rec); }
  async listArtifacts() { return [...this.artifacts.values()]; }
  async artifactsByPlayer(playerId) {
    return [...this.artifacts.values()].filter((a) => a.playerId === playerId);
  }

  // ---------- social layer ----------
  async getGuild(id) { return this.guilds.get(id) ?? null; }
  async putGuild(g) { this.guilds.set(g.id, g); this.save(); }
  async listGuilds() { return [...this.guilds.values()]; }
  async getAuction(id) { return this.auctions.get(id) ?? null; }
  async putAuction(a) { this.auctions.set(a.id, a); this.save(); }
  async listAuctions() { return [...this.auctions.values()]; }
  async getExhibition(id) { return this.exhibitions.get(id) ?? null; }
  async putExhibition(e) { this.exhibitions.set(e.id, e); this.save(); }

  /** Best daily results per player. */
  async dailyLeaderboard(date) {
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

  async attestation(playerId) {
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
      pigments: player?.pigments ?? 0,
      cinnabar: player?.cinnabar ?? 0,
      fakesExposed: player?.fakesExposed ?? 0,
    };
  }
}
