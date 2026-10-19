# Phase 0 design review

Reviewed 2026-10-17 against the running preview (http://127.0.0.1:3100). Screens: `/`, `/giris`, `/yoklama`, `/repertuvar`, `/uyeler` at 390px (iframe) and 1440px, light and dark. Screenshots are in the session scratchpad (`ux/*-m-light.png`, `*-d-dark.png`, …), not in the repo.

Overall: the direction works. Ivory + concert-hall indigo + gold reads as "choir", not "SaaS", and both themes hold together. The mobile shell (sticky header, 4-tab bottom bar, `pb-28` clearance) is right. The real problems are a few broken tokens/textures, contrast on the voice-part chips, and a check-in hero that shows an action that won't be valid most of the week.

Priority key: **P1** fix before/with Phase 1, **P2** fix during Phase 1, **P3** polish.

---

## P1

### 0. Logo doesn't match the real brand (found after `brand/` arrived)
The official mark is an uppercase geometric **ARKHE** whose strokes are five parallel lines, with **MÜLKİYE ÇOKSESLİ KOROSU** in tracked caps. The app's `Logo` (lowercase Fraunces `arkhe` + gold dot) and `LogoMark` (`α`) are placeholders and should be replaced with the official SVG as soon as a vector is available. Full analysis and token proposals are in `brand-integration.md` (Part A).

### 1. The "Geldim" hero needs states (home, `src/app/(portal)/page.tsx`)
Today the hero always shows `Geldim` + `Gelemeyeceğim`, four days before the rehearsal. Check-in is only valid while a manager has the window open (`rehearsals.openedAt` set, `closedAt` null), so for ~99% of the week the primary button would do nothing or error. The `QrCode` icon also implies the button scans something, which a web page can't do reliably (no `BarcodeDetector` on iOS Safari).

Is "Geldim" the right primary action? **Yes, but only in the open state.** Otherwise, the hero is information (when/where) and the only action is excusing yourself. Spec (one `RehearsalHero` component, state derived on the server):

| State | Condition | Eyebrow | Body | Actions |
|---|---|---|---|---|
| `none` | no future rehearsal | `PLANLI ÇALIŞMA YOK` | "Yeni çalışma eklendiğinde burada görünecek." | none (managers: ghost `Çalışma ekle` once Phase 2 ships) |
| `upcoming` | starts on a later day | `SIRADAKİ ÇALIŞMA` | date (h2) + relative chip `4 gün sonra` / `Yarın` + time + place | `Gelemeyeceğim` only, as an outline button on stage: `border-stage-foreground/25 text-stage-foreground hover:bg-white/10 h-11 rounded-full` |
| `today` | same day, window not open | `BUGÜN` | time + place + line with `Clock` icon: "Yoklama şef başlatınca açılacak." | `Gelemeyeceğim` (outline, as above) |
| `open` | `openedAt` set, `closedAt` null, no record | `YOKLAMA AÇIK` with a 6px `bg-gold` pulsing dot (`animate-pulse`) | "Şefin ekranındaki 4 haneli kodu gir ya da QR'ı telefon kamerasıyla okut." | **Primary**: full-width on mobile `Geldim` `h-14 rounded-2xl bg-gold text-gold-foreground text-base font-semibold`, icon `Check` (not `QrCode`). Opens the code sheet (below). No secondary button. |
| `checked_in` | record `present` | `YOKLAMAYA KATILDIN` | big `CircleCheck` in `text-success` (dark) / on stage use `text-gold`; "Saat 19:34'te kaydedildi." | none. Footnote `text-stage-foreground/60 text-xs`: "Bir yanlışlık varsa şefe ya da yönetime söyle." |
| `excused` | record `excused` | `MAZERETİN İLETİLDİ` | note excerpt in quotes, 1 line `line-clamp-1` | ghost `Mazereti geri al` (only until `startsAt`) |
| `closed_absent` | `closedAt` set, no `present` | `YOKLAMA KAPANDI` | "Bu çalışmada yok olarak görünüyorsun. Geldiysen yönetime bildir." | none |

Code sheet (`open` state): `Sheet side="bottom"` on mobile, `Dialog` from `md`. Title "Kodu gir", 4 single-digit boxes (`npx shadcn@latest add input-otp`), `inputMode="numeric" autoComplete="one-time-code"`, auto-submit on the 4th digit. Errors inline under the boxes in `text-destructive`: "Kod hatalı ya da yenilendi. Ekrandaki yeni kodu gir." Success closes the sheet, the hero flips to `checked_in`, toast "Geldin olarak kaydedildi." The QR path (camera → `/yoklama/q/...` link) lands on a page that shows the same `checked_in` state at full screen.

Phase 1 has no attendance yet: render only `upcoming`/`none` with mock data, or hide the actions until Phase 2.

### 2. Raw colour in the Geldim button
`text-[oklch(0.22_0.03_275)]` breaks the "no raw colours" rule. Add a token:

| Token | Light | Dark | Reason |
|---|---|---|---|
| `--gold-foreground` (+ `--color-gold-foreground` in `@theme`) | `oklch(0.22 0.03 275)` | `oklch(0.2 0.03 275)` | Text on gold. Contrast ≈ 8.0 / 9.2. |

Use `bg-gold text-gold-foreground hover:bg-gold/90`.

### 3. Voice-part chip text fails contrast
`VoicePartBadge` uses the saturated part colour as 12px text on its own 12% tint. Measured on `--card`:

| Part | Light | Dark |
|---|---|---|
| Soprano | 3.5 | 4.0 |
| Alto | **2.7** | 4.2 |
| Tenor | 3.6 | 4.2 |
| Bass | 5.4 | 3.9 |

AA for this size is 4.5. Keep the current tokens for dots and bars (they're fine as non-text, ≥3:1 except alto in light at 2.9; acceptable for a bar with a numeric label next to it). Add **ink** tokens for text:

| Token | Light | Dark | Contrast on tint (light/dark) |
|---|---|---|---|
| `--soprano-ink` | `oklch(0.5 0.16 5)` | `oklch(0.84 0.09 5)` | 5.9 / 6.2 |
| `--alto-ink` | `oklch(0.5 0.11 55)` | `oklch(0.86 0.1 70)` | 5.5 / 5.5 |
| `--tenor-ink` | `oklch(0.47 0.09 195)` | `oklch(0.85 0.08 190)` | 5.7 / 6.5 |
| `--bass-ink` | `oklch(0.45 0.14 265)` | `oklch(0.84 0.08 265)` | 6.7 / 6.5 |

Register as `--color-soprano-ink` etc. and change `VOICE_PART_STYLES[*].text` to `text-soprano-ink` etc. Same idea for `--success` when used as text: light `oklch(0.58 0.13 155)` is 3.95 on card; if it's ever text, use a `--success-ink` of `oklch(0.5 0.13 155)` (5.5).

### 4. No way to reach profile or log out
Avatar in the mobile header and the user block at the bottom of the sidebar are not interactive. Phase 1 adds logout and profile, so both must become a `DropdownMenu` trigger (min 44×44 tap area; wrap the avatar in a `button` with `p-1.5 -m-1.5 rounded-full`). Items: `Profilim` (→ `/profil`), separator, `Çıkış yap` (`LogOut` icon). See `phase1-screens.md` §6.

---

## P2

### 5. Staff-line texture is invisible in light and too loud in dark
`.staff-lines` mixes `currentColor` at 9%, but `currentColor` resolves to the inherited body text colour, not the element's `text-stage-foreground`. Result, measured on the home hero: light lines are *darker* than the indigo by ~2 RGB steps (invisible); dark lines are ~17 steps lighter and repeat every 84px, so the hero and the whole login panel read as horizontal stripes. On the light `ComingSoon` card the lines run straight through the description text.

Fix in `globals.css`:
- Replace every `color-mix(in oklch, currentColor 9%, transparent)` stop with `var(--staff-line)`, defined as `--staff-line: oklch(0.22 0.03 275 / 6%)` in `:root`, `oklch(0.95 0.01 85 / 6%)` in dark, and a utility `.on-stage { --staff-line: oklch(0.97 0.012 85 / 8%) }` applied to every `bg-stage` surface (both themes).
- Draw **one** stave, not a repeat: `background-repeat: no-repeat; background-size: 100% 37px; background-position: 0 calc(100% - 28px);`. On the login panel, position it behind the quote (`0 calc(100% - 140px)`).
- Remove `staff-lines` from `ComingSoon` (text sits on it). If a texture is wanted there, place a single stave at the bottom edge only.

### 6. Card titles use Fraunces at 14px
`CardTitle` inherits `font-heading`; at `text-sm text-muted-foreground` the serif looks thin and differs from the hero eyebrow. Use one eyebrow style for small section labels everywhere: `font-sans text-xs font-medium tracking-[0.14em] uppercase text-muted-foreground`. Keep Fraunces for h1/h2, the big `%88` and piece titles.

### 7. Home copy and data
- `İyi akşamlar,` is hard-coded. Use Europe/Istanbul hour: 05–11 `Günaydın,`, 12–17 `İyi günler,`, 18–04 `İyi akşamlar,`.
- Hero date has no relative cue. Add a chip after the date: `rounded-full bg-white/10 px-2.5 py-0.5 text-xs` with `Bugün` / `Yarın` / `4 gün sonra`.
- "Geçen haftanın katılımı" → add the date: `14 Ekim çalışması · katılım`. If there was no rehearsal last week the card shows the last one.
- Piece cards repeat the user's `Bas` chip on every card, which says nothing. Replace the chip + `5 dosya` row with what the member actually needs: `Bas midi · Nota · Kayıt` as small file-kind chips (only the kinds that exist for their part or tutti). If nothing exists for their part: `text-muted-foreground` "Partisyonuna dosya yok".
- "Tümü" link: 13px text with no padding = ~20px tap height. Add `-my-2 py-2 px-1` and a `ChevronRight` icon.

### 8. Login page (`/giris`)
- Missing "forgot password" route. Copy under the button: `Şifreni mi unuttun? Yönetimden yeni bir link iste.` (no self-service email in a zero-budget setup — see Phase 1 spec).
- "Beni hatırla": plan asks for a long session. Either a `Checkbox` (default on) or always-long sessions — **PO decision**.
- Mobile: the form is vertically centred with the logo glued to the heading (`space-y-2`). Add a compact stage band on top for mobile (`h-36 bg-stage on-stage staff-lines rounded-b-3xl` with the logo at bottom-left) and top-align the form (`pt-8`), so the keyboard doesn't push the button off-screen.
- Desktop quote wraps with an orphan "yer." Add `text-balance`. The quote itself ("Ἀρχή — her şeyin başladığı yer.") is invented — **PO decision** (keep, or replace with a choir motto / founding year once brand material arrives).
- The left panel is 720px of flat indigo. It's the prime spot for a choir photo; see `brand-integration.md`.

### 9. Bass colour collides with primary in light mode
`--bass oklch(0.5 0.14 265)` and `--primary oklch(0.34 0.1 275)` are both indigo; a `Bas` chip looks like a primary/selected chip. Shift bass hue to `250` (more blue, less violet): `--bass oklch(0.52 0.14 250)` light, `oklch(0.72 0.11 250)` dark. Recheck ink tokens after the shift (hue only, contrast barely moves).

---

## P3

10. `SheetContent` and `DialogContent` close buttons read `sr-only "Close"` — change to `Kapat` (UI copy is Turkish).
11. `ComingSoon` shows `Faz 1/2/3`. Fine for the preview; for members use `Yakında`.
12. Remove the `Tasarım önizlemesi · veriler örnek` pill once real data lands.
13. Next.js dev indicator ("N") sits on top of the `Ana sayfa` tab. Dev-only, but it hides the active state while reviewing; `devIndicators: { position: "top-right" }` in `next.config.ts` or ignore.
14. No favicon/manifest yet (`public/` is empty). Placeholder until brand arrives: gold dot on indigo square (same as the logo's dot). See `brand-integration.md`.
15. Dark `themeColor` `#14152a` is lighter/more violet than `--background` in dark (≈ `#0d0f1c`). Match it to the dark background so the iOS status bar blends.
16. Bottom nav labels are `text-[11px]`. Acceptable; don't go smaller. The active pill `bg-primary/10` is clear in both themes.

---

## What is already right (keep)
- Mobile shell: sticky blurred header, bottom tabs with safe-area padding, sidebar from `md`.
- Inputs at `h-11 rounded-xl` and 16px text on mobile (no iOS zoom).
- Muted text contrast is fine: 5.6 (light) / 7.2 (dark).
- Gold-on-indigo hero contrast is strong in both themes; dark mode keeps the hero lighter than the page (`--stage 0.25` on `0.17`), which is the right call.
- Section-turnout bars with numeric labels: colour is not the only carrier of meaning.
