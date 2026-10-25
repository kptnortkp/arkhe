# UI polish pass: plan

Author: UI/UX. Date: 2026-10-24. Budget: about 1 hour of implementation (the whole pass is 2 h).

Audit: dev server, korist@ (Alto) and sef@, 375 px light and dark, plus 1280 px for korist light and sef dark. Screenshots are in `/private/tmp/claude-501/-Users-merttemiz-Desktop-development-arkhe/19dc8566-2241-43ab-81a6-90a3f5107959/scratchpad/shots/polish-*.png`, named `polish-<role>-<m|desk>-<scheme>-<screen>.png`. The Phase 11 states are `polish-p11-*.png`, seeded with `p11shots.mjs` after the Phase 11 review fixes landed.

Overall the app is in good shape. Tokens are used throughout, both themes hold contrast (no dark-mode contrast failures found), the bottom bar works, and every tap target I measured is at least 44 px. The items below fix one real layout bug, cut scrolling where managers spend the most time, and make the primary action on each korist screen unambiguous.

Constraints for every item: no new dependencies, no schema, server or auth changes, tokens from `src/app/globals.css` only, and no visible label changes unless the item says so. The **Tests** line lists every e2e text or selector an item touches.

---

## Main pass (do in this order)

### 1. P1 · Attendance marking: labels collide at 375 px · S
- **Screen:** `/calismalar/[id]` as a manager, the roster row of anyone already marked (the eraser button is shown). See `polish-sef-m-light-calismalar_detail.png`, Demo Korist row: "Mazeretli" runs into the "×" of "Gelmedi".
- **Cause:** `src/components/attendance/marking-roster.tsx:452-462`. Four `grid-cols-4` buttons (icon + label, `px-2 gap-1.5`) plus the 44 px eraser don't fit in about 300 px.
- **Change:** below `sm`, stack the icon above the label. Button classes become `inline-flex h-12 min-w-11 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[11px] leading-none sm:h-11 sm:flex-row sm:gap-1.5 sm:px-2.5 sm:text-sm`, and add `min-w-0` to the radiogroup. The label `<span>` keeps its current visibility rules. Check this at 375 px with the eraser visible.
- **Tests:** none. Roles, `aria-label`s and texts are unchanged.

### 2. P1 · Attendance roster: each member takes 125 px · S
- **Screen:** same page. Each row stacks avatar / name / segment, so 26 members come to about 3,300 px of scrolling during a live rehearsal (`polish-sef-m-light-calismalar_detail.png`, 9,616 px tall at 2x).
- **Change:** `marking-roster.tsx:359-361`. Replace the `<li>` classes with `grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex sm:min-h-16 sm:flex-row sm:gap-3 sm:py-2`, and put `col-span-2` on the segment wrapper (`:390`, `flex w-full ...`). The avatar and name now share a line, which saves about 44 px per member, or roughly 1,100 px over the roster. Desktop is unchanged.
- **Tests:** none. `data-testid="roster-row"` stays on the `<li>`.

### 3. P2 · Homework detail: two equal primary buttons · S
- **Screen:** `/odevler/[id]` as korist, when the piece has no MIDI. Step 1 "Partisyonumu aç (Alto)" and step 2 "Kayda başla" are both filled `bg-primary` (gold in dark), so the eye has no single target (`polish-korist-m-light-odevler_detail.png`, `polish-korist-m-dark-odevler_detail.png`). The goal of the screen is recording.
- **Change:** `src/components/repertoire/part-button.tsx`: add a prop `quiet?: boolean`. When `hero && quiet`, use `variant: "outline"` instead of `"default"`, with the same size classes. Pass `quiet` from `src/app/(portal)/odevler/[id]/page.tsx:117-124`. The piece page hero keeps the filled button.
- **Tests:** none. The link name `Partisyonumu aç (Alto)` is unchanged (`phase4-homework.mjs:220`, `phase9-d-midi.mjs`).

### 4. P2 · Home hero: "Gelemeyeceğim" reads as a label, not a button · S
- **Screen:** home `/`, next rehearsal before check-in opens (`polish-korist-desk-light-home.png`: white text with no outline on stage, next to the muted "Yoklama çalışmadan önce açılacak."). Excusing yourself is a core member action.
- **Change:** `src/components/attendance/check-in-panel.tsx:191-198`. When `onStage`, use `variant="outline"` with `h-11 rounded-full border-stage-foreground/40 bg-transparent px-5 text-stage-foreground hover:bg-stage-foreground/10 hover:text-stage-foreground`, replacing the raw `hover:bg-white/10`. Off stage (the rehearsal detail page), use `variant="outline"` with the default tokens. Check the result in both themes: the stage is dark in both.
- **Tests:** none. The button name `Gelemeyeceğim` is unchanged (`phase2-attendance.mjs:95,109,128`).

### 5. P2 · Piece page: an empty "bağlantı" box shown to korists · S
- **Screen:** `/repertuvar/[id]` as korist for a piece with no links (`polish-p11-piece-390-light.png`). A large dashed `staff-lines` box says "Bu esere henüz bağlantı eklenmedi." It gives the member nothing to do, and at 390 px the staff lines look like stray stripes at the bottom.
- **Change:** `src/app/(portal)/repertuvar/[id]/page.tsx:210-220`: render that box only when `manager`. Members see nothing there.
- **Tests:** none (no e2e uses that text).

### 6. P2 · "Partisyonum" buttons in lists look different from each other · S
- **Screen:** home "Çalışılan eserler" and `/repertuvar` (`polish-korist-m-light-home-1`, `polish-korist-m-light-repertuvar`). The Drive variant squeezes a part dot, the label and a ↗ into 116 px. The dot is hollow for Tutti and orange for Alto, so it reads like a radio button. The MIDI variant shows ▷. The empty variant "Partisyon kaydı yok" wraps to two lines in a dashed pill.
- **Change:** `src/components/repertoire/part-button.tsx`:
  - Remove `{!hero && !asLink && dot}` (`:62`). The member's part is already in the header chip.
  - Empty list variant (`:50`): show `Kayıt yok` on one line (`whitespace-nowrap`) and add `aria-label="Partisyon kaydı yok"`, so the accessible name stays the same. The hero text `Alto için partisyon kaydı yok` stays as it is.
- **Tests:** `phase3-repertoire.mjs:214` uses `getByRole(..., { name: "Partisyon kaydı yok" })` and still passes through the `aria-label`. `phase3-repertoire.mjs:378` counts `text=Partisyon kaydı yok` === 0 for sef and still passes. If the implementer prefers zero risk, skip the copy change and keep only the dot removal.

### 7. P3 · Back links are inconsistent between detail pages · S
- **Screen:** `/calismalar/[id]` uses `ChevronLeft` with `-my-2 gap-1`, while `/odevler/[id]` and `/repertuvar/[id]` use `ArrowLeft` with `-ml-1 gap-1.5 px-1`. The vertical spacing above the title differs too (`polish-korist-m-light-calismalar_detail` vs `...odevler_detail`).
- **Change:** `src/app/(portal)/calismalar/[id]/page.tsx:64-71`: use `ArrowLeft className="size-4"` and the classes from `src/components/repertoire/back-link.tsx:31` (`-ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-muted-foreground hover:text-foreground`). The manager-only pages that use `ChevronLeft` (`uyeler/[id]`, `yedek`, `ice-aktar`, …) are left for later.
- **Tests:** none. The link text `Çalışmalar` is unchanged.

### 8. P3 · Push prompt on desktop: two stretched pills · S
- **Screen:** home at 1280 px (`polish-korist-desk-light-home.png`). "Bildirimleri aç" and "Şimdi değil" are each about 450 px wide.
- **Change:** `src/components/notifications/push-nudge.tsx:91,99,103`: `flex-1 sm:flex-none sm:px-6` on all three buttons. Mobile keeps the full-width pair.
- **Tests:** none.

---

## Phase 11 screens (apply after the Phase 11 fixes land)

These items don't repeat anything in `design/phase-11/review.md` or `review-fixes.md`.

### 9. P2 · Piece page says "no part recording" right above a MIDI that contains the part · S
- **Screen:** `/repertuvar/[id]` as korist (Alto), for a piece with a published automatic MIDI and no Alto file (`polish-p11-piece-390-light.png`). The hero pill "Alto için partisyon kaydı yok" sits right above `Otomatik oluşturulan · 4 ses + piyano · Çal`, which includes Alto (the `Alto önde` preset).
- **Change, UI only (no change to `heroMidi`):**
  - In `src/app/(portal)/repertuvar/[id]/page.tsx:151`, when `!hero` and `midiRows` holds a published `auto` row, render this instead of the disabled `PartButton`: `<a href="#otomatik" className={cn(buttonVariants({variant:"outline"}), "h-12 w-full rounded-2xl md:w-auto")}>Otomatik MIDI'de Alto sesini dinle ↓</a>`, with `{partName}` filled in.
  - Add `id="otomatik"` and `scroll-mt-20` to the section in `src/components/midi/midi-list.tsx:84`.
- **Tests:** check `e2e/phase11-c-player.mjs` and `phase11-a-score.mjs` for assertions on `için partisyon kaydı yok`. Pieces without an automatic file keep the old pill, so `phase3-repertoire.mjs` is unaffected.

### 10. P2 · Piece editor is about 8,700 px tall and the score/MIDI section is last · S
- **Screen:** `/repertuvar/[id]/duzenle` as sef (`polish-p11-editor-draft-390-light.png`). To reach `Nota ve otomatik MIDI` (upload PDF, MIDI'ye çevir, draft), the conductor scrolls past the whole metadata form and the links editor.
- **Change:** under the `h1` in `src/app/(portal)/repertuvar/[id]/duzenle/page.tsx:39`, add a row of in-page jump links using the `FilterChip` look (`src/components/filter-chip.tsx`) or plain `rounded-full border px-4 h-11 text-sm` links: `Bilgiler` → `#bilgiler` (add the id to the form wrapper), `Bağlantılar` → `#baglantilar`, `Nota ve MIDI` → `#nota-ve-midi`. Add `scroll-mt-20` to the targets so the header doesn't cover them. Don't change the order of the sections.
- **Tests:** none. These are new links whose texts don't clash with existing ones; `Bağlantılar` is also an `h2`, so tests using `getByRole("heading")` are unaffected.

### 11. P3 · MIDI file titles truncate at 390 px · S
- **Screen:** the editor's manual list: "Soprano partisyon…" (`polish-p11-editor-draft-390-light.png`). Also the piece page list.
- **Change:** `src/components/midi/midi-editor.tsx:238` and `src/components/midi/midi-list.tsx:69`: `block truncate` → `block line-clamp-2 break-words`.
- **Tests:** none.

---

## Later (not in this pass)
- Fold the succeeded status into the draft card: `Taslak hazır` (`OmrStatus`) and the `Taslak · otomatik çeviri` card say the same thing next to each other (`ed-b` crop of `polish-p11-editor-draft-390-light.png`). Merging them would touch the review-fix e2e "review P2-3", so leave it.
- Unify the remaining `ChevronLeft` back links on manager pages (about 10 files) with a shared `BackLink href label` component.
- `/profil`: the disabled `Deneme bildirimi gönder` takes up a whole row before notifications are on. AC18 e2e (`phase10-c-ui.mjs:175-180`) asserts the disabled state, so it needs a spec change first.
- `/calismalar` list: a `Yoklamaya katıl` button right on the row when check-in is open, which saves the tap into the detail page. The home hero already covers the main case.

---

## Frontend notes
- **Item 9 skipped (obsolete after the Phase 11 fixes).** `heroMidi` now returns the published automatic file whenever one of its tracks carries the member's part, so the hero is already `Partisyonumu çal (Alto)` with `Alto önde`. The audit screenshot came from seed data whose tracks had `parts: []`. The only remaining `!hero && auto` case is an automatic file *without* my part, where `Otomatik MIDI'de Alto sesini dinle ↓` would be false, so the pill `Alto için partisyon kaydı yok` stays.
- **Item 10:** the editor now has four targets, so the jump row is `Bilgiler` · `Bağlantılar` · `Nota ve MIDI` · `MIDI dosyaları` (`#midi-dosyalari`, the manual list). At 375 px the fourth chip peeks and the row scrolls sideways, the same pattern as the piece page's part filter.
- **Item 11:** `block line-clamp-2` does not clamp because `block` overrides the `display: -webkit-box` that `line-clamp` needs; implemented as `line-clamp-2 break-words` (the span still sits on its own line).
- **Item 6:** the list variant no longer renders a dot, so `PartChooser` gets `dot={null}`; its `dot` prop is left in place for now.
