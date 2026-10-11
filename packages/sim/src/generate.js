/**
 * Deterministic puzzle generation from a seed (CONCEPT.md §4, §7.4).
 *
 * Everything here is pure and integer-friendly so the C# port reproduces
 * the exact same puzzle. The client regenerates the puzzle locally from the
 * seed — the server never ships trust-sensitive state.
 */
import { Rng } from '@palimpsest/common';
import { GRID, FINDINGS } from './const.js';

/** @typedef {{ name: string, colors: number[][] }} Epoch */

/** @type {Epoch[]} */
export const EPOCHS = [
  {
    name: 'Антика',
    colors: [[194, 152, 92], [166, 124, 82], [214, 188, 138], [122, 96, 70], [232, 206, 156]],
  },
  {
    name: 'Тёмное Средневековье',
    colors: [[92, 61, 38], [168, 128, 48], [58, 42, 34], [140, 108, 62], [204, 172, 96]],
  },
  {
    name: 'Возрождение',
    colors: [[112, 78, 62], [180, 132, 96], [86, 102, 120], [206, 178, 132], [152, 92, 78]],
  },
  {
    name: 'Барокко',
    colors: [[64, 48, 42], [148, 104, 66], [96, 84, 72], [188, 156, 110], [110, 64, 52]],
  },
  {
    name: 'Импрессионизм',
    colors: [[122, 148, 172], [196, 186, 148], [152, 168, 122], [222, 198, 166], [98, 118, 142]],
  },
  {
    name: 'Модерн',
    colors: [[176, 142, 102], [120, 128, 116], [202, 172, 138], [88, 96, 104], [188, 152, 96]],
  },
];

const TITLES = [
  'Портрет неизвестной', 'Портрет неизвестного', 'Пейзаж с рекой', 'Натюрморт с фруктами',
  'Сцена ярмарки', 'Дама в голубом', 'Монах у окна', 'Рыбаки', 'Всадник', 'Цветы в вазе',
  'Вид на гавань', 'Святой с книгой', 'Дети в саду', 'Старик у камина', 'Танец под окном',
];

/**
 * Value noise over the grid (lattice of seeded floats, bilinear + smoothstep).
 * @param {Rng} rng
 * @param {number} lattice
 * @returns {Float64Array} N*N values in [0,1)
 */
function valueNoise(rng, lattice) {
  const g = new Float64Array((lattice + 1) * (lattice + 1));
  for (let i = 0; i < g.length; i += 1) g[i] = rng.nextFloat();
  const out = new Float64Array(GRID * GRID);
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const fx = (x / GRID) * lattice;
      const fy = (y / GRID) * lattice;
      const ix = Math.min(lattice - 1, Math.floor(fx));
      const iy = Math.min(lattice - 1, Math.floor(fy));
      const tx = fx - ix;
      const ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const v00 = g[iy * (lattice + 1) + ix];
      const v10 = g[iy * (lattice + 1) + ix + 1];
      const v01 = g[(iy + 1) * (lattice + 1) + ix];
      const v11 = g[(iy + 1) * (lattice + 1) + ix + 1];
      out[y * GRID + x] = v00 + (v10 - v00) * sx + (v01 - v00) * sy + (v00 - v10 - v01 + v11) * sx * sy;
    }
  }
  return out;
}

/**
 * @param {string} seedString
 * @returns {object} puzzle descriptor (typed arrays + flavor metadata)
 */
export function generate(seedString) {
  const rng = new Rng(seedString);
  const epoch = EPOCHS[rng.nextInt(EPOCHS.length)];
  const title = TITLES[rng.nextInt(TITLES.length)];
  const year = 1400 + rng.nextInt(500);

  // --- original painting: palette mixing + shading via two noise fields ---
  const shape = valueNoise(rng, 4);
  const shade = valueNoise(rng, 6);
  const paint = new Uint8Array(GRID * GRID * 3);
  const span = epoch.colors.length;
  for (let i = 0; i < GRID * GRID; i += 1) {
    // palette interpolation from noise in [0, span)
    const idxF = shape[i] * span;
    const p0 = epoch.colors[Math.min(span - 1, Math.floor(idxF)) % span];
    const p1 = epoch.colors[Math.min(span - 1, Math.floor(idxF) + 1) % span];
    const frac = Math.floor((idxF - Math.floor(idxF)) * 255); // 0..254
    const sh = 190 + Math.floor(shade[i] * 90); // brightness 190..279
    for (let c = 0; c < 3; c += 1) {
      const mixed = (p0[c] * (255 - frac) + p1[c] * frac + 127) / 255;
      paint[i * 3 + c] = Math.max(0, Math.min(255, Math.floor((mixed * sh) / 240)));
    }
  }

  // --- damage: dark uneven varnish, paint losses, canvas tears ---
  const vn = valueNoise(rng, 5);
  const varnish0 = new Uint8Array(GRID * GRID);
  for (let i = 0; i < GRID * GRID; i += 1) {
    varnish0[i] = 140 + Math.floor(vn[i] * 115); // 140..254
  }

  const loss0 = new Uint8Array(GRID * GRID);
  const blobCount = 2 + rng.nextInt(3);
  for (let b = 0; b < blobCount; b += 1) {
    const cx = rng.nextInt(GRID);
    const cy = rng.nextInt(GRID);
    const rad = 2 + rng.nextInt(3);
    for (let y = Math.max(0, cy - rad * 2); y <= Math.min(GRID - 1, cy + rad * 2); y += 1) {
      for (let x = Math.max(0, cx - rad * 2); x <= Math.min(GRID - 1, cx + rad * 2); x += 1) {
        const d = Math.floor(Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)));
        const v = Math.max(0, 255 - d * 70);
        if (v > loss0[y * GRID + x]) loss0[y * GRID + x] = v;
      }
    }
  }

  const tear0 = new Uint8Array(GRID * GRID);
  const tearCount = 1 + rng.nextInt(2);
  for (let t = 0; t < tearCount; t += 1) {
    const vertical = rng.nextInt(2) === 0;
    let pos = 2 + rng.nextInt(GRID - 4);
    const steps = GRID;
    for (let s = 0; s < steps; s += 1) {
      pos = Math.max(0, Math.min(GRID - 1, pos + (rng.nextInt(3) - 1)));
      const x = vertical ? pos : s;
      const y = vertical ? s : pos;
      tear0[y * GRID + x] = 255;
    }
  }

  const hasWater = rng.nextInt(10) < 4;
  const hasOldRestoration = rng.nextInt(10) < 3;

  /** @type {string[]} */
  const findings = ['varnish_darkening'];
  if (loss0.some((v) => v > 0)) findings.push('loss');
  if (tear0.some((v) => v > 0)) findings.push('tear');
  if (hasWater) findings.push('water_stain');
  if (hasOldRestoration) findings.push('old_restoration');

  const par = 26 + blobCount * 4 + tearCount * 6 + 8;

  return {
    version: 1,
    seed: seedString,
    epoch: epoch.name,
    title,
    year,
    N: GRID,
    paint,
    varnish0,
    loss0,
    tear0,
    hasWater,
    hasOldRestoration,
    findings,
    par,
  };
}

/**
 * Compact, JSON-friendly puzzle spec for API responses (client regenerates
 * the heavy arrays locally from the seed — this is flavor + checksums).
 * @param {object} puzzle
 */
export function puzzleSpec(puzzle) {
  return {
    version: puzzle.version,
    seed: puzzle.seed,
    epoch: puzzle.epoch,
    title: puzzle.title,
    year: puzzle.year,
    N: puzzle.N,
    par: puzzle.par,
    findings: puzzle.findings, // NOTE: hidden from game clients — see server
  };
}

export { FINDINGS };
