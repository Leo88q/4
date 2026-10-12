import test from 'node:test';
import assert from 'node:assert/strict';
import {
  conservationOf, ageArtifact, agingProjection, YEARS,
} from '../src/index.js';

const base = {
  createdAt: Date.now(),
  seed: 'palimpsest-daily-v1:2026-10-11',
  conservation: { kind: 0, thickness: 0.4 },
};

test('conservationOf takes the last varnish action', () => {
  assert.equal(conservationOf([]), null);
  assert.deepEqual(
    conservationOf([
      { type: 'varnish', kind: 1, thickness: 0.2 },
      { type: 'wipe' },
      { type: 'varnish', kind: 2, thickness: 0.7 },
      { type: 'finish' },
    ]),
    { kind: 2, thickness: 0.7 },
  );
});

test('«Дыхание времени»: aging is deterministic and respects the varnish', () => {
  const a = ageArtifact(base, base.createdAt + 25 * YEARS);
  const b = ageArtifact(base, base.createdAt + 25 * YEARS);
  assert.deepEqual(a, b);
  assert.equal(a.years, 25);
  assert.ok(a.yellowing > 0 && a.yellowing < 1);
  assert.equal(a.conservation.varnish, 'мастикс');

  // мастикс желтеет медленнее шеллака
  const shellac = ageArtifact({ ...base, conservation: { kind: 1, thickness: 0.4 } }, base.createdAt + 25 * YEARS);
  assert.ok(shellac.yellowing > a.yellowing);

  // без консервации — быстрее любого лака
  const bare = ageArtifact({ ...base, conservation: null }, base.createdAt + 25 * YEARS);
  assert.ok(bare.yellowing > shellac.yellowing);
  assert.match(bare.care, /консервации/);
});

test('aging projection grows monotonically', () => {
  const p = agingProjection(base);
  assert.ok(p.now.yellowing <= p.in10y.yellowing);
  assert.ok(p.in10y.yellowing <= p.in25y.yellowing);
  assert.ok(p.in25y.yellowing <= p.in50y.yellowing);
  assert.ok(p.in50y.brittleness >= p.in25y.brittleness);
  // толстый слой желтеет сильнее
  const thick = agingProjection({ ...base, conservation: { kind: 0, thickness: 1 } });
  assert.ok(thick.in25y.yellowing > p.in25y.yellowing);
});
