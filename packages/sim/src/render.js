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
 * Смешение одного пикселя/клетки: ТА ЖЕ формула для канонического кадра и
 * галерейной проекции. out[0..2] = R,G,B (0..255, floor).
 */
function mixPixel(r, g, b, i, layers, out) {
  const {
    varnish, loss, tear,
    patch = zero, restored = zero3, restoredMask = zero,
    newVarnish = 0, finished = false,
  } = layers;

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

  out[0] = r;
  out[1] = g;
  out[2] = b;
}

/**
 * Канонический кадр (N*N*4 RGBA) — игровая истина, байт-в-байт как в
 * client/unity/PalimpsestSim/Renderer.cs.
 *
 * @param {object} layers — слои кадра (state или generate() + state)
 * @returns {Uint8Array} RGBA (N*N*4)
 */
export function renderRgba(layers) {
  const { paint } = layers;
  const out = new Uint8Array(GRID * GRID * 4);
  const tmp = new Float64Array(3);
  for (let i = 0; i < GRID * GRID; i += 1) {
    mixPixel(paint[i * 3], paint[i * 3 + 1], paint[i * 3 + 2], i, layers, tmp);
    out[i * 4] = tmp[0];
    out[i * 4 + 1] = tmp[1];
    out[i * 4 + 2] = tmp[2];
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

/**
 * Галерейная проекция (декоративный вид «в раме»): ТА ЖЕ смешение слоёв, но
 * база — живописная подложка эпохи (высокое разрешение), а не процедурная
 * краска. Повреждения берутся из канонической сетки 32×32 (ближайшая клетка).
 *
 * Это НЕ канонический кадр: игровая истина — renderRgba/Renderer.cs; проекция
 * существует, чтобы показать работу в галерее, не подменяя проверяемое
 * состояние (тот же принцип честности, что у проекции телеметрии).
 *
 * @param {Uint8Array|Uint8ClampedArray} baseRgba — подложка (width*height*4)
 * @param {number} width
 * @param {number} height
 * @param {object} layers — те же слои, что и для renderRgba (без paint)
 * @returns {Uint8Array} RGBA (width*height*4)
 */
export function renderGalleryRgba(baseRgba, width, height, layers) {
  const out = new Uint8Array(width * height * 4);
  const tmp = new Float64Array(3);
  for (let y = 0; y < height; y += 1) {
    const cy = Math.min(GRID - 1, Math.floor((y * GRID) / height));
    for (let x = 0; x < width; x += 1) {
      const cx = Math.min(GRID - 1, Math.floor((x * GRID) / width));
      const i = cy * GRID + cx;
      const p = (y * width + x) * 4;
      mixPixel(baseRgba[p], baseRgba[p + 1], baseRgba[p + 2], i, layers, tmp);
      out[p] = tmp[0];
      out[p + 1] = tmp[1];
      out[p + 2] = tmp[2];
      out[p + 3] = 255;
    }
  }
  return out;
}
