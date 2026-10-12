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

-- Social layer (CONCEPT.md §5): Мастерские, Вернисаж, Тихий торг.
CREATE TABLE IF NOT EXISTS guilds (
    id       TEXT PRIMARY KEY,
    data     JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auctions (
    id      TEXT PRIMARY KEY,
    data    JSONB NOT NULL,
    status  TEXT NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS auctions_status_idx ON auctions (status, ends_at);

CREATE TABLE IF NOT EXISTS exhibitions (
    id   TEXT PRIMARY KEY,
    data JSONB NOT NULL
);

-- Сезонные турниры (§4.7) и казна комиссий (§4.2: 50/30/20).
CREATE TABLE IF NOT EXISTS tournaments (
    id         TEXT PRIMARY KEY,
    data       JSONB NOT NULL,
    status     TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tournaments_status_idx ON tournaments (status, created_at DESC);

CREATE TABLE IF NOT EXISTS treasury (
    id   TEXT PRIMARY KEY,
    data JSONB NOT NULL
);
