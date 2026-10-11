-- Palimpsest storage schema (PostgreSQL 14+).
-- Entities are stored as JSONB documents plus queryable columns; the Book of
-- Layers is append-only by convention (no UPDATE/DELETE statements exist).

CREATE TABLE IF NOT EXISTS players (
    id         TEXT PRIMARY KEY,
    data       JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    data       JSONB NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS artifacts (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    date        TEXT NOT NULL,
    player_id   TEXT NOT NULL,
    player_name TEXT NOT NULL,
    total       INTEGER NOT NULL,
    title       TEXT NOT NULL,
    data        JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS artifacts_daily_idx
    ON artifacts (kind, date, total DESC, created_at);
CREATE INDEX IF NOT EXISTS artifacts_player_idx
    ON artifacts (player_id);

-- Append-only provenance book (Книга Слоёв). Verified server-side by the
-- same hash chain as the JSON store / on-chain commitments.
CREATE TABLE IF NOT EXISTS book (
    seq  BIGINT PRIMARY KEY,
    hash TEXT NOT NULL,
    entry JSONB NOT NULL
);
