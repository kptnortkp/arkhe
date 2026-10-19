// Generates every brand asset from the logo geometry: subtitle paths, standalone SVGs, icons and photo crops.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as fontkit from "fontkit";
import sharp from "sharp";
import { brandColors } from "../src/lib/brand/colors";
import {
  A_FULL,
  A_SOLID,
  A_TWO,
  LOCKUP_BOX,
  MONOGRAM_BOX,
  MONOGRAM_PATH,
  WORDMARK_BOX,
  WORDMARK_PATH,
  letterA,
  toPath,
  type BandCounts,
  type Polygon,
} from "../src/lib/brand/logo-geometry";

const SUBTITLE = "MÜLKİYE ÇOKSESLİ KOROSU";
const SUBTITLE_WEIGHT = 600;
const CAP_HEIGHT = 7.5;
const BASELINE = 102.5;
const RIGHT_EDGE = 357.5;
const WORD_EXTRA = 13.2;
// Diacritics don't count toward ink width: measure the base letter instead.
const INK_BASE: Record<string, string> = { Ü: "U", İ: "I", Ç: "C" };

const round = (n: number) => Math.round(n * 100) / 100;

function subtitlePath(): string {
  const file = fontkit.openSync("brand/fonts/Jost[wght].ttf");
  if (!("getVariation" in file))
    throw new Error("Jost font is a collection, expected a single font");
  const font = file.getVariation({ wght: SUBTITLE_WEIGHT });
  const scale = CAP_HEIGHT / font.capHeight;
  const glyphs = [...SUBTITLE].map((ch) => {
    if (ch === " ") return null;
    const glyph = font.glyphForCodePoint(ch.codePointAt(0)!);
    const ink = font.glyphForCodePoint((INK_BASE[ch] ?? ch).codePointAt(0)!).path.bbox;
    return { glyph, minX: ink.minX * scale, width: (ink.maxX - ink.minX) * scale };
  });
  const letters = glyphs.filter((g) => g !== null);
  const words = SUBTITLE.split(" ").length;
  const inkSum = letters.reduce((sum, g) => sum + g.width, 0);
  const gaps = letters.length - 1;
  const gap = (RIGHT_EDGE - inkSum - (words - 1) * WORD_EXTRA) / gaps;
  let x = 0;
  let d = "";
  let pendingSpace = false;
  for (const g of glyphs) {
    if (g === null) {
      pendingSpace = true;
      continue;
    }
    if (x > 0) x += gap + (pendingSpace ? WORD_EXTRA : 0);
    pendingSpace = false;
    const path = g.glyph.path.scale(scale, -scale).translate(x - g.minX, BASELINE);
    d += path.toSVG().replace(/-?\d*\.?\d+(e-?\d+)?/g, (n) => String(round(Number(n))));
    x += g.width;
  }
  console.log(`subtitle: letter gap ${gap.toFixed(2)}, right ink edge ${x.toFixed(2)}`);
  return d;
}

const standalone = (
  title: string,
  box: { width: number; height: number },
  d: string,
  fill: string,
) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box.width} ${box.height}" width="${box.width * 4}" height="${box.height * 4}" fill="${fill}"><title>${title}</title><path d="${d}"/></svg>\n`;

// Scales the A to `frac` of the canvas height, centres it and nudges it down 1 %.
function placeMark(counts: BandCounts, size: number, frac: number, cut: number): Polygon[] {
  const scale = (size * frac) / MONOGRAM_BOX.height;
  const tx = size / 2 - (79.5 / 2) * scale;
  const ty = size / 2 - (79 / 2) * scale + size * 0.01;
  return letterA(counts, cut).map((p) => p.map(([x, y]) => [tx + x * scale, ty + y * scale]));
}

type IconSpec = {
  size: number;
  frac: number;
  counts: BandCounts;
  cut: number;
  tile: "round" | "full";
};

function iconSvg({ size, frac, counts, cut, tile }: IconSpec): string {
  const bg =
    tile === "round"
      ? `<rect width="${size}" height="${size}" rx="${round(size * 0.22)}" fill="${brandColors.stage}"/>`
      : `<rect width="${size}" height="${size}" fill="${brandColors.stage}"/>`;
  const d = toPath(placeMark(counts, size, frac, cut));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${bg}<path fill="${brandColors.stageForeground}" d="${d}"/></svg>`;
}

const png = (spec: IconSpec) => sharp(Buffer.from(iconSvg(spec))).png({ compressionLevel: 9 });

// PNG-in-ICO container: 6-byte header, one 16-byte entry per image, then the PNG payloads.
function ico(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

function assertMaskable(spec: IconSpec) {
  const c = spec.size / 2;
  const far = Math.max(
    ...placeMark(spec.counts, spec.size, spec.frac, spec.cut)
      .flat()
      .map(([x, y]) => Math.hypot(x - c, y - c)),
  );
  const limit = 0.4 * spec.size - 8;
  if (far >= limit)
    throw new Error(`maskable mark reaches ${far.toFixed(1)} px from centre, limit ${limit}`);
  console.log(`maskable: farthest point ${far.toFixed(1)} px from centre (limit ${limit})`);
}

async function main() {
  // Subtitle geometry for the lockup component.
  const subtitle = subtitlePath();
  writeFileSync(
    "src/lib/brand/logo-geometry.generated.ts",
    `// Generated by scripts/brand-assets.ts from Jost ${SUBTITLE_WEIGHT} (brand/fonts). Do not edit.\nexport const SUBTITLE_PATH =\n  "${subtitle}";\n`,
  );

  // Standalone vector files for the choir, black and white.
  const files: [string, string, { width: number; height: number }, string][] = [
    ["lockup", "Arkhe Mülkiye Çoksesli Korosu", LOCKUP_BOX, WORDMARK_PATH + subtitle],
    ["wordmark", "Arkhe", WORDMARK_BOX, WORDMARK_PATH],
    ["monogram", "Arkhe", MONOGRAM_BOX, MONOGRAM_PATH],
  ];
  for (const [name, title, box, d] of files) {
    writeFileSync(`public/brand/arkhe-${name}.svg`, standalone(title, box, d, "#000"));
    writeFileSync(`public/brand/arkhe-${name}-white.svg`, standalone(title, box, d, "#fff"));
  }

  // Icons.
  mkdirSync("public/icons", { recursive: true });
  // Cut of one canvas pixel, in logo units.
  const onePixel = (size: number, frac: number) => MONOGRAM_BOX.height / (size * frac);
  const any512: IconSpec = { size: 512, frac: 0.58, counts: A_FULL, cut: 0.4, tile: "round" };
  const any192: IconSpec = { size: 192, frac: 0.58, counts: A_FULL, cut: 0.7, tile: "round" };
  const maskable: IconSpec = { size: 512, frac: 0.52, counts: A_FULL, cut: 0.4, tile: "full" };
  const apple: IconSpec = { size: 180, frac: 0.56, counts: A_FULL, cut: 0.7, tile: "full" };
  const fav32: IconSpec = {
    size: 32,
    frac: 0.72,
    counts: A_TWO,
    cut: onePixel(32, 0.72),
    tile: "round",
  };
  const fav16: IconSpec = { size: 16, frac: 0.75, counts: A_SOLID, cut: 0, tile: "round" };

  assertMaskable(maskable);
  await png(any512).toFile("public/icons/icon-512.png");
  await png(any192).toFile("public/icons/icon-192.png");
  await png(maskable).toFile("public/icons/icon-maskable-512.png");
  await png(apple)
    .flatten({ background: brandColors.stage })
    .removeAlpha()
    .toFile("src/app/apple-icon.png");
  writeFileSync(
    "src/app/favicon.ico",
    ico([
      { size: 16, data: await png(fav16).toBuffer() },
      { size: 32, data: await png(fav32).toBuffer() },
    ]),
  );

  // Tab icon: stage tile in light; in dark the tile is dropped and the cream A stands alone.
  writeFileSync(
    "src/app/icon.svg",
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>.t{fill:${brandColors.stage}}.m{fill:${brandColors.stageForeground}}@media (prefers-color-scheme:dark){.t{display:none}}</style><rect class="t" width="32" height="32" rx="7.04"/><path class="m" d="${toPath(placeMark(fav32.counts, 32, fav32.frac, fav32.cut))}"/></svg>\n`,
  );

  // Offline page: static, no JS, colours and the monogram filled in from the brand sources.
  const values: Record<string, string> = {
    ...brandColors,
    monogram: toPath(letterA(A_FULL, 0.7)),
  };
  const offline = readFileSync("scripts/offline.template.html", "utf8").replace(
    /\{\{(\w+)\}\}/g,
    (_, key: string) => {
      if (!(key in values)) throw new Error(`offline.template.html: unknown placeholder ${key}`);
      return values[key];
    },
  );
  writeFileSync("public/offline.html", offline);

  // Photos: crop and tint the raw files in brand/ for stage surfaces.
  const STAGE_TINT = { r: 34, g: 24, b: 66 };

  // Concert photo: crop out the festival backdrop and camera, keep the choir band.
  await sharp("brand/images (1).jpeg")
    .extract({ left: 0, top: 168, width: 547, height: 150 })
    .resize(1200)
    .modulate({ saturation: 0.55 })
    .tint(STAGE_TINT)
    .webp({ quality: 74 })
    .toFile("public/brand/stage-choir.webp");

  // Piano detail: drop the baked-in "DUYURU" text band and the sign-off.
  await sharp("brand/images (2).jpeg")
    .extract({ left: 0, top: 0, width: 387, height: 225 })
    .resize(900)
    .blur(1.2)
    .modulate({ saturation: 0.6 })
    .webp({ quality: 72 })
    .toFile("public/brand/piano.webp");

  await sharp("brand/images (2).jpeg")
    .extract({ left: 0, top: 300, width: 387, height: 150 })
    .resize(900)
    .blur(1.2)
    .modulate({ saturation: 0.6 })
    .webp({ quality: 72 })
    .toFile("public/brand/piano-keys.webp");

  const sizes = [
    "public/icons/icon-192.png",
    "public/icons/icon-512.png",
    "src/app/apple-icon.png",
  ].map((f) => `${f} ${readFileSync(f).length} B`);
  console.log(["brand assets written:", ...sizes].join("\n  "));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
