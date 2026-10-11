/**
 * HTTP API (zero-dependency, node:http). Routes:
 *
 *   GET  /api/health
 *   GET  /api/daily
 *   POST /api/player              {name}
 *   POST /api/session             {playerId, kind?}
 *   POST /api/session/:id/actions {actions:[...]}
 *   POST /api/session/:id/finish  {actions:[...], clientStateHash?}
 *   GET  /api/artifact/:id
 *   GET  /api/artifact/:id/metadata
 *   GET  /api/leaderboard?date=
 *   GET  /api/attestation/:playerId
 *   GET  /api/book
 */
import { sha256Hex, hashObject, dailySeedString, mixChainEntropy, merkleProof, buildMerkle } from '@palimpsest/common';
import { simulate, validateActionLog, generate, SESSION_TTL_MS, SIM_VERSION } from '@palimpsest/sim';
import { rateLimit, analyzePace } from './anticheat.js';
import { config } from './config.js';

const json = (res, code, body) => {
  const data = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  });
  res.end(data);
};

const bad = (res, code, reason) => json(res, code, { ok: false, reason });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > config.maxBodyBytes) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('bad_json'));
      }
    });
    req.on('error', reject);
  });
}

function todaySeed() {
  return mixChainEntropy(dailySeedString(new Date()), config.chainEntropy);
}

function publicSpec(puzzle) {
  // findings are hidden from clients — they are the ground truth for diagnosis
  return {
    version: puzzle.version,
    seed: puzzle.seed,
    epoch: puzzle.epoch,
    title: puzzle.title,
    year: puzzle.year,
    N: puzzle.N,
    par: puzzle.par,
  };
}

function newId(prefix) {
  return `${prefix}_${sha256Hex(`${Date.now()}:${Math.random()}:${process.hrtime.bigint()}`).slice(0, 16)}`;
}

function pseudoAddress(name) {
  return sha256Hex(`palimpsest:addr:${name}:${process.pid}:${Date.now()}`).slice(0, 44);
}

/** @param {import('./store.js').Store} store @param {{ chainWriter?: object }} [deps] */
export function createApi(store, deps = {}) {
  const chainWriter = deps.chainWriter ?? {
    mode: config.chainMode,
    async commitAct(artifact) {
      return { mode: config.chainMode, localSeq: artifact.bookSeq ?? null };
    },
  };
  return async function api(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const { pathname } = url;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      return res.end();
    }

    try {
      // ---------- public reads ----------
      if (req.method === 'GET' && pathname === '/api/health') {
        return json(res, 200, {
          ok: true,
          simVersion: SIM_VERSION,
          chainMode: config.chainMode,
          storage: config.databaseUrl ? 'postgres' : 'json',
          bookHead: store.book.head(),
          bookVerified: store.book.verify().ok,
        });
      }

      if (req.method === 'GET' && pathname === '/api/daily') {
        const seed = todaySeed();
        const puzzle = generate(seed);
        return json(res, 200, {
          ok: true,
          date: new Date().toISOString().slice(0, 10),
          seed,
          spec: publicSpec(puzzle),
          chainEntropyBound: Boolean(config.chainEntropy),
          entropyCommit: config.chainEntropyCommit || null,
          entropyRevealed: Boolean(config.chainEntropy),
        });
      }

      if (req.method === 'GET' && pathname === '/api/book') {
        const verify = store.book.verify();
        return json(res, 200, {
          ok: true,
          verified: verify.ok,
          brokenAt: verify.brokenAt,
          head: store.book.head(),
          total: store.book.entries.length,
          entries: store.book.entries.slice(-50).reverse(),
        });
      }

      if (req.method === 'GET' && pathname === '/api/leaderboard') {
        const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
        return json(res, 200, { ok: true, date, rows: await store.dailyLeaderboard(date) });
      }

      if (req.method === 'GET' && pathname.startsWith('/api/attestation/')) {
        const playerId = pathname.slice('/api/attestation/'.length);
        return json(res, 200, { ok: true, attestation: await store.attestation(playerId) });
      }

      if (req.method === 'GET' && pathname.startsWith('/api/artifact/')) {
        const rest = pathname.slice('/api/artifact/'.length);
        const [id, meta] = rest.split('/');
        const artifact = await store.getArtifact(id);
        if (!artifact) return bad(res, 404, 'not_found');
        if (meta === 'metadata') {
          return json(res, 200, cNftMetadata(artifact));
        }
        const leaves = artifact.actionHashes ?? [];
        const merkle = leaves.length ? buildMerkle(leaves) : null;
        return json(res, 200, {
          ok: true,
          artifact,
          provenance: {
            merkleRoot: artifact.actionsMerkle,
            actions: leaves.length,
            bookEntries: store.book.entries.filter((e) => e.artifactId === id),
            chainMode: config.chainMode,
          },
          merkle: merkle ? { root: merkle.root, sampleProof: leaves.length ? merkleProof(leaves, 0) : null } : null,
        });
      }

      // ---------- writes ----------
      if (req.method === 'POST') {
        const rl = rateLimit(req.socket.remoteAddress ?? 'anon');
        if (!rl.ok) return bad(res, 429, rl.reason);
        const body = await readBody(req);

        if (pathname === '/api/player') {
          const name = String(body.name ?? '').trim().slice(0, 32);
          if (!name) return bad(res, 400, 'name_required');
          const player = {
            id: newId('plr'),
            name,
            address: pseudoAddress(name),
            createdAt: Date.now(),
          };
          await store.putPlayer(player);
          return json(res, 200, { ok: true, player });
        }

        if (pathname === '/api/session') {
          const player = await store.getPlayer(body.playerId);
          if (!player) return bad(res, 400, 'unknown_player');
          const kind = body.kind === 'private' ? 'private' : 'daily';
          const seed = kind === 'daily' ? todaySeed() : `palimpsest-private:${player.id}:${Date.now()}`;
          const session = {
            id: newId('ses'),
            playerId: player.id,
            kind,
            seed,
            date: new Date().toISOString().slice(0, 10),
            startedAt: Date.now(),
            actions: [],
            flags: [],
            finished: false,
            artifactId: null,
          };
          await store.putSession(session);
          return json(res, 200, {
            ok: true,
            sessionId: session.id,
            seed,
            spec: publicSpec(generate(seed)),
            startedAt: session.startedAt,
          });
        }

        const actMatch = pathname.match(/^\/api\/session\/([^/]+)\/(actions|finish)$/);
        if (actMatch) {
          const session = await store.getSession(actMatch[1]);
          if (!session) return bad(res, 404, 'unknown_session');
          if (session.finished) return bad(res, 409, 'already_finished');
          if (Date.now() - session.startedAt > SESSION_TTL_MS) return bad(res, 410, 'session_expired');

          const actions = Array.isArray(body.actions) ? body.actions : null;
          if (!actions) return bad(res, 400, 'actions_required');
          const merged = [...session.actions, ...actions];
          const check = validateActionLog(merged, { startedAt: session.startedAt });
          if (!check.ok) return bad(res, 400, check.reason);

          session.actions = merged;

          if (actMatch[2] === 'actions') {
            await store.putSession(session);
            return json(res, 200, { ok: true, accepted: actions.length, total: merged.length });
          }

          // ---- finish: server-authoritative re-simulation ----
          const result = simulate(session.seed, merged);
          if (!result.ok) return bad(res, 400, result.reason);

          const actionHashes = merged.map((a) => hashObject(a));
          const actionsMerkle = buildMerkle(actionHashes).root;
          const artifactId = newId('art');
          const player = await store.getPlayer(session.playerId);
          const artifact = {
            id: artifactId,
            kind: session.kind,
            date: session.date,
            seed: session.seed,
            playerId: player.id,
            playerName: player.name,
            playerAddress: player.address,
            meta: result.meta,
            score: result.score,
            stateHash: result.stateHash,
            actionsMerkle,
            actionHashes,
            provenanceCid: `ar://mock-${actionsMerkle.slice(0, 32)}`,
            clientStateHash: body.clientStateHash ?? null,
            stateHashMatch: body.clientStateHash ? body.clientStateHash === result.stateHash : null,
            flags: [],
            createdAt: Date.now(),
          };
          artifact.flags = analyzePace(session, result);
          if (artifact.stateHashMatch === false) artifact.flags.push('client_mismatch');

          const bookEntry = await store.appendBook({
            type: 'act',
            playerId: player.id,
            artifactId,
            payload: {
              seed: session.seed,
              total: result.score.total,
              stateHash: result.stateHash,
              actionsMerkle,
              meta: result.meta,
            },
          });
          artifact.bookSeq = bookEntry.seq;

          session.finished = true;
          session.artifactId = artifactId;
          await store.putArtifact(artifact);
          await store.putSession(session);
          await store.save();

          const chainCommit = await chainWriter.commitAct(artifact);

          return json(res, 200, {
            ok: true,
            artifact,
            chainCommit,
            bookHead: store.book.head(),
            leaderboard: await store.dailyLeaderboard(session.date),
          });
        }
      }

      return bad(res, 404, 'unknown_route');
    } catch (err) {
      if (err.message === 'bad_json') return bad(res, 400, 'bad_json');
      if (err.message === 'body_too_large') return bad(res, 413, 'body_too_large');
      return bad(res, 500, 'internal');
    }
  };
}

/** cNFT metadata (CONCEPT.md, Приложение C). */
function cNftMetadata(a) {
  return {
    name: `«${a.meta.title}», ок. ${a.meta.year} — Акт реставрации ${a.id}`,
    symbol: 'PLSMT',
    description: `Восстановлено мастером ${a.playerName}. Книга Слоёв: ${a.provenanceCid}`,
    attributes: [
      { trait_type: 'Эпоха', value: a.meta.epoch },
      { trait_type: 'Индекс Палимпсеста', value: a.score.total },
      { trait_type: 'Мастер', value: a.playerAddress },
    ],
    properties: {
      provenance_root: a.actionsMerkle,
      provenance_cid: a.provenanceCid,
      seed: a.seed,
    },
  };
}
