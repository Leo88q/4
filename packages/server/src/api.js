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
 *   GET  /api/season?playerId=          сезон + Манифест + слой Аттестата
 *   POST /api/season/manifest/unlock    {playerId} платная глава Манифеста (100 Киновари)
 *   POST /api/season/manifest/claim     {playerId, level}
 *   GET  /api/tournaments
 *   POST /api/tournament                {name, kind?, sponsor?}
 *   GET  /api/tournament/:id
 *   POST /api/tournament/:id/enter|start|finish
 *   GET  /api/chapter?playerId=          глава сезона: легенда, квесты, заказ
 *   POST /api/chapter/quest/claim        {playerId, questId}
 *   GET  /api/rewarded?playerId=         спонсорский просмотр: остаток на день
 *   POST /api/rewarded                   {playerId, adToken?} +20 Пигментов (лимит 3/день)
 *   GET  /api/dao                        proto-DAO: предложения и управление сезоном
 *   POST /api/dao/proposal               {kind, title?, options?, authorPlayerId}
 *   POST /api/dao/proposal/:id/vote      {playerId, option} — голос Мастерской (вес=престиж)
 *   POST /api/dao/proposal/:id/close
 */
import { sha256Hex, hashObject, dailySeedString, mixChainEntropy, merkleProof, buildMerkle } from '@palimpsest/common';
import { simulate, validateActionLog, generate, SESSION_TTL_MS, SIM_VERSION, conservationOf, agingProjection } from '@palimpsest/sim';
import { rateLimit, analyzePace } from './anticheat.js';
import { config } from './config.js';
import {
  DomainError, createGuild, joinGuild, leaveGuild, guildLeaderboard, guildStats,
} from './social/guilds.js';
import {
  exhibitionView, submitExhibit, vote, closeExhibition,
} from './social/vernissage.js';
import {
  createAuction, placeBid, settleAuction, auctionView, auctionListView,
} from './social/auction.js';
import { listCases, investigate, evidence } from './social/pentimento.js';
import {
  seasonIdFor, ensureManifest, grantManifestXp, unlockManifestPremium,
  claimManifestRewards, rewardsForLevel, seasonStats, seasonEntriesFromBook,
  awardTier, MANIFEST_XP,
} from './season.js';
import {
  TOURNAMENT_KINDS, createTournament, enterTournament, startTournament,
  assignRound, recordRound, finishTournament, standings as tournamentStandings,
} from './tournament.js';
import {
  chapterCard, chapterWeekSeed, questProgress,
  resolveChapter, CHAPTER_ORDER_BONUS,
} from './chapter.js';
import { REWARDED, rewardedState } from './rewarded.js';
import {
  createProposal, voteProposal, closeProposal, daoState, proposalView, PROPOSAL_KINDS,
} from './dao.js';
import { planMint, buildMetadata } from '@palimpsest/chain-sdk/bubblegum';

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
          return json(res, 200, buildMetadata(artifact));
        }
        const leaves = artifact.actionHashes ?? [];
        const merkle = leaves.length ? buildMerkle(leaves) : null;
        return json(res, 200, {
          ok: true,
          artifact,
          aging: agingProjection(artifact),
          provenance: {
            merkleRoot: artifact.actionsMerkle,
            actions: leaves.length,
            bookEntries: store.book.entries.filter((e) => e.artifactId === id),
            chainMode: config.chainMode,
          },
          merkle: merkle ? { root: merkle.root, sampleProof: leaves.length ? merkleProof(leaves, 0) : null } : null,
        });
      }

      // ---------- social reads ----------
      if (req.method === 'GET' && pathname === '/api/guilds') {
        return json(res, 200, { ok: true, rows: await guildLeaderboard(store) });
      }

      if (req.method === 'GET' && pathname.startsWith('/api/guild/')) {
        const id = pathname.slice('/api/guild/'.length);
        const guild = await store.getGuild(id);
        if (!guild) return bad(res, 404, 'unknown_guild');
        const members = [];
        for (const m of guild.members) {
          const p = await store.getPlayer(m.playerId);
          members.push({ playerId: m.playerId, name: p?.name ?? '?', role: m.role, joinedAt: m.joinedAt });
        }
        return json(res, 200, { ok: true, guild: { ...guild, members }, stats: await guildStats(store, guild) });
      }

      if (req.method === 'GET' && pathname === '/api/vernissage') {
        return json(res, 200, { ok: true, vernissage: await exhibitionView(store) });
      }

      if (req.method === 'GET' && pathname === '/api/auctions') {
        return json(res, 200, { ok: true, rows: await auctionListView(store) });
      }

      if (req.method === 'GET' && pathname.startsWith('/api/auction/')) {
        const auction = await store.getAuction(pathname.slice('/api/auction/'.length));
        if (!auction) return bad(res, 404, 'unknown_auction');
        const artifact = await store.getArtifact(auction.artifactId);
        return json(res, 200, {
          ok: true,
          auction: auctionView(auction),
          artifact: artifact ? { id: artifact.id, title: artifact.meta.title, total: artifact.score.total } : null,
        });
      }

      if (req.method === 'GET' && pathname === '/api/cases') {
        return json(res, 200, { ok: true, rows: await listCases(store) });
      }

      if (req.method === 'GET' && pathname === '/api/season') {
        const playerId = new URL(req.url, 'http://x').searchParams.get('playerId');
        const player = playerId ? await store.getPlayer(playerId) : null;
        const manifest = player ? ensureManifest(player) : null;
        const entries = player ? seasonEntriesFromBook(store.book.entries, player.id) : [];
        const stats = seasonStats(entries);
        return json(res, 200, {
          ok: true,
          seasonId: seasonIdFor(),
          manifest,
          owned: manifest ? rewardsForLevel(manifest.level, manifest.premium) : [],
          stats,
          tier: awardTier(stats),
          xpSources: Object.entries(MANIFEST_XP).map(([kind, xp]) => ({ kind, xp })),
        });
      }

      if (req.method === 'GET' && pathname === '/api/tournaments') {
        const rows = (await store.listTournaments()).map((t) => ({
          id: t.id,
          name: t.name,
          kind: t.kind,
          status: t.status,
          players: t.entry.length,
          prizePool: t.prizePool,
          seasonId: t.seasonId,
        }));
        return json(res, 200, { ok: true, rows });
      }

      if (req.method === 'GET' && pathname.startsWith('/api/tournament/')) {
        const t = await store.getTournament(pathname.slice('/api/tournament/'.length));
        if (!t) return bad(res, 404, 'unknown_tournament');
        return json(res, 200, { ok: true, tournament: t, standings: tournamentStandings(t) });
      }

      if (req.method === 'GET' && pathname === '/api/chapter') {
        const chapter = resolveChapter(store.dao?.activeChapterId);
        const playerId = new URL(req.url, 'http://x').searchParams.get('playerId');
        const player = playerId ? await store.getPlayer(playerId) : null;
        let quests = chapter.quests.map((q) => ({
          id: q.id, title: q.title, description: q.description,
          target: q.target, progress: 0, complete: false, reward: q.reward, claimed: false,
        }));
        if (player) {
          const artifacts = await store.artifactsByPlayer(player.id);
          const entries = store.book.entries.filter((e) => e.playerId === player.id);
          const claimed = new Set(player.chapterClaims?.[chapter.id] ?? []);
          quests = questProgress(chapter, { artifacts, bookEntries: entries })
            .map((q) => ({ ...q, claimed: claimed.has(q.id) }));
        }
        return json(res, 200, {
          ok: true,
          chapter: chapterCard(chapter),
          quests,
          claimedTitles: player?.cosmetics ?? [],
        });
      }

      if (req.method === 'GET' && pathname === '/api/rewarded') {
        const playerId = new URL(req.url, 'http://x').searchParams.get('playerId');
        const player = playerId ? await store.getPlayer(playerId) : null;
        if (!player) return bad(res, 400, 'unknown_player');
        return json(res, 200, {
          ok: true,
          ...rewardedState(store.book.entries, player.id),
          note: 'награда — только Пигменты; в проде выдача после S2S-подтверждения провайдера рекламы',
        });
      }

      if (req.method === 'GET' && pathname === '/api/dao') {
        return json(res, 200, {
          ok: true,
          kinds: PROPOSAL_KINDS,
          state: await daoState(store),
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
          let kind = body.kind === 'private' ? 'private' : 'daily';
          let seed = kind === 'daily' ? todaySeed() : `palimpsest-private:${player.id}:${Date.now()}`;
          let tournamentRef = null;
          if (body.kind === 'chapter') {
            // Заказ главы: единый холст недели для всех мастеров (равный старт)
            kind = 'chapter';
            seed = chapterWeekSeed(resolveChapter(store.dao?.activeChapterId));
          }
          if (body.kind === 'tournament') {
            // Турнирная партия: равный старт — сид раунда одинаков для всех.
            const t = await store.getTournament(body.tournamentId);
            if (!t) return bad(res, 400, 'unknown_tournament');
            try {
              const { round, seed: tSeed } = assignRound(t, player.id);
              kind = 'tournament';
              seed = tSeed;
              tournamentRef = { tournamentId: t.id, round };
            } catch (e) {
              return bad(res, 409, e.reason);
            }
          }
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
            tournament: tournamentRef,
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

        // ---------- social writes ----------
        if (pathname === '/api/season/manifest/unlock') {
          const player = await store.getPlayer(body.playerId);
          if (!player) return bad(res, 400, 'unknown_player');
          // Платная глава Манифеста: 100 Киновари (мок-платеж). Только косметика.
          const price = 100;
          if ((player.cinnabar ?? 0) < price) return bad(res, 402, 'not_enough_cinnabar');
          player.cinnabar -= price;
          unlockManifestPremium(player);
          await store.putPlayer(player);
          return json(res, 200, {
            ok: true,
            manifest: player.manifest,
            owned: rewardsForLevel(player.manifest.level, true),
          });
        }

        if (pathname === '/api/season/manifest/claim') {
          const player = await store.getPlayer(body.playerId);
          if (!player) return bad(res, 400, 'unknown_player');
          try {
            const items = claimManifestRewards(player, Number(body.level) || 0);
            await store.putPlayer(player);
            return json(res, 200, { ok: true, claimed: items, cosmetics: player.cosmetics });
          } catch (e) {
            return bad(res, 409, e.message);
          }
        }

        if (pathname === '/api/chapter/quest/claim') {
          const player = await store.getPlayer(body.playerId);
          if (!player) return bad(res, 400, 'unknown_player');
          const chapter = resolveChapter(store.dao?.activeChapterId);
          const quest = chapter.quests.find((q) => q.id === body.questId);
          if (!quest) return bad(res, 404, 'unknown_quest');
          player.chapterClaims = player.chapterClaims ?? {};
          const claimed = player.chapterClaims[chapter.id] ?? (player.chapterClaims[chapter.id] = []);
          if (claimed.includes(quest.id)) return bad(res, 409, 'already_claimed');
          const artifacts = await store.artifactsByPlayer(player.id);
          const entries = store.book.entries.filter((e) => e.playerId === player.id);
          const state = questProgress(chapter, { artifacts, bookEntries: entries })
            .find((q) => q.id === quest.id);
          if (!state?.complete) return bad(res, 409, 'quest_not_complete');
          claimed.push(quest.id);
          player.pigments = (player.pigments ?? 0) + (quest.reward.pigments ?? 0);
          if (quest.reward.title) {
            player.cosmetics = player.cosmetics ?? [];
            const title = `Титул «${quest.reward.title}»`;
            if (!player.cosmetics.includes(title)) player.cosmetics.push(title);
          }
          await store.putPlayer(player);
          await store.appendBook({
            type: 'chapter',
            playerId: player.id,
            payload: {
              event: 'quest_claimed',
              chapterId: chapter.id,
              questId: quest.id,
              reward: quest.reward,
            },
          });
          return json(res, 200, {
            ok: true,
            reward: quest.reward,
            pigments: player.pigments,
            cosmetics: player.cosmetics,
          });
        }

        if (pathname === '/api/rewarded') {
          const player = await store.getPlayer(body.playerId);
          if (!player) return bad(res, 400, 'unknown_player');
          // В демо просмотр подтверждается локально; в проде здесь проверяется
          // S2S-подпись провайдера рекламы (adToken) — без неё награды нет.
          const state = rewardedState(store.book.entries, player.id);
          if (state.left <= 0) return bad(res, 429, 'daily_cap');
          player.pigments = (player.pigments ?? 0) + REWARDED.pigmentGrant;
          await store.putPlayer(player);
          await store.appendBook({
            type: 'rewarded',
            playerId: player.id,
            payload: { event: 'ad_grant', amount: REWARDED.pigmentGrant, date: state.date },
          });
          return json(res, 200, {
            ok: true,
            granted: REWARDED.pigmentGrant,
            pigments: player.pigments,
            ...rewardedState(store.book.entries, player.id),
          });
        }

        if (pathname === '/api/dao/proposal') {
          const p = await createProposal(store, body);
          return json(res, 200, { ok: true, proposal: proposalView(p) });
        }

        const daoAct = pathname.match(/^\/api\/dao\/proposal\/([^/]+)\/(vote|close)$/);
        if (daoAct) {
          const out = daoAct[2] === 'vote'
            ? await voteProposal(store, daoAct[1], body)
            : await closeProposal(store, daoAct[1]);
          const p = out?.proposal ?? out;
          return json(res, 200, {
            ok: true,
            proposal: proposalView(p),
            effect: out?.effect ?? null,
          });
        }

        if (pathname === '/api/tournament') {
          const t = await createTournament(store, body);
          return json(res, 200, { ok: true, tournament: t });
        }

        const tournAct = pathname.match(/^\/api\/tournament\/([^/]+)\/(enter|start|finish)$/);
        if (tournAct) {
          const t = await store.getTournament(tournAct[1]);
          if (!t) return bad(res, 404, 'unknown_tournament');
          if (tournAct[2] === 'enter') {
            await enterTournament(store, t, body.playerId);
          } else if (tournAct[2] === 'start') {
            await startTournament(store, t);
          } else {
            await finishTournament(store, t);
          }
          return json(res, 200, {
            ok: true,
            tournament: t,
            standings: tournamentStandings(t),
          });
        }

        if (pathname === '/api/guild') {
          const guild = await createGuild(store, body);
          return json(res, 200, { ok: true, guild });
        }

        const guildAct = pathname.match(/^\/api\/guild\/([^/]+)\/(join|leave)$/);
        if (guildAct) {
          const fn = guildAct[2] === 'join' ? joinGuild : leaveGuild;
          const guild = await fn(store, guildAct[1], body.playerId);
          return json(res, 200, { ok: true, guild });
        }

        if (pathname === '/api/vernissage/submit') {
          const ex = await submitExhibit(store, body);
          const exhibitor = await store.getPlayer(body.playerId);
          if (exhibitor) {
            grantManifestXp(exhibitor, 'exhibit');
            await store.putPlayer(exhibitor);
          }
          return json(res, 200, { ok: true, entries: ex.entries.length });
        }
        if (pathname === '/api/vernissage/vote') {
          const ex = await vote(store, body);
          return json(res, 200, { ok: true, totalVotes: Object.keys(ex.votes).length });
        }
        if (pathname === '/api/vernissage/close') {
          const ex = await closeExhibition(store);
          return json(res, 200, { ok: true, results: ex.results });
        }

        if (pathname === '/api/auction') {
          const auction = await createAuction(store, body);
          return json(res, 200, { ok: true, auction: auctionView(auction) });
        }
        const auctionAct = pathname.match(/^\/api\/auction\/([^/]+)\/(bid|settle)$/);
        if (auctionAct) {
          const auction = auctionAct[2] === 'bid'
            ? await placeBid(store, auctionAct[1], body)
            : await settleAuction(store, auctionAct[1]);
          return json(res, 200, { ok: true, auction: auctionView(auction) });
        }

        const caseAct = pathname.match(/^\/api\/case\/([^/]+)\/investigate$/);
        if (caseAct) {
          const out = await investigate(store, caseAct[1], body);
          return json(res, 200, { ok: true, ...out });
        }

        const mintMatch = pathname.match(/^\/api\/artifact\/([^/]+)\/mint$/);
        if (mintMatch) {
          const artifact = await store.getArtifact(mintMatch[1]);
          if (!artifact) return bad(res, 404, 'not_found');
          if (artifact.mint) return bad(res, 409, 'already_minted');
          const leafIndex = store.book.entries.filter((e) => e.type === 'mint').length;
          const plan = planMint(artifact, leafIndex);
          artifact.mint = {
            provider: plan.provider,
            tree: plan.tree,
            leafIndex: plan.leafIndex,
            assetId: plan.assetId,
            metadataHash: plan.metadataHash,
            uri: plan.uri,
            leafCommitment: plan.leafCommitment,
            mintedAt: Date.now(),
          };
          await store.putArtifact(artifact);
          const mintEntry = await store.appendBook({
            type: 'mint',
            playerId: artifact.playerId,
            artifactId: artifact.id,
            payload: {
              event: 'cNFT_mint',
              tree: plan.tree,
              leafIndex: plan.leafIndex,
              assetId: plan.assetId,
              metadataHash: plan.metadataHash,
              leafCommitment: plan.leafCommitment,
            },
          });
          return json(res, 200, {
            ok: true,
            mint: artifact.mint,
            bookSeq: mintEntry.seq,
            metadata: plan.metadata,
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
            conservation: conservationOf(merged),
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
          // экономика: Пигменты за качество реставрации (CONCEPT.md §6.1)
          player.pigments = (player.pigments ?? 0) + result.score.total;
          // заказ главы даёт сезонный бонус (§4.6: базовый контент главы)
          if (session.kind === 'chapter') player.pigments += CHAPTER_ORDER_BONUS;
          // Киноварь — медленно: только за эталонные реставрации (Index ≥ 90)
          if (result.score.total >= 90) player.cinnabar = (player.cinnabar ?? 0) + 2;
          // Манифест сезона + турнирная партия (§4.6/§4.7)
          let tournamentResult = null;
          if (session.tournament) {
            const t = await store.getTournament(session.tournament.tournamentId);
            if (t) {
              await recordRound(store, t, player.id, {
                round: session.tournament.round,
                seed: session.seed,
                scoreIndex: result.score.total,
                // счёт серверный (пересимуляция) — достоверен всегда;
                // флаги темпа — материал для Смотрителя, а не дисквалификация
                verified: true,
                timeMs: Date.now() - session.startedAt,
                sessionId: session.id,
                flags: artifact.flags,
              });
              tournamentResult = { tournamentId: t.id, round: session.tournament.round };
            }
          } else {
            grantManifestXp(player, 'session');
          }
          await store.putPlayer(player);
          await store.putArtifact(artifact);
          await store.putSession(session);
          await store.save();

          const chainCommit = await chainWriter.commitAct(artifact);

          return json(res, 200, {
            ok: true,
            artifact,
            chainCommit,
            tournament: tournamentResult,
            manifest: ensureManifest(player),
            bookHead: store.book.head(),
            leaderboard: await store.dailyLeaderboard(session.date),
          });
        }
      }

      return bad(res, 404, 'unknown_route');
    } catch (err) {
      if (err instanceof DomainError) return bad(res, 400, err.reason);
      if (err.message === 'bad_json') return bad(res, 400, 'bad_json');
      if (err.message === 'body_too_large') return bad(res, 413, 'body_too_large');
      return bad(res, 500, 'internal');
    }
  };
}

/** cNFT metadata is built by @palimpsest/chain-sdk/bubblegum (buildMetadata). */
