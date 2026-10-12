/**
 * Пентименто — расследования подделок (CONCEPT.md §5.4).
 *
 * v1 (vertical slice): «дело» заводится на артефакт с аномалиями в Книге —
 * флаги античита (client_mismatch, metronome, …) и ошибки диагноза
 * (score.diagnostics.findings.fn/fp). Смотритель изучает улики и выносит
 * вердикт: «подмалёвок» (fake) или «подлинник» (authentic).
 *
 *   вердикт верен  -> награда, доказанные подделки попадают в Аттестат;
 *   вердикт ошибочен -> штраф и минус репутации.
 *
 * Владелец артефакта не может расследовать своё дело (конфликт интересов).
 */
import { DomainError } from './guilds.js';

export const REWARD_CORRECT = 50;
export const PENALTY_WRONG = 20;

/**
 * Evidence dossier + hidden ground truth (server-side only).
 * @param {object} artifact
 */
export function evidence(artifact) {
  const flags = artifact.flags ?? [];
  const findings = artifact.score?.diagnostics?.findings ?? { tp: 0, fp: 0, fn: 0 };
  const mismatch = artifact.stateHashMatch === false;
  const suspicious = mismatch
    || flags.includes('client_mismatch')
    || flags.includes('metronome')
    || flags.length >= 2
    || findings.fn >= 2;
  return {
    artifactId: artifact.id,
    title: artifact.meta.title,
    epoch: artifact.meta.epoch,
    index: artifact.score.total,
    flags,
    diagnosisErrors: { missed: findings.fn, false: findings.fp },
    stateHashMatch: artifact.stateHashMatch,
    provenanceCid: artifact.provenanceCid,
    actionsMerkle: artifact.actionsMerkle,
    bookSeq: artifact.bookSeq,
    suspicious, // ground truth: «подозрение на подмалёвок»
  };
}

/** All open cases: suspicious artifacts not yet adjudicated (priority first). */
export async function listCases(store) {
  const cases = [];
  for (const a of await store.listArtifacts()) {
    if (a.verdict) continue; // уже рассмотрено
    const ev = evidence(a);
    if (ev.suspicious || a.score.total >= 60) cases.push({ ...ev, status: 'open' });
  }
  return cases
    .sort((x, y) => Number(y.suspicious) - Number(x.suspicious) || y.index - x.index)
    .slice(0, 30);
}

/**
 * Resolve a case.
 * @param {'fake'|'authentic'} verdict
 */
export async function investigate(store, artifactId, { playerId, verdict }) {
  if (!['fake', 'authentic'].includes(verdict)) throw new DomainError('bad_verdict');
  const artifact = await store.getArtifact(artifactId);
  if (!artifact) throw new DomainError('unknown_artifact');
  if (artifact.verdict) throw new DomainError('already_resolved');
  if (artifact.playerId === playerId) throw new DomainError('conflict_of_interest');
  const player = await store.getPlayer(playerId);
  if (!player) throw new DomainError('unknown_player');

  const ev = evidence(artifact);
  const correct = (verdict === 'fake') === ev.suspicious;

  if (correct) {
    player.pigments = (player.pigments ?? 0) + REWARD_CORRECT;
    if (verdict === 'fake') player.fakesExposed = (player.fakesExposed ?? 0) + 1;
  } else {
    player.pigments = Math.max(0, (player.pigments ?? 0) - PENALTY_WRONG);
    player.reputation = Math.max(0, (player.reputation ?? 0) - 1);
  }
  await store.putPlayer(player);

  artifact.verdict = verdict;
  artifact.verdictBy = playerId;
  artifact.verdictCorrect = correct;
  await store.putArtifact(artifact);

  const entry = await store.appendBook({
    type: 'verdict',
    playerId,
    artifactId,
    payload: {
      event: 'pentimento_verdict',
      verdict,
      correct,
      evidence: {
        flags: ev.flags,
        diagnosisErrors: ev.diagnosisErrors,
        stateHashMatch: ev.stateHashMatch,
      },
    },
  });

  return {
    correct,
    verdict,
    reward: correct ? REWARD_CORRECT : -PENALTY_WRONG,
    bookSeq: entry.seq,
    truth: ev.suspicious ? 'fake' : 'authentic',
  };
}
