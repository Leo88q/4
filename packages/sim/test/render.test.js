import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex } from '@palimpsest/common';
import {
  generate, createState, applyAction, renderRgba, renderInitialRgba, renderStateRgba,
  renderGalleryRgba, GRID,
} from '@palimpsest/sim';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const vectors = JSON.parse(
  fs.readFileSync(path.join(root, 'client', 'unity', 'test-vectors.json'), 'utf8'),
);

/** uint32 rolling hash — тот же, что в scripts/gen-vectors.js и C# ParityTests */
function roll(bytes) {
  let h = 0;
  for (const b of bytes) h = (Math.imul(h, 31) + b) >>> 0;
  return h;
}

const T0 = 1800000000000;

function vectorLog(puzzle) {
  const actions = [];
  let t = T0;
  const push = (a) => { actions.push({ ...a, t }); t += 200; };
  push({ type: 'diagnose', findings: puzzle.findings });
  push({ type: 'solvent', x: 0.5, y: 0.5, r: 0.3, strength: 0.55 });
  push({ type: 'wipe', x: 0.5, y: 0.5, r: 0.3 });
  push({ type: 'varnish', kind: 0, thickness: 0.4 });
  push({ type: 'finish' });
  return actions;
}

test('канонический рендер: кадры совпадают с векторами паритета (JS ↔ C#)', () => {
  const puzzle = generate(vectors.seed);

  const frame0 = renderInitialRgba(puzzle);
  assert.equal(frame0.length, GRID * GRID * 4);
  assert.equal(roll(frame0), vectors.render.roll0, 'roll первого кадра');
  assert.equal(sha256Hex(frame0), vectors.render.sha0, 'sha256 первого кадра');

  const state = createState(puzzle);
  for (const a of vectorLog(puzzle)) applyAction(state, puzzle, a);
  const frameF = renderStateRgba(puzzle, state);
  assert.equal(roll(frameF), vectors.render.rollFinal, 'roll финального кадра');
  assert.equal(sha256Hex(frameF), vectors.render.shaFinal, 'sha256 финального кадра');
});

test('канонический рендер: альфа=255, утраты/разрывы видны, детерминизм', () => {
  const puzzle = generate(vectors.seed);
  const frame = renderInitialRgba(puzzle);
  for (let i = 0; i < GRID * GRID; i += 1) assert.equal(frame[i * 4 + 3], 255);

  // клетка с разрывом (tear0>0, без заплаты) — тьма (36,28,24)
  let dark = 0;
  for (let i = 0; i < GRID * GRID; i += 1) {
    if (puzzle.tear0[i] > 0
      && frame[i * 4] === 36 && frame[i * 4 + 1] === 28 && frame[i * 4 + 2] === 24) dark += 1;
  }
  assert.ok(dark > 0, 'разрывы отрисованы тьмой');

  // клетка утраты ближе к грунту (196,188,170), чем исходная краска
  let groundish = 0;
  for (let i = 0; i < GRID * GRID; i += 1) {
    if (puzzle.loss0[i] > 128 && frame[i * 4] > 120) groundish += 1;
  }
  assert.ok(groundish > 0, 'утраты показаны грунтом');

  // детерминизм: два прогона — одинаковые байты
  assert.equal(sha256Hex(renderInitialRgba(generate(vectors.seed))), vectors.render.sha0);

  // renderRgba принимает и «голые» слои (без patch/restored) — нули по умолчанию
  const bare = renderRgba({
    paint: puzzle.paint, varnish: puzzle.varnish0, loss: puzzle.loss0, tear: puzzle.tear0,
  });
  assert.equal(sha256Hex(bare), vectors.render.sha0);
});

test('галерейная проекция: слои поверх живописной подложки (ближайшая клетка)', () => {
  const puzzle = generate(vectors.seed);
  const W = 64;
  const H = 64;
  // однотонная подложка: проекция обязана совпасть с каноническим кадром
  // той же краски, растянутым nearest-neighbour
  const base = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i += 1) {
    base[i * 4] = 120;
    base[i * 4 + 1] = 90;
    base[i * 4 + 2] = 60;
    base[i * 4 + 3] = 255;
  }
  const paintConst = new Uint8Array(GRID * GRID * 3);
  for (let i = 0; i < GRID * GRID; i += 1) {
    paintConst[i * 3] = 120;
    paintConst[i * 3 + 1] = 90;
    paintConst[i * 3 + 2] = 60;
  }
  const layers = {
    paint: paintConst, varnish: puzzle.varnish0, loss: puzzle.loss0, tear: puzzle.tear0,
  };
  const canon = renderRgba(layers);
  const out = renderGalleryRgba(base, W, H, layers);
  assert.equal(out.length, W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const cx = Math.floor((x * GRID) / W);
      const cy = Math.floor((y * GRID) / H);
      const i = cy * GRID + cx;
      const p = (y * W + x) * 4;
      assert.equal(out[p], canon[i * 4], `r @${x},${y}`);
      assert.equal(out[p + 1], canon[i * 4 + 1], `g @${x},${y}`);
      assert.equal(out[p + 2], canon[i * 4 + 2], `b @${x},${y}`);
      assert.equal(out[p + 3], 255);
    }
  }

  // детерминизм проекции
  const again = renderGalleryRgba(base, W, H, layers);
  assert.equal(sha256Hex(again), sha256Hex(out));
});
