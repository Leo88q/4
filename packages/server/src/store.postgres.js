/**
 * PostgreSQL-backed Store — same interface as store.js (JSON snapshot).
 * Uses any client with `query(text, params) -> { rows }`:
 *   * `pg.Pool` in production (dependency `pg`);
 *   * `@electric-sql/pglite` in tests (embedded Postgres, no server).
 *
 * Writes are immediate (no save() batching); `save()` stays for interface
 * parity and performs a no-op.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Book } from './provenance.js';

const schemaSql = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql'),
  'utf8',
);

export class PgStore {
  /** @param {{ query: (text: string, params?: unknown[]) => Promise<{rows: object[]}> }} client */
  constructor(client) {
    this.client = client;
    this.book = new Book();
    this._loaded = false;
  }

  /** Connect via DATABASE_URL using `pg` (production). */
  static async connect(databaseUrl) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: databaseUrl });
    const store = new PgStore(pool);
    await store.load();
    return store;
  }

  async load() {
    if (typeof this.client.exec === 'function') await this.client.exec(schemaSql);
    else await this.client.query(schemaSql);
    const { rows } = await this.client.query('SELECT entry FROM book ORDER BY seq ASC');
    this.book = new Book(rows.map((r) => (typeof r.entry === 'string' ? JSON.parse(r.entry) : r.entry)));
    this._loaded = true;
  }

  // ---------- players ----------
  async getPlayer(id) {
    const { rows } = await this.client.query('SELECT data FROM players WHERE id = $1', [id]);
    return rows.length ? parse(rows[0].data) : null;
  }

  async putPlayer(player) {
    await this.client.query(
      `INSERT INTO players (id, data) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [player.id, JSON.stringify(player)],
    );
  }

  // ---------- sessions ----------
  async getSession(id) {
    const { rows } = await this.client.query('SELECT data FROM sessions WHERE id = $1', [id]);
    return rows.length ? parse(rows[0].data) : null;
  }

  async putSession(session) {
    await this.client.query(
      `INSERT INTO sessions (id, data) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [session.id, JSON.stringify(session)],
    );
  }

  // ---------- artifacts ----------
  async getArtifact(id) {
    const { rows } = await this.client.query('SELECT data FROM artifacts WHERE id = $1', [id]);
    return rows.length ? parse(rows[0].data) : null;
  }

  async putArtifact(a) {
    await this.client.query(
      `INSERT INTO artifacts (id, kind, date, player_id, player_name, total, title, data, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9))
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [
        a.id, a.kind, a.date, a.playerId, a.playerName, a.score.total, a.meta.title,
        JSON.stringify(a), a.createdAt / 1000,
      ],
    );
  }

  // ---------- book (Книга Слоёв) ----------
  async appendBook(rec) {
    const entry = this.book.append(rec);
    await this.client.query(
      'INSERT INTO book (seq, hash, entry) VALUES ($1, $2, $3)',
      [entry.seq, entry.hash, JSON.stringify(entry)],
    );
    return entry;
  }

  // ---------- aggregates ----------
  async dailyLeaderboard(date) {
    const { rows } = await this.client.query(
      `SELECT data FROM artifacts
       WHERE kind = 'daily' AND date = $1
       ORDER BY total DESC, created_at ASC
       LIMIT 20`,
      [date],
    );
    return rows.map((r, i) => {
      const a = parse(r.data);
      return {
        rank: i + 1,
        playerId: a.playerId,
        player: a.playerName,
        total: a.score.total,
        artifactId: a.id,
        title: a.meta.title,
      };
    });
  }

  async attestation(playerId) {
    const p = await this.getPlayer(playerId);
    const { rows } = await this.client.query(
      `SELECT COUNT(*)::int AS works,
              COALESCE(AVG(total), 0)::float AS avg,
              COALESCE(MAX(total), 0)::int AS best
       FROM artifacts WHERE player_id = $1`,
      [playerId],
    );
    const { works, avg, best } = rows[0];
    const avgIndex = Math.round(avg);
    const rank = avgIndex >= 90 ? 'Академик' : avgIndex >= 75 ? 'Консерватор'
      : avgIndex >= 60 ? 'Мастер' : avgIndex >= 40 ? 'Подмастерье' : 'Стажёр';
    return {
      playerId,
      address: p?.address ?? null,
      name: p?.name ?? null,
      works,
      avgIndex,
      rank,
      bestIndex: best,
      titles: Number((await this.client.query(
        'SELECT COUNT(*)::int AS n FROM artifacts WHERE player_id = $1 AND total >= 90',
        [playerId],
      )).rows[0].n),
    };
  }

  async save() {
    /* writes are immediate */
  }
}

function parse(data) {
  return typeof data === 'string' ? JSON.parse(data) : data;
}
