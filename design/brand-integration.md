# Brand integration

Part A analyses the three images in `brand/` (they arrived 2026-10-17 during this review). Part B is the method to repeat for every future asset. Part C covers processing rules and deliverables.

---

## Part A: what is in `brand/` now

| File | Size | What it is |
|---|---|---|
| `images.jpeg` | 447×447 JPEG | Official logo, white on black |
| `images (1).jpeg` | 547×365 JPEG | Concert photo: choir on stage at the Çanakkale International Choir Festival (July 2026) |
| `images (2).jpeg` | 387×516 JPEG | Instagram "DUYURU" (announcement) post template |

All three are web thumbnails (the filenames look like they came from an image search). That's enough to set direction but **too small to ship**. See the requests at the end of Part A.

### A1. Logo: the most important finding
- Wordmark **ARKHE** in uppercase geometric sans (Futura/Bauhaus geometry: round-apex A, straight-leg R/K). Each stroke is drawn as **five parallel thin lines**, like a musical stave. Below it: **MÜLKİYE ÇOKSESLİ KOROSU** in small, widely tracked caps (≈ 0.3em) spanning the wordmark width.
- Monochrome. No brand colour is in the logo itself.
- **Conflict with the current app:** `src/components/logo.tsx` renders lowercase Fraunces `arkhe` + gold dot, and `LogoMark` is an `α` tile. Neither resembles the real mark. The `Logo` and `LogoMark` components should render the official SVG instead (P1 once the SVG exists).
- **Good news:** the five-line stroke is exactly the staff motif the app already uses (`.staff-lines`). Keep the motif, and draw it from the logo: groups of 5 hairlines with ~1:1 line/gap ratio, as in the strokes, not the current 1px lines on 9px spacing.
- The wide-tracked caps subtitle matches the existing eyebrow style (`tracking-[0.18em] uppercase text-xs`). Push eyebrows to `tracking-[0.2em]` to rhyme with it.

Usage rules:
- Implement as inline SVG with `fill="currentColor"` so it is `text-foreground` on ivory (light), `text-foreground` on dark, and `text-stage-foreground` on stage.
- Two lockups: **full** (ARKHE + subtitle), for login panel, splash and the md+ sidebar (subtitle hidden below ~160px width, where it becomes unreadable); **wordmark only** (ARKHE), for the mobile header at height 18–20px.
- At ≤ 24px height the 5-line strokes merge into grey mush. For favicon/PWA icon, use a **monogram**: the "A" alone, with the strokes reduced to 3 lines at 32px and solid at 16px.
- Clear space: the height of the "A" counter on all sides. Never place on a photo without the overlay from Part C.

### A2. Concert photo
- Content: about 20 singers in two rows. Women in **deep plum/aubergine** gowns (sampled `#2a1020` ≈ `oklch(0.22 0.05 344)`), men in black suits, conductor from behind in black, warm wooden stage floor (`#7b3b18`). The upper third is the festival's projected backdrop (third-party logos, a QR code, pale blue) and a camera in the foreground.
- **Usable crop:** the band from the top of the back row to the stage edge (in this thumbnail y ≈ 150–300), which removes the festival branding and QR code. That gives roughly a 3.6:1 strip: good for the **home hero background** (wide), bad for the tall login panel.
- Colour cue: the plum gowns are the choir's actual "concert colour". Worth a token for concert/event surfaces later (Phase "Takvim ve konserler"): `--plum: oklch(0.3 0.07 344)` light, `oklch(0.34 0.07 344)` dark (as a surface under `stage-foreground` text). Not needed in Phase 1.
- Consent: members are recognisable. Inside the logged-in portal that's fine. On public pages (`/giris`, PWA splash) it needs the board's OK. **PO decision.**

### A3. "DUYURU" post template: the Instagram look
- Full-bleed photo (piano close-up) under a **dark navy-violet wash**: dominant samples `#080421`, `#120624`, `#1e1638`, i.e. `oklch(0.14–0.23 0.06 284–298)`. That's very close to our `--stage` (`oklch(0.3 0.09 275)`), so the indigo guess was right, just slightly too blue and too light.
- Headline **DUYURU** in a wide geometric sans, caps, filled with a **left-to-right gradient**: teal `#65c2d3` → mint `#84c5bf` → lime `#bbd49a` → butter `#f0e2a5`.
- Small "ARKHE" wordmark centred at the bottom as a sign-off.
- This is the reference for the future "Duyurular" screen and the WhatsApp-share card, and it gives the app a second accent (the gradient) that our amber gold doesn't match.

### A4. Proposed token changes from the brand

| Token | Light | Dark | Reason |
|---|---|---|---|
| `--stage` | `oklch(0.28 0.08 285)` | `oklch(0.22 0.065 288)` | Move toward the Instagram navy-violet (hue 284–298). Keeps ≥ 9:1 with `--stage-foreground`. |
| `--primary` (light) | `oklch(0.33 0.09 285)` | unchanged (gold) | Follow the stage hue shift so primary buttons and the hero stay one family. |
| `--brand-teal` | `oklch(0.76 0.09 211)` | same | Gradient stop 1 |
| `--brand-mint` | `oklch(0.78 0.067 189)` | same | Gradient stop 2 |
| `--brand-lime` | `oklch(0.84 0.082 127)` | same | Gradient stop 3 |
| `--brand-butter` | `oklch(0.91 0.08 97)` | same | Gradient stop 4 |
| `.bg-brand-gradient` utility | `linear-gradient(90deg, var(--brand-teal), var(--brand-mint) 35%, var(--brand-lime) 70%, var(--brand-butter))` | same | Decorative only |

Rules for the gradient: only on `bg-stage` / photo surfaces or as a non-text hairline. Never as text or fill on ivory: butter on ivory is ≈ 1.1:1. Good uses: a 3px bar under the login quote, the active-tab indicator on stage, `background-clip: text` for one display word on the login panel (e.g. the choir name), the progress bar on the `checked_in` hero state.

Gold (`--gold`, amber) vs. brand butter: keep gold for the primary action. It needs saturation to read as a button, and butter on stage would look washed out. If the PO wants strict brand fidelity, shift gold toward the gradient end: `oklch(0.84 0.11 92)` (still ≈ 9:1 with `--gold-foreground`). **PO decision.**

### A5. Typography
The brand is geometric sans caps. Fraunces (soft serif) is not in it anywhere. Options:
1. **Keep Fraunces** for headings as the portal's own editorial voice, with brand presence carried by the SVG logo, uppercase tracked eyebrows and the gradient. Lowest effort.
2. **Swap the display font to Jost** (free Google Font, Futura-like, full Turkish `latin-ext`): headings `font-medium tracking-tight`, eyebrows and announcement titles in caps `tracking-[0.2em]`. Body stays Geist. Closest to the logo and the Instagram posts.

Recommendation: **option 2**. With 30–60 people who know the Instagram look, the app should feel like the same choir. It's a one-line change in `layout.tsx` (`Fraunces` → `Jost`, keep `--font-display`). **PO decision.**

### A6. Requests to the PO (to unblock shipping)
1. The logo as **SVG or PDF/AI** (any vector), ideally both lockups. If none exists: a PNG ≥ 2000px wide to trace with potrace (free).
2. The font used in the Instagram templates (or the Canva template name).
3. 3–5 original photos ≥ 2000px on the long side: one **portrait** (for the login panel), one wide stage shot without festival branding, one detail shot (hands on score, piano), for empty states.
4. The board's OK to show member photos on the public login page.

---

## Part B: method for each new asset

For every file dropped in `brand/`:

1. **Inventory:** filename, pixel size, format, transparency, source (Instagram export / original camera / designer file). Anything < 1500px on the long side is reference-only.
2. **Classify:** logo / photo (people, venue, detail) / template (post, story) / typography sample.
3. **Extract:**
   - Palette: quantise to 8 colours, convert to OKLCH, note % coverage. Compare each against existing tokens (`--stage`, `--gold`, voice-part colours). Propose changes in the token-table format (name, light, dark, reason).
   - Type: font family or closest free match on Google Fonts with `latin-ext` (must render ç ğ ı İ ö ş ü).
   - Motifs: repeated shapes (stave lines, gradient direction, framing).
   - Logo: lockups, minimum size, clear space, mono/colour versions.
4. **Check problems:** third-party logos/QR codes in frame, recognisable faces (consent), baked-in text (can't reuse), heavy JPEG artefacts, watermarks.
5. **Assign placements** (table below) and the crop for each.
6. **Process** (Part C), export to `public/brand/` with descriptive names (`hero-stage-wide.webp`, not `images (1).jpeg`), and record each one in the table in A-section format.

### Candidate placements

| Placement | Size / aspect | Asset type | Notes |
|---|---|---|---|
| Login panel (md+) | 50vw × 100dvh, portrait ≈ 2:3; export 1440×2160 | Portrait choir/conductor photo | Stage overlay; logo top-left, quote bottom-left |
| Login band (mobile) | 100vw × 144px ≈ 2.7:1; export 1170×420 | Same photo, different crop (`object-position` per breakpoint) or no photo, just stage + staff | Keep it light on bytes; this is the first page on 4G |
| Home hero | ≈ 3.5:1 mobile 358×~260 (content-driven), desktop 944×~170; export 2000×560 | Wide stage shot | Very strong overlay: buttons and date must stay legible in every hero state |
| Empty states | 160×120 illustration area | Detail photo in a circle/rounded-2xl, duotone | Repertoire: piano/score; Members: choir silhouette; Attendance: empty stage |
| PWA icon | 512, 192, maskable 512 (safe zone = central 80% circle), Apple 180 | Monogram "A" | White mark on `--stage`; no transparency on Apple icon |
| Favicon | `favicon.svg` + 32px PNG + `favicon.ico` 16/32 | Monogram "A" (3-line at 32, solid at 16) | SVG can switch colour via `prefers-color-scheme` inside the SVG |
| Splash / manifest | `background_color` = dark `--background`, `theme_color` per theme | — | iOS startup images optional; skip in v1 |
| Announcement card (future) | 1080×1350 share image | DUYURU template | Rebuild in HTML/CSS with tokens, not as an image |

---

## Part C: processing rules

**Photos always sit on a stage surface.** `--stage` is dark in both themes, so one processing pipeline serves light and dark. Don't put photos directly on ivory `--background`.

1. **Crop** to the placement aspect, focal point on faces/conductor; strip third-party branding. Use `object-cover` + `object-position` per breakpoint rather than shipping two files when the aspect difference is small.
2. **Duotone (optional, recommended for backgrounds):** map shadows → `--stage` dark value, highlights → `--stage-foreground`. Makes photos of different venues look like one set. Do it at export time (sharp: `.grayscale().tint(...)` or in Photopea/GIMP), not with CSS filters at runtime.
3. **Overlay for text contrast** (CSS, so it follows tokens):
   - Hero / login: `bg-[linear-gradient(to_top,color-mix(in_oklch,var(--stage)_92%,transparent)_0%,color-mix(in_oklch,var(--stage)_70%,transparent)_55%,color-mix(in_oklch,var(--stage)_45%,transparent)_100%)]` on top of the image (move to a utility class `.stage-scrim`).
   - Target: **≥ 4.5:1** for body/eyebrow text and **≥ 3:1** for text ≥ 24px against the *lightest* pixel under the text box. Check by sampling the processed screenshot, not by eye.
   - Optional `backdrop-blur-sm` under small text on busy photos (the piano keys in A3 are high-contrast stripes).
4. **Blur** detail photos used purely as texture: 8–16px at export.
5. **Export:** WebP (quality 72–78) + `next/image` with `sizes`; budget ≤ 120 KB for mobile hero, ≤ 250 KB for the desktop login panel. Provide `placeholder="blur"`.
6. **Dark/light check:** screenshot each placement at 390px and 1440px in both themes (same headless method as the review). The stage surface differs (`0.28` light vs `0.22` dark), so verify the scrim in both.
7. **Logo on photo:** only on a scrim with the area under the logo at L ≤ 0.35; use the white (stage-foreground) version.
8. **Accessibility:** decorative photos `alt=""`; meaningful ones get Turkish alt text (`Arkhe korosu Çanakkale'de sahnede`).

### Free tools only
sharp (Node, already a Next.js optional dependency) for resize/duotone/WebP, potrace for vectorising the logo, Squoosh for manual compression, RealFaviconGenerator (free) or a sharp script for the icon set.
