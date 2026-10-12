/**
 * Канонический композитор рендера (v2, CONCEPT.md §9.3 / INTEGRATION.md).
 *
 * Одна формула на все клиенты: web demo, Unity-форк и проверяющие скрипты
 * обязаны смешивать слои байт-в-байт одинаково. Математика — IEEE-754 double
 * в том же порядке операций (C#-порт в client/unity/PalimpsestSim/Renderer.cs
 * повторяет её выражение в выражение). «Око мастера» (xray) — интерактивный
 * слой поверх канонического вида и в паритет не входит.
 *
 * Физический вид: краска под старым лаком, утраты — грунт, разрывы — тьма,
 * заплаты — берёзовый лоскут, новый лак — тёплая плёнка (только после finish).
 */
import { GRID } from './const.js';

const zero = new Uint8Array(GRID * GRID);
const zero3 = new Uint8Array(GRID * GRID * 3);

/**
 * @param {object} layers — слои кадра (state или generate() + state)
 * @param {Uint8Array|number[]} layers.paint    — RGB краски (N*N*3)
 * @param {Uint8Array|number[]} layers.varnish  — N*N
 * @param {Uint8Array|number[]} layers.loss     — N*N
 * @param {Uint8Array|number[]} layers.tear     — N*N
 * @param {Uint8Array|number[]} [layers.patch]  — N*N
 * @param {Uint8Array|number[]} [layers.restored] — RGB восстановленного (N*N*3)
 * @param {Uint8Array|number[]} [layers.restoredMask] — N*N
 * @param {number} [layers.newVarnish] — 0..255
 * @param {boolean} [layers.finished]
 * @returns {Uint8Array} RGBA (N*N*4)
 */
export function renderRgba(layers) {
  const {
    paint, varnish, loss, tear,
    patch = zero, restored = zero3, restoredMask = zero,
    newVarnish = 0, finished = false,
  } = layers;
  const out = new Uint8Array(GRID * GRID * 4);
  for (let i = 0; i < GRID * GRID; i += 1) {
    let r = paint[i * 3];
    let g = paint[i * 3 + 1];
    let b = paint[i * 3 + 2];

    // старый лак: тёплая плёнка (v — доля лака)
    const v = varnish[i] / 255;
    r = Math.floor(r * (1 - v * 0.82) + 52 * v);
    g = Math.floor(g * (1 - v * 0.82) + 38 * v);
    b = Math.floor(b * (1 - v * 0.82) + 26 * v);

    // утраты: грунт (196,188,170) или восстановленный слой
    const lossNow = loss[i] / 255;
    if (lossNow > 0) {
      const rr = restoredMask[i] > 0 ? restored[i * 3] : 196;
      const gg = restoredMask[i] > 0 ? restored[i * 3 + 1] : 188;
      const bb = restoredMask[i] > 0 ? restored[i * 3 + 2] : 170;
      r = Math.floor(r * (1 - lossNow) + rr * lossNow);
      g = Math.floor(g * (1 - lossNow) + gg * lossNow);
      b = Math.floor(b * (1 - lossNow) + bb * lossNow);
    }

    // разрывы без заплаты — тьма; заплата — берёзовый лоскут
    if (tear[i] > 0 && patch[i] === 0) {
      r = 36; g = 28; b = 24;
    } else if (patch[i] > 0) {
      r = Math.floor(r * 0.6 + 150 * 0.4);
      g = Math.floor(g * 0.6 + 132 * 0.4);
      b = Math.floor(b * 0.6 + 108 * 0.4);
    }

    // новый лак — тёплая плёнка, только после завершения
    if (newVarnish > 0 && finished) {
      const nv = newVarnish / 255;
      r = Math.floor(r * (1 - nv * 0.2) + 90 * nv * 0.2);
      g = Math.floor(g * (1 - nv * 0.2) + 70 * nv * 0.2);
    }

    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Первый кадр — то, что реставратор видит, взяв заказ: слои generate(). */
export function renderInitialRgba(puzzle) {
  return renderRgba({
    paint: puzzle.paint,
    varnish: puzzle.varnish0,
    loss: puzzle.loss0,
    tear: puzzle.tear0,
  });
}

/** Кадр из рабочего состояния (после очередного действия). */
export function renderStateRgba(puzzle, state) {
  return renderRgba({
    paint: puzzle.paint,
    varnish: state.varnish,
    loss: state.loss,
    tear: state.tear,
    patch: state.patch,
    restored: state.restored,
    restoredMask: state.restoredMask,
    newVarnish: state.newVarnish,
    finished: state.finished,
  });
}
