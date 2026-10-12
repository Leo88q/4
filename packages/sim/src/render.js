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

// ---------- реалистичная (текстурная) проекция ----------
// Декоративный вид «как в жизни»: органические края утрат, рваные разрывы,
// кракелюр и грязевая крапина лака, переплетение холста в грунте. Поля
// сглаживаются билинейно и модулируются детерминированным шумом от сида —
// у всех игроков картинка одна и та же. Игровая истина — канонический кадр.

function hash2i(x, y, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function vnoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2i(xi, yi, seed);
  const b = hash2i(xi + 1, yi, seed);
  const c = hash2i(xi, yi + 1, seed);
  const d = hash2i(xi + 1, yi + 1, seed);
  const ab = a + (b - a) * u;
  const cd = c + (d - c) * u;
  return ab + (cd - ab) * v;
}

function fbm(x, y, seed, oct) {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  for (let k = 0; k < oct; k += 1) {
    sum += amp * vnoise(x, y, seed + k * 1013);
    norm += amp;
    x *= 2.03;
    y *= 2.11;
    amp *= 0.5;
  }
  return sum / norm;
}

const realNoiseCache = new Map();

function realNoise(seed, width, height) {
  const key = `${seed}|${width}x${height}`;
  let rec = realNoiseCache.get(key);
  if (!rec) {
    const n = width * height;
    const dirt = new Float32Array(n);
    const edge = new Float32Array(n);
    const ridge = new Float32Array(n);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        const nx = x / width;
        const ny = y / height;
        dirt[i] = fbm(nx * 20, ny * 20, seed + 17, 3);
        edge[i] = fbm(nx * 26, ny * 26, seed + 91, 2);
        ridge[i] = 1 - Math.abs(2 * fbm(nx * 18, ny * 18, seed + 53, 2) - 1);
      }
    }
    rec = { dirt, edge, ridge };
    if (realNoiseCache.size > 6) realNoiseCache.clear();
    realNoiseCache.set(key, rec);
  }
  return rec;
}

function sampleCell(field, x, y, width, height, stride = 1, off = 0) {
  const gx = ((x + 0.5) / width) * GRID - 0.5;
  const gy = ((y + 0.5) / height) * GRID - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const cx0 = Math.max(0, Math.min(GRID - 1, x0));
  const cx1 = Math.max(0, Math.min(GRID - 1, x0 + 1));
  const cy0 = Math.max(0, Math.min(GRID - 1, y0));
  const cy1 = Math.max(0, Math.min(GRID - 1, y0 + 1));
  const a = field[cy0 * GRID * stride + cx0 * stride + off]
    + (field[cy0 * GRID * stride + cx1 * stride + off] - field[cy0 * GRID * stride + cx0 * stride + off]) * fx;
  const b = field[cy1 * GRID * stride + cx0 * stride + off]
    + (field[cy1 * GRID * stride + cx1 * stride + off] - field[cy1 * GRID * stride + cx0 * stride + off]) * fx;
  return a + (b - a) * fy;
}

function smoothstep(e0, e1, t) {
  const u = Math.max(0, Math.min(1, (t - e0) / (e1 - e0)));
  return u * u * (3 - 2 * u);
}

/**
 * Реалистичная проекция поверх живописной подложки: слои складываются в той
 * же последовательности, что и mixPixel (лак → утрата → разрыв/заплата →
 * новый лак), но с органическими формами и текстурами. Без слоёв кадр
 * байт-в-байт равен подложке. ДЕКОРАТИВНА: канон — renderRgba/Renderer.cs.
 *
 * @param {Uint8Array|Uint8ClampedArray} baseRgba — подложка (width*height*4)
 * @param {number} width
 * @param {number} height
 * @param {object} layers — слои (varnish, loss, tear, soft, patch, restored,
 *   restoredMask, newVarnish, finished)
 * @param {number} [seed] — сид шума (одинаков у всех клиентов)
 * @returns {Uint8Array} RGBA (width*height*4)
 */
export function renderRealRgba(baseRgba, width, height, layers, seed = 0) {
  const {
    varnish, loss, tear,
    soft = zero, patch = zero, restored = zero3, restoredMask = zero,
    newVarnish = 0, finished = false,
  } = layers;
  const out = new Uint8Array(width * height * 4);
  const noise = realNoise(seed | 0, width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const p = i * 4;
      let r = baseRgba[p];
      let g = baseRgba[p + 1];
      let b = baseRgba[p + 2];

      const dirt = noise.dirt[i];
      const edge = noise.edge[i];
      const ridge = noise.ridge[i];

      // 1) старый лак: тонкая янтарная плёнка с грязевой крапиной и кракелюром
      const v0 = sampleCell(varnish, x, y, width, height) / 255;
      const v = Math.max(0, Math.min(1, v0 * (0.92 + 0.16 * (dirt - 0.5)))) * 0.55;
      if (v > 0) {
        const grime = 1 - 0.22 * Math.max(0, dirt - 0.55) * 2.2;
        r = r * (1 - v) + 112 * grime * v;
        g = g * (1 - v) + 88 * grime * v;
        b = b * (1 - v) + 56 * grime * v;
        const crack = smoothstep(0.94, 0.995, ridge) * smoothstep(0.25, 0.55, v0) * 0.38;
        r *= 1 - crack * 0.45;
        g *= 1 - crack * 0.45;
        b *= 1 - crack * 0.45;
      }

      // 2) растворённый лак (soft) — мутная дымка там, где поработал растворитель
      const s = sampleCell(soft, x, y, width, height) / 255;
      if (s > 0) {
        const haze = s * 0.1;
        r = r * (1 - haze) + 178 * haze;
        g = g * (1 - haze) + 158 * haze;
        b = b * (1 - haze) + 126 * haze;
      }

      // 3) утраты: грунт с переплетением холста (пористость) или слой кисти
      const l0 = sampleCell(loss, x, y, width, height) / 255;
      const lm = smoothstep(0.22, 0.72, l0 * (0.86 + 0.28 * (edge - 0.5)));
      if (lm > 0) {
        const rm = smoothstep(0.35, 0.75, sampleCell(restoredMask, x, y, width, height) / 255);
        let rr;
        let gg;
        let bb;
        if (rm > 0) {
          rr = sampleCell(restored, x, y, width, height, 3, 0);
          gg = sampleCell(restored, x, y, width, height, 3, 1);
          bb = sampleCell(restored, x, y, width, height, 3, 2);
          const stroke = 1 + 0.06 * (dirt - 0.5);
          rr *= stroke;
          gg *= stroke;
          bb *= stroke;
        } else {
          const weave = 0.5 + 0.5 * Math.sin((x + 0.5) * Math.PI * 0.25) * Math.sin((y + 0.5) * Math.PI * 0.25);
          const tone = 0.88 + 0.12 * (weave - 0.5) + 0.1 * (dirt - 0.5);
          rr = 196 * tone;
          gg = 188 * tone;
          bb = 170 * tone;
        }
        r = r * (1 - lm) + rr * lm;
        g = g * (1 - lm) + gg * lm;
        b = b * (1 - lm) + bb * lm;
      }

      // 4) разрывы: рваная тьма с волокнами по краю
      const t0 = sampleCell(tear, x, y, width, height) / 255;
      const tm = smoothstep(0.2, 0.72, t0 * (0.84 + 0.32 * (edge - 0.5)) - 0.06 * ridge);
      if (tm > 0) {
        const voidTone = 0.92 + 0.16 * (dirt - 0.5);
        r = r * (1 - tm) + 36 * voidTone * tm;
        g = g * (1 - tm) + 28 * voidTone * tm;
        b = b * (1 - tm) + 24 * voidTone * tm;
        const fiber = (1 - Math.abs(tm * 2 - 1)) * 0.5;
        r += 170 * fiber;
        g += 145 * fiber;
        b += 112 * fiber;
      }

      // 5) заплаты: тканый лоскут (берёзовый тон канона)
      const p0 = sampleCell(patch, x, y, width, height) / 255;
      const pm = smoothstep(0.3, 0.72, p0);
      if (pm > 0) {
        const cross = ((x + y) % 2 === 0 ? 1 : 0.93) * (0.94 + 0.12 * dirt);
        const k = pm * 0.8;
        r = r * (1 - k) + 150 * cross * k;
        g = g * (1 - k) + 132 * cross * k;
        b = b * (1 - k) + 108 * cross * k;
      }

      // 6) новый лак — тёплая плёнка, только после завершения
      if (newVarnish > 0 && finished) {
        const nv = (newVarnish / 255) * 0.2;
        r = r * (1 - nv) + (90 + 24 * (ridge - 0.5)) * nv;
        g = g * (1 - nv) + 70 * nv;
      }

      out[p] = Math.max(0, Math.min(255, Math.round(r)));
      out[p + 1] = Math.max(0, Math.min(255, Math.round(g)));
      out[p + 2] = Math.max(0, Math.min(255, Math.round(b)));
      out[p + 3] = 255;
    }
  }
  return out;
}
