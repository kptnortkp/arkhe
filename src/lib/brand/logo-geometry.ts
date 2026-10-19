// ARKHE logo traced from brand/images.jpeg. Units are source pixels, origin at source (45, 170.5).
// Every stroke is a convex polygon clipped into parallel bands; the gaps between bands are the hairlines.

export type Point = [number, number];
export type Polygon = Point[];

export const CUT = 0.4;
export const CUT_SMALL = 0.8;
const STROKE = 15.6;
const JOINT_GAP = 3.2;

export const WORDMARK_BOX = { width: 358, height: 79 } as const;
export const LOCKUP_BOX = { width: 358, height: 107 } as const;
export const MONOGRAM_BOX = { width: 80, height: 79 } as const;

// Keep the points p with n·p >= d (Sutherland–Hodgman against one half-plane).
function clipHalf(poly: Polygon, nx: number, ny: number, d: number): Polygon {
  const out: Polygon = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = a[0] * nx + a[1] * ny - d;
    const db = b[0] * nx + b[1] * ny - d;
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

function bands(poly: Polygon, dir: Point, n: number, cut: number): Polygon[] {
  const len = Math.hypot(dir[0], dir[1]);
  const nx = -dir[1] / len;
  const ny = dir[0] / len;
  const s = poly.map((p) => p[0] * nx + p[1] * ny);
  const lo = Math.min(...s);
  const width = Math.max(...s) - lo;
  const band = (width - (n - 1) * cut) / n;
  const out: Polygon[] = [];
  for (let i = 0; i < n; i++) {
    const s0 = lo + i * (band + cut);
    out.push(clipHalf(clipHalf(poly, nx, ny, s0), -nx, -ny, -(s0 + band)));
  }
  return out;
}

const rect = (x0: number, y0: number, x1: number, y1: number): Polygon => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const VERTICAL: Point = [0, 1];
const HORIZONTAL: Point = [1, 0];

export type BandCounts = { left: number; right: number; bar: number };
export const A_FULL: BandCounts = { left: 5, right: 4, bar: 4 };
export const A_TWO: BandCounts = { left: 2, right: 2, bar: 2 };
export const A_SOLID: BandCounts = { left: 1, right: 1, bar: 1 };

export function letterA(counts: BandCounts = A_FULL, cut = CUT): Polygon[] {
  const kL = 30.5 / 79;
  const leftOuter = (y: number) => 30.5 - kL * y;
  const leftInner = (y: number) => 50.5 - kL * y;
  const kR = 29 / 79;
  const halfR = STROKE / Math.cos(Math.atan(kR));
  const rightOuter = (y: number) => 50.5 + kR * y;
  const rightInner = (y: number) => 50.5 - halfR + kR * y;
  const clipX = (y: number) => leftInner(y) + cut / Math.cos(Math.atan(kL));
  // The right leg tucks under the left leg: find where its edges meet the left leg's inner edge.
  const meet = (f: (y: number) => number) => {
    let lo = 0;
    let hi = 79;
    for (let i = 0; i < 60; i++) {
      const m = (lo + hi) / 2;
      if (f(m) < clipX(m)) lo = m;
      else hi = m;
    }
    return lo;
  };
  const yo = Math.max(meet(rightOuter), 0);
  const yi = meet(rightInner);
  const left: Polygon = [
    [leftOuter(79), 79],
    [leftOuter(0), 0],
    [leftInner(0), 0],
    [leftInner(79), 79],
  ];
  const right: Polygon = [
    [rightOuter(yo), yo],
    [rightOuter(79), 79],
    [rightInner(79), 79],
    [rightInner(yi), yi],
  ];
  const by0 = 47.8;
  const by1 = 63.4;
  const barRight = (y: number) => rightInner(y) - cut / Math.cos(Math.atan(kR));
  const bar: Polygon = [
    [leftInner(by0), by0],
    [barRight(by0), by0],
    [barRight(by1), by1],
    [leftInner(by1), by1],
  ];
  return [
    ...bands(left, [-kL, 1], counts.left, cut),
    ...bands(right, [kR, 1], counts.right, cut),
    ...bands(bar, HORIZONTAL, counts.bar, cut),
  ];
}

function letterR(cut: number): Polygon[] {
  const out = bands(rect(87, 0, 102.6, 79), VERTICAL, 4, cut);
  const k = 0.402;
  const legWidth = 16.7;
  const top = 35.5;
  const legL = (y: number) => 107 + k * (y - top);
  const legR = (y: number) => 107 + legWidth + k * (y - top);
  out.push(
    ...bands(
      [
        [legL(top), top],
        [legR(top), top],
        [legR(79), 79],
        [legL(79), 79],
      ],
      [k, 1],
      4,
      cut,
    ),
  );
  // Bowl: concentric D-contours that stop where they run into the leg.
  const cx = 118.5;
  const cyTop = 22;
  const cyBottom = 31;
  const hidden = (x: number, y: number) => y >= top - 2 && x <= legR(y) + 0.6;
  const contour = (r: number): Polygon => {
    const pts: Polygon = [[106, cyTop - r]];
    for (let d = 0; d <= 90; d += 2) {
      const t = (d * Math.PI) / 180;
      pts.push([cx + r * Math.sin(t), cyTop - r * Math.cos(t)]);
    }
    for (let d = 90; d <= 200; d += 2) {
      const t = (d * Math.PI) / 180;
      pts.push([cx + r * Math.sin(t), cyBottom - r * Math.cos(t)]);
    }
    const kept: Polygon = [];
    for (const p of pts) {
      if (hidden(p[0], p[1])) break;
      kept.push(p);
    }
    return kept;
  };
  const band = (STROKE - 3 * cut) / 4;
  for (let i = 0; i < 4; i++) {
    const ro = 22 - i * (band + cut);
    out.push([...contour(ro), ...contour(ro - band).reverse()]);
  }
  return out;
}

function letterK(cut: number): Polygon[] {
  const lower: Polygon = [
    [175, 34],
    [186.2, 45],
    [213.5, 79],
    [193.5, 79],
    [167.5, 47.5],
  ];
  const upper: Polygon = [
    [201.7, 0],
    [221, 0],
    [185.3, 43.6],
    [174.6, 33.1],
  ];
  return [
    ...bands(rect(150, 0, 165.6, 79), VERTICAL, 4, cut),
    ...bands(lower, [0.8, 1], 4, cut),
    ...bands(upper, [-0.8, 1], 4, cut),
  ];
}

function letterH(cut: number): Polygon[] {
  return [
    ...bands(rect(228, 0, 243.6, 79), VERTICAL, 4, cut),
    ...bands(rect(279, 0, 294.6, 79), VERTICAL, 4, cut),
    ...bands(rect(243.6 + JOINT_GAP, 31.5, 279 - cut, 47.1), HORIZONTAL, 4, cut),
  ];
}

function letterE(cut: number): Polygon[] {
  const x0 = 321.6 + JOINT_GAP;
  return [
    ...bands(rect(306, 0, 321.6, 79), VERTICAL, 4, cut),
    ...bands(rect(x0, 0, 357.5, 15.6), HORIZONTAL, 4, cut),
    ...bands(rect(x0, 31.5, 349.5, 47.1), HORIZONTAL, 4, cut),
    ...bands(rect(x0, 63.4, 353, 79), HORIZONTAL, 4, cut),
    ...bands(rect(353 + cut, 63.4, 355.5, 79), HORIZONTAL, 4, cut),
  ];
}

export function wordmarkPolygons(cut = CUT): Polygon[] {
  return [
    ...letterA(A_FULL, cut),
    ...letterR(cut),
    ...letterK(cut),
    ...letterH(cut),
    ...letterE(cut),
  ];
}

const round = (n: number) => Math.round(n * 100) / 100;

export function toPath(polys: Polygon[]): string {
  return polys
    .filter((p) => p.length > 2)
    .map((p) => "M" + p.map(([x, y]) => `${round(x)} ${round(y)}`).join("L") + "Z")
    .join("");
}

export const WORDMARK_PATH = toPath(wordmarkPolygons(CUT));
export const WORDMARK_PATH_SMALL = toPath(wordmarkPolygons(CUT_SMALL));
export const MONOGRAM_PATH = toPath(letterA(A_FULL, CUT));
// Two bands and a cut of about one device pixel at 24–32 px tall.
export const MONOGRAM_PATH_SMALL = toPath(letterA(A_TWO, 1.6));
