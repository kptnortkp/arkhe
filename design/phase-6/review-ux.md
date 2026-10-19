# Phase 6 UX review

Author: UX designer. Date: 2026-10-19. Reads: `po-spec.md`, `po-decisions.md`, `implementation-notes.md`, my `ux.md`.

**Method.** I used real Chrome (playwright-core, `channel: "chrome"`) against the dev server at http://127.0.0.1:3100, logged in as korist@, yk@ and sef@. I checked light and dark at 375×812 (DPR 2) and at 1280×900 (DPR 1 and 2), plus 320 px for the offline page. I created no data and changed nothing in the DB. Screenshots are in `/private/tmp/claude-501/-Users-merttemiz-Desktop-development-arkhe/dca171a5-e8a3-44ae-a38e-26b2f08eb84b/scratchpad/review-ux/`. The upscaled crops start with `z-`.

**Result: 0 P1, 3 P2, 7 P3,** plus one environment note (E1, now resolved).

---

## E1. The dev server is serving a stale `globals.css` (fix before PO screenshots and the next e2e run)

The stylesheet served by the running dev server (`/_next/static/chunks/[root-of-the-server]__1iq1fpentixw4._.css`, 140 kB) does **not** contain `--present-foreground`, `--excused-foreground`, `--absent-foreground` or `.staff-lines`.
- `getComputedStyle(:root).getPropertyValue("--present-foreground")` returns `""`.
- As a result, `text-*-foreground` falls back to the inherited colour. Selected `Geldi`/`Gelmedi` chips show **dark text in light mode and light text in dark mode**, the reverse of the intent (`roster-light.png`, `roster-dark.png`).

The production build is correct. `.next/static/chunks/057qoon_4_epz.css` (16:30) has all three tokens and the new `.staff-lines`. When I injected that CSS into the dev page, the chips rendered as specified (`roster-prodcss-top-dark.png`).

This is the Turbopack staleness already recorded in the WP6–8 notes (`globals.css` was last edited at 16:06). It is not a code change.

**Resolved:** the tech lead restarted the dev server. I re-measured the live server afterwards (no injected CSS):
- `--present-foreground` resolves.
- Light chips have near-white text; dark chips have `--background` text.
- The contrast figures are identical to the production-CSS run below (`roster-live-top-*.png`).

The staff screenshots were also retaken on the restarted server.

---

## Gates

| AC | Verdict | Evidence |
|---|---|---|
| 1 Fidelity | **Pass** | UI's overlay `scratchpad/wp6/overlay-wordmark.png`: IoU 0.951, max edge deviation 2 px. Hairline counts in my 3× crop of the 256 px login panel (`z-giris-d-light.png`): 3 hairlines / 4 bands per stroke, 4 / 5 on the A left leg. The flat A top, the closed band ends and the E bottom-arm end hairline are all present. The R bowl hairlines stop at the leg. At Jost 600 the subtitle stems are not heavier than the JPEG, so no step down to 500. |
| 2 Components | Pass | One `<svg role="img" fill="currentColor">` with one `<path>`. Labels are correct. No hex. |
| 3 Sizes | Pass, with P2-1 | Mobile header 90.6×20 (24 % of 375). Login band 192 px. Login panel 256 px. Sidebar 176×52.6. Same in light and dark. |
| 4 Staff motif | Pass as drawn, P2-2 for placement | 5 lines of 1 px on a 4 px pitch. No moiré at 1× (`z-staff-light-1x.png`). Reads as a stave at 2× on card and on stage (`staff-light-2x.png`, `staff-dark-2x.png`). |
| 6 Eyebrows | Pass | `SIRADAKİ ÇALIŞMA`, `DÖNEMLER`, `ÖDEMELER`, `SOPRANO · 1/7` all at 0.2em. |
| 7 Icons | Pass, with P3-4 | `icon-512`, `maskable-512`, `icon-192` and `apple-icon` are crisp. The maskable A sits well inside the safe circle. The ICO has a solid 16 frame and a 2-band 32 frame. `icon.svg` drops the tile in dark (`z-tabicons-*.png`). |
| 12 Install card | Pass, with P3-1/P3-2 | All four states render with the exact D12 copy, directly above `Aidatım`, in both themes (`install-*.png`). The button is 44 px. |
| 16 Offline page | Pass | Copy is exact. System sans. Light and dark. No horizontal scroll at 375 or 320. The 48 px button uses gold in dark. Footer stave plus tracked line (`offline-*.png`). |
| 30 Son değişiklik | Pass | `Son değişiklik: Demo Yönetim · 19 Eki 2026` appears under the rate hint (Ece Demir) and under the waiver reason, above `Muafiyeti kaldır` (Deniz Aslan). The `History` icon is muted, and the line sits on one row at 375 (`fin-sheet-ece-dlg-light.png`, `fin-waiver-dark.png`). |
| 36 Polish | Pass, with P2-3/P3-3 | Dues rows are titled by name (`Elif Yıldız` / `Aidat · Ekim 2026`). The checked chip shows its `Check` icon. The sticky bar meets the tab bar with no gap (`fin-yeni-dark.png`). The disabled trash is dimmed. With the production CSS, dark solid chips have dark text at 6.2–8.96:1. |

---

## P2

### P2-1. The sidebar lockup is noise at 1× DPR (the ~3.7 px subtitle)
**Where:** `src/app/(portal)/layout.tsx:29`, `<ArkheLockup className="w-44" />`.

**What I see:**
- At 1× (most external monitors and many Windows laptops used by the şef and the board), the subtitle cap is 3.7 px and reads as dotted grey (`z-sidebar1x-light.png`, `z-sidebar1x-dark.png`).
- The 0.4 cuts become 0.2 px, which turns the A and K diagonals into a herringbone alias pattern.
- At 2× it is clean and legible (`z-sidebar2x-dark.png`).
- The sidebar can't make the lockup wider: `w-64` minus `px-4` minus the link's `px-3` leaves at most 200 px, which is still only a 4.2 px cap.

**Fix:** pick the form by pixel density, CSS only, both rendered.
```tsx
<Link href="/" className="px-3" aria-label="Ana sayfa">
  <ArkheWordmark density="small" className="h-auto w-44 [@media(min-resolution:2dppx)]:hidden" />
  <ArkheLockup className="hidden w-44 [@media(min-resolution:2dppx)]:block" />
</Link>
```
- This applies the existing rule "below a legible subtitle, use the wordmark" to 1× screens.
- The hidden one is `display:none`, so assistive tech announces one image.
- e2e: the AC 3 sidebar assertion (`phase6-a-brand.mjs`, `svg[role=img]` with the lockup label ≥ 160 px at 1280) must run with `deviceScaleFactor: 2`, or assert the wordmark at DPR 1.
- My readability floor for the subtitle is a 5 CSS px cap at 1×, which means a lockup at least 240 px wide. Today only the login panel (256 px) meets it.

### P2-2. The staff motif is not visible anywhere in the app
**Where:**
- `.staff-lines` is used only by `src/components/coming-soon.tsx:17`.
- No route renders `ComingSoon`; the implementation notes say this, and I confirmed it with grep.
- So AC 4's motif ships as dead CSS. The gate passed only on injected markup.

**Fix:** add `staff-lines` to the real empty states. They already have `py-12` (48 px bottom padding), so the 17 px stave at `bottom − 28px` clears the content:
- `src/app/(portal)/repertuvar/page.tsx:117` (`Repertuvar henüz boş.`)
- `src/app/(portal)/odevler/page.tsx:98` and `:162` (`Şu an ödev yok.` / `Geçmiş ödev yok.`)
- the other `rounded-2xl border border-dashed bg-card … py-12 text-center` empty states found by `grep -rn "border-dashed" src/app` (calismalar, uyeler, finans/*). Leave alone any dashed element that isn't an empty state, such as `part-button`, `status-chip` and `roster`.

Then delete `coming-soon.tsx`, or keep it, but stop using it as the only carrier. Gate: re-shoot one empty state in both themes at 375.

### P2-3. Light solid `Geldi` / `Mazeretli` chips are below 4.5:1
**Where:** `src/app/globals.css:99`, `:103`. These are used by `STATUS_STYLES.*.solid` in `src/lib/labels.ts:69/81`, which drives the şef's marking roster, the core attendance action.

**Measured** (production CSS, Chrome, `text-xs`): present **3.93**, excused **4.00**, absent 5.03, late 7.5. Dark is fine (6.2–8.96). AC 36 moved this text to tokens, so the background tokens should finish the job.

**Token change:**

| Token | Light (now → proposed) | Dark | Reason |
|---|---|---|---|
| `--present` | `oklch(0.58 0.13 155)` → **`oklch(0.53 0.13 155)`** | unchanged `oklch(0.7 0.13 155)` | 4.83:1 with `--present-foreground` |
| `--excused` | `oklch(0.6 0.1 300)` → **`oklch(0.55 0.11 300)`** | unchanged `oklch(0.72 0.1 300)` | 4.95:1 |

Side effects:
- `--present` also colours dots, progress bars and the `CircleCheck` in `Ödendi` / `Eklendi`. They get slightly deeper and stay clearly green. `--present-ink` is separate and unchanged.
- Gate: re-run the axe check on `/calismalar/<id>` with a marked roster.

---

## P3

1. **Install card tile disappears in dark.**
   - Where: `src/components/install-card.tsx:70–72`. Dark `bg-stage` (`oklch(0.22 0.065 288)`) on dark `bg-card` leaves the A floating with no tile (`install-prompt-dark.png`).
   - Fix: add `dark:ring-1 dark:ring-inset dark:ring-stage-foreground/10` to the tile span. This matches the offline page's dark tile border (`rgb(255 255 255 / 9%)`).
2. **Straight quotes in Turkish copy.**
   - Where: `src/components/install-card.tsx:90, 95`. The app uses typographic quotes elsewhere (`“sınavım var”`).
   - Fix, with copy:
     - `Safari'de Paylaş [icon] simgesine, sonra “Ana Ekrana Ekle”ye dokun.`
     - `Tarayıcı menüsünden “Ana ekrana ekle” ya da “Uygulamayı yükle”yi seç.`
     - Use `&ldquo;`/`&rdquo;` and update the matching strings in `e2e/phase6-a-brand.mjs`. The apostrophes in `Safari'de` and `Arkhe'yi` can become `’` in the same pass.
3. **Disabled period trash gives no feedback on touch.**
   - Where: `src/components/finance/period-forms.tsx:310`. `title` never shows on a phone and the `sr-only` text is for screen readers only. On `/finans/aidat/donemler` all three demo periods are locked, so a board member taps a dimmed trash and nothing happens (`fin-donemler-light.png`).
   - Fix: keep `aria-disabled="true"` and on click call `toast("Ödemesi olan dönem silinemez")` (sonner is already mounted). No dialog opens, so the phase-5 AC17 assertion still holds.
4. **`icon.svg` shimmers at 16 device px.**
   - Where: `src/app/icon.svg`. On 1× desktop tabs Chrome prefers the SVG over the ICO's solid 16 frame, so the 2-band A draws at 16 px and greys out (`z-tabicons-light.png`, first item).
   - Fix (generator, `scripts/brand-assets.ts`): add the solid A path with class `s` and swap it in via `@media (max-width: 24px) and (max-resolution: 1.5dppx) { .m{display:none} .s{display:inline} }`. Media queries inside an SVG image use the image's own viewport. Verify in Chrome at DPR 1 and 2; if `resolution` isn't honoured there, keep today's file.
5. **Offline page favicon request.**
   - Where: `scripts/offline.template.html`.
   - Fix: add `<link rel="icon" href="/icons/icon-192.png">` (precached), so the browser doesn't hit the network for `/favicon.ico` while offline. Then the `watchConsole` exception for `ERR_FAILED /favicon.ico` can be removed.
6. **`Tekrar dene` promises to resume but goes home.**
   - Where: `public/offline.html`. The body says `kaldığın yerden devam edebilirsin`, but the button's `href="/"` drops the user at Ana sayfa. The service worker serves the offline page at the original URL (for example `/repertuvar`), so `href=""` (with no JS) re-requests that same URL.
   - Recommendation for the PO, since AC 16 fixes `→ /`: switch to `href=""`. A direct visit to `/offline.html` would then just reload itself, which is harmless.
7. **Wordmark diagonals alias at 1× on the login panel too (minor).**
   - Where: `src/components/auth-layout.tsx:20`. At 256 px the cut is 0.29 px. The A and K show faint herringbone at 1× (`z-giris-d-light.png`), but they are acceptable there because the strokes are 11 px wide.
   - Optional: give `ArkheLockup` a `density` prop like the other two components and pass `density="small"` here. That needs a `WORDMARK_PATH_SMALL + SUBTITLE_PATH` variant.

---

## Checked and fine (no action)
- Mobile header wordmark (`density="small"`, 20 px). The hairlines read as texture on both backgrounds, and the letter shapes stay intact (`z-header-*.png`).
- The login band lockup on the piano photo reads well in both themes. The subtitle at 192 px is legible at 2×.
- The install card sits directly above `Aidatım` with nothing reserved. The iOS state puts the `Share` icon inline after `Paylaş`. The installed state uses `CircleCheck text-present`.
- On the offline page, the dark tile with its 1 px border, the 12 % footer stave (an accepted deviation) and the system sans heading are all fine.
- `Son değişiklik` uses the muted 12 px text with the icon top-aligned. It is not shown on korist's `Aidatım` (covered by e2e).
- Hareketler dues rows are titled by member name. The `Toplu oluştur` preview reads `· son ödeme 15 Kas`. The sticky entry bar has no gap above the tab bar.
