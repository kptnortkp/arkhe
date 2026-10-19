# Phase 6 UX plan

Author: UX designer. Date: 2026-10-19. Reads: `po-spec.md`, `ui.md`, `db.md`, `design/brand-integration.md`, `brand/images.jpeg`. I measured the JPEG pixel by pixel (row and column intensity profiles) and checked a prototype trace by overlay, so the numbers below are measured, not estimated.

Prototype files (scratchpad, not the repo): `/private/tmp/claude-501/-Users-merttemiz-Desktop-development-arkhe/dca171a5-e8a3-44ae-a38e-26b2f08eb84b/scratchpad/logo.mjs` (band generator), `overlay.png` (red = original only, green = trace only, white = both), `cmp.png` (original vs trace at 8×), `mono-sheet.png` (monogram variants at 192/64/48/32/16), `maskable-512.png` (with the 80 % safe circle drawn). The tables in §1 are the source of truth if the scratchpad is gone.

---

## 0. Corrections to the brand reading (affects AC 1, 4, 7 and risk 3)

What the 3× crop actually shows, measured:

1. **Each stroke is a solid band cut by 3 dark hairlines into 4 white bands.** It is not 5 white lines with 1:1 gaps. Every vertical stem, the H bar, the E arms, the A crossbar, the R bowl, the R leg and both K diagonals show exactly 3 intensity dips across a 15.6 px stroke. There is no dark outline along the outer edges.
   - **One exception:** the A's **left** leg is wider (≈ 18.6 px perpendicular) and holds **4 hairlines / 5 bands**.
   - Musically it still reads as a stave: 2 outer edges + 3 cuts = 5 lines bounding 4 spaces. So the "five lines" intuition in brand-integration A1 was right as a stave, but wrong as a drawing instruction.
2. **The line/gap ratio is about 9:1, not 1:1.** The dips only fall to 160–200 (out of 255). Integrating the darkness of each dip gives a cut of ≈ 0.42 px against a 3.9 px pitch. In the drawing: band 3.6, cut 0.4 (units = source px).
3. **The A apex is flat, not sharp, and not round.** It is cut horizontally at cap height, 20 px wide. That is the left leg's top end. The right leg tucks under the left leg, and the counter's apex sits at (42, 22). @po: AC 1 says "sharp apex". The gate should check the flat 20 px top instead, or a faithful trace fails AC 1.
4. **Joins use two kinds of separators:**
   - a **hairline cut** (0.4) where strokes abut: H bar → right stem, A crossbar → right leg, K upper arm → lower leg, R bowl → R leg
   - a **joint gap** of ≈ 3.2 px of pure black where a stroke leaves a stem: H bar ← left stem, E arms ← stem, R bowl ← stem (3.4), R leg ← stem (4.4), K lower leg ← stem (2.4)
   - The A crossbar is fused to the left leg, with no separator.
5. **"Closed ends"** (AC 1): every band ends flush on one straight end line, so each stroke reads as a closed rectangle or parallelogram. Our current component clips open stroke ends. The **E bottom arm** has one extra perpendicular hairline 2.5 px before its end (x = 353). The top and middle arms don't. This is faithful; keep it.
6. **Subtitle:** 21 glyphs, justified exactly between x = 45 and x = 402 (the wordmark's own left and right edges). Cap height 7.5 px. The gap from the wordmark baseline to the subtitle cap top is 16 px, which is one stroke width. The letter gap is ≈ 11.3 px and the word gap ≈ 24.5 px. That is ≈ 1 em of tracking at that size, much wider than the "0.3 em" we assumed.

**Hairline count, for risk 3 and the AC 1 gate: 3 per stroke (4 bands); A left leg 4 (5 bands).** It is not ambiguous at 3× zoom.

---

## 1. Drawing spec (AC 1, 2, 5)

### 1.1 Construction method (@ui-engineer: replaces the `evenodd` outline idea)
- Each stroke is a **convex polygon** (the stroke silhouette) plus a **direction vector**.
- Its bands are the polygon clipped to `n` parallel strips across that direction:
  - strip width `b = (W − (n−1)·cut) / n`
  - pitch `b + cut`
  - `W` is the polygon's extent perpendicular to the direction
- Output is one `<path>` of filled sub-polygons with `fill="currentColor"`. No masks, no ids and no `evenodd` are needed: the gaps are simply unfilled.
- Two Sutherland–Hodgman half-plane clips per band. About 30 lines of code; see `logo.mjs`.
- Benefits:
  - Hairlines are real transparent gaps, so the logo works on photos and stage.
  - `cut` is one parameter, so small sizes can widen it (§1.4).
  - The R bowl is the only curve: concentric D-contours (below).
- Coordinates: **units = source pixels of `brand/images.jpeg`, origin at source (45, 170.5)**. Cap height 79, baseline y = 79.
- Constants:
  - `cut` = 0.4
  - `W` = 15.6 (4 bands of 3.6)
  - A left leg `W5` = 18.6 (5 bands of 3.4)
  - joint gap `G` = 3.2

### 1.2 Letter geometry (verified: edges within ≈ 1 px of the JPEG at 447 px, IoU 0.92; the gate allows 3 px)

| Stroke | Polygon (x, y) | Direction | Bands |
|---|---|---|---|
| A left leg | (0,79) (30.5,0) (50.5,0) (20,79) | (−0.386, 1) | 5 |
| A right leg | (50.7,0.6) (79.5,79) (62.9,79) (42.2,22.6). Top end = left-leg inner edge + cut. Outer edge slope 0.367. | (0.367, 1) | 4 |
| A crossbar | y 47.8 → 63.4. Left end on the left-leg inner edge `x = 50.5 − 0.386y` (fused). Right end = right-leg inner edge `x = 33.9 + 0.367y` − cut. | horizontal | 4 |
| R stem | rect x 87 → 102.6, y 0 → 79 | vertical | 4 |
| R leg | (107,35.5) (123.7,35.5) (141.2,79) (124.5,79) | (0.402, 1) | 4 |
| R bowl | D-contours, see below | — | 4 |
| K stem | rect x 150 → 165.6 | vertical | 4 |
| K lower leg | (175,34) (186.2,45) (213.5,79) (193.5,79) (167.5,47.5) | (0.8, 1) | 4 |
| K upper arm | (201.7,0) (221,0) (185.3,43.6) (174.6,33.1). Its bottom end sits one cut above the lower leg's top edge. | (−0.8, 1) | 4 |
| H stems | rects x 228 → 243.6 and 279 → 294.6 | vertical | 4 each |
| H bar | x 246.8 → 278.6 (gap G on the left, cut on the right), y 31.5 → 47.1 | horizontal | 4 |
| E stem | rect x 306 → 321.6 | vertical | 4 |
| E top arm | x 324.8 → 357.5, y 0 → 15.6 | horizontal | 4 |
| E middle arm | x 324.8 → 349.5, y 31.5 → 47.1 | horizontal | 4 |
| E bottom arm | x 324.8 → 353, then 353.4 → 355.5 (the end hairline), y 63.4 → 79 | horizontal | 4 + 4 |

**R bowl:**
- For band `i` = 0…3, the outer radius is `ro = 22 − 4i` and the inner radius is `ri = ro − 3.6`.
- The band is the region between two D-contours at radius `ro` and `ri`. Each contour runs:
  1. a straight top from x = 106 at y = 22 − r
  2. a quarter arc around (118.5, 22)
  3. a straight vertical at x = 118.5 + r
  4. an arc around (118.5, 31) that continues past 6 o'clock
- Stop each contour at the first point inside the leg zone: y ≥ 33.5 and x ≤ leg right edge + 0.6.
- Effect: the bowl's hairlines end against the leg, and the leg reads as drawn on top.

Letter left edges: A 0, R 87, K 150, H 228, E 306. Overall wordmark box: **358 × 79**.

### 1.3 The three files and components

| Form | viewBox | Content | `aria-label` |
|---|---|---|---|
| Wordmark | `0 0 358 79` | §1.2 | `Arkhe` |
| Lockup | `0 0 358 107` | wordmark + subtitle | `Arkhe Mülkiye Çoksesli Korosu` |
| Monogram | `0 0 80 79` | A only (A strokes from §1.2) | `Arkhe` |

**Subtitle (lockup only), converted to paths by the generator:**
- Text `MÜLKİYE ÇOKSESLİ KOROSU`.
- Font: **Jost 600** (SemiBold). The JPEG stem is ≈ 0.16 × cap height, which is Jost 600, not 500. If the overlay shows our stems heavier than the original, step down to 500 and note it in the review.
- Cap height **7.5 units**: font size = 7.5 / (sCapHeight / unitsPerEm). For Jost that is 0.7, so ≈ 10.7.
- Baseline y = **102.5**, so the cap top is at y = 95. The 16-unit gap to the wordmark baseline equals one stroke width; keep that rule if anything is rescaled. The cedilla of Ç descends to about y 106, inside the 107 box.
- **Justify by ink bounds, not advances:**
  1. Place the left ink edge of M at x = 0 and the right ink edge of the final U at x = 357.5.
  2. Use 18 equal letter gaps `g` and 2 word gaps of `g + 13.2`, so `g = (357.5 − Σ glyph ink widths − 26.4) / 20`. Expect g ≈ 10.5.
  3. Diacritics (Ü dots, İ dot, Ç cedilla) don't count toward ink width.
- @ui-engineer: fontkit + Jost variable TTF (OFL) is fine by me as long as it stays dev-only.

**Standalone files (AC 5):**
- `public/brand/arkhe-{lockup,wordmark,monogram}.svg`, with `fill="#000"`, a transparent background, `<title>`, and no `<text>`.
- Also write white versions `arkhe-*-white.svg` (`fill="#fff"`). The choir will mostly place the logo on dark photos and Instagram posts (the original is white on black). This costs one line in the generator.

### 1.4 Size rules (logo in the UI)

| Where | Form | Size | cut |
|---|---|---|---|
| Mobile header `src/app/(portal)/layout.tsx:47` | wordmark | `h-5` = 20 px tall, ≈ 91 px wide (24 % of 375) | **0.8** units |
| Sidebar md+ `layout.tsx:29` | lockup | `w-44` = 176 px (agree with @ui) | 0.4 |
| Login band (mobile) `auth-layout.tsx:46` | lockup | **`w-48`** = 192 px (today `w-40` sits exactly at the 160 floor; the subtitle cap would be 3.4 px) | 0.4 |
| Login panel md+ `auth-layout.tsx:20` | lockup | `w-64` = 256 px (subtitle cap 5.4 px) | 0.4 |
| Offline page, install card | monogram tile | §2 | per §2 |

Why cut 0.8 below 32 px height:
- At 20 px tall, a 0.4 cut is 0.1 CSS px. At DPR 2–3 that is 0.2–0.3 device px, and the wordmark would turn into flat white blocks.
- With 0.8 it renders as 0.4–0.6 device px. The stripes stay visible as texture without breaking the letter shapes.
- Expose this as a prop (for example `density="small"`). Same geometry, only `cut` changes.

The minimum lockup width stays 160 px (AC 3). I'd raise our own floor to 176 px; nothing in the plan goes below that.

---

## 2. Monogram at icon sizes (AC 7)

I rendered every variant (`mono-sheet.png`). Results:

| Size | Variant | cut | Mark height / canvas | Why |
|---|---|---|---|---|
| 512 (`icon-512`, maskable) | **full**: L 5 / R 4 / bar 4 bands | 0.4 (≈ 1.5 px) | 0.58 any, **0.52 maskable** | Faithful; the hairlines are crisp |
| 192, 180 (apple) | full | **0.7** (≈ 1 px) | 0.58 any, 0.56 apple | 0.4 gives 0.56 px, which looks soft |
| 48–64 (not shipped; reference) | 2 bands | 1 device px | 0.6 | 3 bands already mush at 48 |
| **32** (`favicon.ico`, `icon.svg`) | **2 bands per stroke (1 hairline)**, left leg too | 1 device px → 0.4 units × (79 / mark px) | 0.72 | 3 bands at 32 is grey mush (sheet row 3). 2 bands still reads as "striped A" |
| **16** (`favicon.ico`) | **solid**, with cut = 0 (no line between the legs) | 0 | 0.75 | Anything striped shimmers |

- @po: AC 7 says "3 hairlines at 32 px". Under the corrected count, 3 hairlines is the full original, so that would be no reduction at all. The render shows 1 hairline per stroke at 32 is the legible choice. **Please read AC 7 as: 32 px = 1 hairline per stroke (2 bands); 16 px = solid.**
- **Placement:** centre the A's bounding box (80 × 79), then nudge it **down by 1 % of the canvas**. The A is light at the top, so a geometric centre looks high.
- **Maskable safe zone:**
  - At 0.52 the mark is 266 px tall on 512.
  - The farthest points are the two bottom corners at ≈ 189 px from the centre, against the 204.8 px radius of the 80 % circle. That leaves a 16 px margin (see `maskable-512.png`).
  - @ui-engineer: 0.56 leaves ≈ 1 px of margin. Use 0.52 and keep your numeric assert at `< 0.4 × size − 8`.
- **`icon.svg`** uses the 32-px variant (2 bands). Chrome draws it at 16 CSS px, which is 32 device px on the typical 2× screen.

### 2.1 Icon colours (all hex mirror the measured tokens in `src/lib/brand/colors.ts`)

| File | Background | Mark |
|---|---|---|
| `icon-192.png`, `icon-512.png` (`any`) | `--stage` light `#26214e`, rounded tile rx 22 % on transparent | `--stage-foreground` `#f9f5ec` |
| `icon-maskable-512.png` | `#26214e` full bleed | `#f9f5ec` |
| `apple-icon.png` 180 | `#26214e` full bleed, no alpha (iOS rounds it) | `#f9f5ec` |
| `favicon.ico` 16 + 32 | `#26214e` tile rx 22 % | `#f9f5ec` |
| `icon.svg` light (`prefers-color-scheme: light`, default) | `#26214e` tile rx 22 % | `#f9f5ec` |
| `icon.svg` dark | **no tile** (transparent) | `#f9f5ec` |

@ui-engineer, a counter-proposal on the dark `icon.svg`:
- An inverted cream tile is the brightest object on a dark tab strip, and it doesn't match the home-screen icon.
- A stage tile on a dark tab strip (`#26214e` on ≈ `#35363a`) disappears and leaves a muddy square.
- Dropping the tile and keeping the cream A gives a clean mark on dark chrome, and it still meets the AC 7 "switches via `prefers-color-scheme`" requirement.

**One icon background in both themes for PNGs:**
- Use light `--stage` (`#26214e`), not dark `--stage` (`#1a1436`). On a dark home screen `#1a1436` is nearly black and loses the brand violet.
- Home-screen icons don't follow the page theme anyway.

### 2.2 Manifest and theme colours (AC 9)
- `theme_color: "#26214e"` (light `--stage`) and `background_color: "#0d0b19"` (dark `--background`), as the PO specifies.
- With a cream mark on `#26214e`, the Android splash looks like a lit stage.
- `viewport.themeColor`: agree with @ui. Light `#f9f6f1` and dark `#0d0b19` (exact `--background`), so the status bar merges with the sticky header. Today's `#120f24` is visibly off.
- No token changes are needed. **Proposed token addition for the offline page and icons:** none. Hex lives only in `colors.ts`, which mirrors existing tokens.

---

## 3. Staff motif (AC 4)

@po: I disagree with "about 1:1". The logo is ≈ 9:1 band:cut, and a 1:1 group at our opacity reads as a grey bar, not a stave. Spec instead:
- `.staff-lines`: **5 lines of 1 px, pitch 4 px** (1 px line, 3 px space). Group height 17 px, which is the proportion of one logo stroke lying on its side.
- Keep `background-position: 0 calc(100% − 28px)`.
- Keep `--staff-line` at 6 % on light and dark, and 8 % in `.on-stage`. The group is now denser, so don't raise it.
- 1 px is the floor (agree with @ui; never sub-pixel).
- Gate: screenshot `coming-soon` and an empty state in both themes at 390 and at 1× DPR. The stave must read as 5 separate lines at 2× and must not moiré at 1×. If it moirés at 1×, go to a 5 px pitch.

AC 6: agree. `tracking-[0.2em]` on all eyebrows (`DÖNEMLER`, `ÖDEMELERİM`…), a one-token sweep.

---

## 4. Profil: `Telefonuna ekle` card (AC 12)

**Placement:** directly under the identity block (avatar + name) and **above** `Aidatım` in `src/app/(portal)/profil/page.tsx`.
- It is a one-time, high-value action. At the bottom it would sit under ≈ 1700 px of dues and forms on a member's phone (see the 390 screenshot).
- It disappears for good once the app runs standalone, so it is not nagging. No dismiss button. Nothing else in the app mentions installing.

**Layout at 375 px:**
- `rounded-2xl border bg-card p-4` with `space-y-3`.
- Row 1: `flex items-start gap-3`
  - 40 × 40 monogram tile: `bg-stage text-stage-foreground rounded-xl`, 2-band variant, mark 24 px tall, `aria-hidden`
  - text column: title `Telefonuna ekle` (`text-base font-medium`, an `h2` for the outline), then body `text-sm text-muted-foreground`
- Row 2 (Android only): full-width button.

| State | Body text | Action |
|---|---|---|
| Chrome/Android, `beforeinstallprompt` stored | `Arkhe'yi ana ekranına ekle; yoklamaya ve ödevlerine tek dokunuşla ulaş.` | `Button` default (primary), `h-11 w-full rounded-full`, lucide `SquarePlus` icon + `Ana ekrana ekle` |
| iOS / iPadOS (UA rule from @ui) | `Safari'de Paylaş simgesine, sonra "Ana Ekrana Ekle"ye dokun.` with the lucide `Share` icon (size-4, `aria-hidden`, `inline align-[-2px]`) right after the word `Paylaş` | none |
| Other browser, no prompt | `Tarayıcı menüsünden "Ana ekrana ekle" ya da "Uygulamayı yükle"yi seç.` (agree with @ui's counter-proposal) | none |
| After `appinstalled` (this session) | `Eklendi. Arkhe'yi artık ana ekranından açabilirsin.` with lucide `CircleCheck` in `text-present` | none |
| `userChoice` = dismissed | Fall back to the "other browser" text. Chrome won't re-offer the prompt soon, and a dead button is worse. | none |
| `display-mode: standalone` or `navigator.standalone` | card not rendered | — |

- The server renders nothing, so standalone users get no flash (agree with @ui's `useSyncExternalStore` approach).
- Reserve no space for the card: it appears above `Aidatım` and pushes it down once on mount. That's acceptable on a page nobody lands on mid-scroll.

---

## 5. Offline page `Bağlantı yok` (AC 16)

Static `public/offline.html`, no JS (agree with @ui on the static file and inline CSS).

**Layout at 375 × 812:**
- `body`: `min-height: 100dvh`, a flex column centred vertically. Padding `max(24px, env(safe-area-inset-top))` 24px `max(24px, env(safe-area-inset-bottom))`.
- Content column `max-width: 22rem`, centred, `text-align: center`. Contents, top to bottom:
  1. **Monogram tile** 72 × 72, radius 18 px, background `#26214e`, mark `#f9f5ec`, full-count variant with cut 0.7, mark 42 px tall. `role="img" aria-label="Arkhe"`. 24 px below.
  2. `<h1>Bağlantı yok</h1>`: 28 px / 1.2, weight 500, letter-spacing −0.01em. 12 px below.
  3. `<p>` body copy exactly as AC 16: 16 px / 1.5, muted colour. 32 px below.
  4. `<a href="/" class="btn">Tekrar dene</a>`: block, width 100 %, max 20rem, height 48 px, radius 9999 px, 16 px weight 500, `:focus-visible` outline 2 px offset 3 px in the button colour.
  5. Footer at the bottom of the viewport (`margin-top: auto` in an outer column): `ARKHE · MÜLKİYE ÇOKSESLİ KOROSU`, 11 px, `letter-spacing: 0.2em`, muted, with a 5-line stave from §3 (17 px) above it.
- **Fonts: system sans for everything**: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. @ui-engineer: please don't use `ui-serif`/Georgia for the heading. The brand display face is the geometric sans Jost, and a serif would be the one off-brand screen. The system sans is closer.

**Colours (hex from `colors.ts`; measure the two muted values like the others):**

| | Light | Dark |
|---|---|---|
| page | `--background` `#f9f6f1` | `#0d0b19` |
| heading | `--foreground` | `--foreground` |
| body, footer | `--muted-foreground` (oklch 0.5 0.025 275) | oklch 0.7 0.02 275 |
| tile | `#26214e` | `#1a1436` + 1 px border `rgb(255 255 255 / 9%)` |
| button | `--primary` (stage) bg, `--primary-foreground` text | `--gold` bg, `--gold-foreground` text (dark primary) |

- No horizontal scroll at 320 px: everything is fluid, and the longest word is `edebilirsin.`.
- Check light and dark at 375 as part of the prod-e2e screenshots.

---

## 6. `Son değişiklik` line (AC 30)

Copy (exact): `Son değişiklik: {Ad Soyad} · {d MMM yyyy}`, deleted user → `Son değişiklik: silinmiş üye · {tarih}`.
- Date: `Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Istanbul" })` gives `19 Eki 2026`.

**Rate:** in `RateForm` (`src/components/finance/member-dues-forms.tsx:96`), inside the `hint` slot directly under the existing `Ödenmemiş dönemlerin borcu…` line.
- `<p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="rate-audit">` with lucide `History` (`size-3.5`, `aria-hidden`).
- Not below `Kaydet`: it describes the current value of the chips, so it belongs with them. Right after a save it then shows the saver's own name, which also serves as confirmation.
- Render only when a `member_dues` row exists; no row means the default rate, with no line.

**Waiver:** in the `reason` branch of `WaiverForm` (`:136`), directly under `{periodName}: Bu dönem muaf: {reason}`, same classes, `data-testid="waiver-audit"`, and before the `Muafiyeti kaldır` button.

At 375 the line fits on one row for names up to about 28 characters. Longer names wrap naturally, with the icon top-aligned (`items-start` + `mt-0.5` on the icon).

- Members' own `Aidatım` never renders it (the server query for `MyDuesSection` doesn't select `updated_by`).
- Optional, not in the AC: when the editor is the member themselves, append ` (kendisi)`. Deferred to keep the e2e string exact; noted for the backlog.

---

## 7. Cheap UX polish (AC 36): what I agree with

All six AC 36 items: **agree**.
- ux P3-1: dues rows titled by the member's name
- ux P3-5: hide `Nasıl ödenir?` for fully exempt members with no open periods
- ux P3-6: disabled trash with `aria-disabled` + `Ödemesi olan dönem silinemez`, visible as `title`, plus a `sr-only` span because `title` isn't reliable on touch
- ui P3-1, P3-2, P3-4: agree. For P3-4 I support @ui's `--absent-foreground` pair as long as it's listed in the token table:

| Token | Light | Dark | Reason |
|---|---|---|---|
| `--absent-foreground` | `oklch(0.99 0 0)` | `var(--background)` | text on solid `bg-absent` chips, replacing `text-white` |

Two more phase-5 P3s that cost minutes and protect money entry. I'd add them under "Could"; @po decides:
- **ux P3-2:** leading `Check` icon on the checked account/category chip (`hidden group-has-checked:inline size-4`). No copy change, no e2e churn.
- **ux P3-4:** `son ödeme 15 Kas` in the `Toplu oluştur` preview (one formatter).

Not now:
- ux P3-3 and P3-10 (label renames): they churn existing e2e selectors in the final phase.
- P3-7/8/9: layout work.

---

## Replies by AC (summary)
- **AC 1:** the hairline count is 3 per stroke (4 bands), with 4 on the A left leg. The apex is **flat**, 20 px. Please amend the gate wording ("sharp apex" → "flat apex, 20 px at 447"). The trace in §1.2 already passes the 3 px edge check (≈ 1 px).
- **AC 2:** agree. `currentColor`, labels as specified, one file.
- **AC 3:** agree. Sidebar `w-44`, mobile login `w-48`, panel `w-64`, header `h-5` with cut 0.8.
- **AC 4:** counter-proposal, 1 px lines on a 4 px pitch rather than 1:1 (§3).
- **AC 5:** agree, plus white variants.
- **AC 6:** agree.
- **AC 7:** 32 px = 1 hairline per stroke (2 bands); 16 px solid; maskable mark 52 %; dark `icon.svg` drops the tile (§2).
- **AC 9:** agree with the colours (§2.2).
- **AC 12:** placement above `Aidatım`, states and copy in §4. I accept @ui's non-iOS text.
- **AC 16:** layout in §5. System sans, not serif.
- **AC 30:** placement in §6.
- **AC 36:** agree with all six, and suggest two more.
