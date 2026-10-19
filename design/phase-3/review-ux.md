# Phase 3 UX review: repertoire and Drive links

Author: arkhe-ux-designer. Checked against `ux.md` and `po-decisions.md` (which wins).

Screens checked at 390px (mobile context, DPR 2) and 1280px, light and dark: home (korist, yk, sef), `/repertuvar` (default, `tumu`, `program`, search hit, search miss), `Program` + `Sırayı düzenle` (yk), detail `Ave Verum Corpus` (korist: default, `?partisyon=tumu` with a preview open, `?partisyon=bas`), `Hallelujah` (korist, disabled part), `Bogoroditse Devo` (yk: chooser sheet, `...` menu), `/repertuvar/yeni` (empty + submit errors), `/duzenle#baglantilar`, bulk preview with 7 lines (incl. one invalid, one YouTube, one folder). No horizontal scroll on any screen in either theme. No data was created.

Overall: the core flows hold. `Partisyonum` is one tap from the list, home and detail; the chooser sheet, disabled state, filter chips, programme numbering/total, preview (one at a time, fallback line) and confirms all match the decisions. Findings below are about readability and two flow gaps.

## P1

None.

## P2

**P2-1. Derived link labels truncate exactly where the part name is.** `src/components/repertoire/link-row.tsx:69` (`truncate`). At 390px, with `Önizle` + `Aç` on the row, the text column is ~150px, so `Partisyon kaydı · Alto` renders as `Partisyon kay…`. Under `Tümü` the `Partisyon kayıtları` group is four identical `Partisyon kay…` rows; the part only survives in the small grey line 2. That is the main thing a singer reads on this page.
Fix: inside a kind group the kind is already the section heading, so when `label` is empty the detail row shows the **part only** as its title: `Alto`, `Soprano`, `Tutti` (rule: derived title on the detail page = part name, `Tutti` for null). Line 2 then drops the part text when the title is derived and shows `PartDot` + host only. Also change `truncate` to `line-clamp-2 break-words` so custom labels like `Soprano 1 (yavaş tempo)` don't lose their tail. The edit list (`links-editor.tsx:242`) keeps the full derived label (`Partisyon kaydı · Alto`): no `Önizle` there, so it fits.

**P2-2. `#baglantilar` lands with the heading hidden under the sticky top bar.** `src/components/repertoire/links-editor.tsx:216` uses `scroll-mt-6` (24px) but the mobile header is ~57px. After create (D14) or `Bağlantı ekle` from the detail page, the screen opens on the first link row; the focused `Bağlantılar 7` heading is behind the header, so the user doesn't see where they are.
Fix: `scroll-mt-20 md:scroll-mt-6` on the section (and on any other in-page anchor target under the shell header).

**P2-3. Edit-page `Arşivle` skips the programme confirm (D15/D16, AC17).** `src/components/repertoire/danger-zone.tsx:23,36` and the `Arşivle` action inside the delete confirm (`:57-66`) archive directly. For a programme piece this silently removes it from the concert programme, which the detail menu (`piece-menu.tsx:100`) correctly guards.
Fix: pass `inProgram` from `duzenle/page.tsx` (`piece.programPosition !== null`) into `DangerZone`; when true, both `Arşivle` buttons open the same confirm as the menu: title `"{title}" arşivlensin mi?`, description `Arşivlenen eser programdan da çıkar. Bağlantıları korunur.`, buttons `Vazgeç` / `Arşivle`. (In the delete dialog, choosing `Arşivle` can just swap to that confirm.)

**P2-4. Bulk preview rows with no label show an empty input.** `src/components/repertoire/bulk-paste.tsx:215` and `:291`. The YouTube and folder lines produce a valid row (`Geçerli`) whose `Etiket` field is blank, which reads as "something failed to parse".
Fix: `placeholder={deriveLabel(r.kind, r.voicePart)}` on both label inputs (`Video · Tutti`, `Drive klasörü` for the folder row), same as the single-link form does.

## P3

**P3-1. Active list chip scrolls out of view at 390px.** `src/app/(portal)/repertuvar/page.tsx:80-93`. With `?liste=tumu` or `arsiv`, the active chip sits off-screen right; on load the user sees five unselected-looking chips. Fix: a tiny client effect `document.querySelector('[aria-current=page]')?.scrollIntoView({ inline: "nearest", block: "nearest" })` on the chip nav, or the `/uyeler` equivalent if one exists.

**P3-2. Bulk `Tür` select truncates `Partisyon kay…`.** `bulk-paste.tsx:222` `grid-cols-2`. Fix: `grid-cols-[3fr_2fr]` (part names are short).

**P3-3. Bulk save count includes the folder line.** `Kaydet (6 bağlantı)` when 5 links + 1 folder are saved. Fix: count only non-folder rows and add the folder as text: `Kaydet (5 bağlantı + klasör)`.

**P3-4. Two gold pills stacked in dark mode on the detail page.** The primary `Partisyonumu aç (Alto)` and the active `Benim partisyonum (Alto)` chip are both `bg-primary` gold and the same height region; the filter competes with the main action. Fix: active `FilterChip` on the detail page only uses `border-primary bg-primary/15 text-foreground` (both themes), or keep as is and accept; no new token.

**P3-5. Desktop list is full content width.** `repertuvar/page.tsx:52` has no `max-w-3xl` (ux §2.5); at 1280px the chevron/`Partisyonum` sits ~900px from the title. Fix: `mx-auto max-w-3xl` on the wrapper, matching the detail page.

**P3-6. Two empty messages at once.** `repertuvar/[id]/page.tsx:156` and `:166`: when a filter hides everything and part links exist, both `Bu partisyon için bağlantı yok.` and the `Partisyon kayıtları` block `Alto için kayıt yok.` render. Fix: render the page-level message only when `!hiddenParts`.

**P3-7. Redundant meta lines.** Edit list line 2 repeats the derived title (`Nota · Tutti` / `Nota · ○ Tutti · Drive`). Fix: when the label is derived, line 2 is host only. Detail: covered by P2-1.

**P3-8. Back link on `/duzenle` goes to the list.** After editing, managers want the piece. Fix: on `duzenle` render `← {title}` linking to `/repertuvar/[id]` (copy: the piece title, `truncate max-w-[16rem]`); keep the list memory for detail and `yeni`.

**P3-9. Empty `<p>` in the empty-repertoire state for managers** (`repertuvar/page.tsx:122-124`). Render the line only for members.

**P3-10. Home rows keep `min-h-[76px]` without meta chips** (`piece-row.tsx:25`); ux §7 says `min-h-16`. Fix: `showMeta ? "min-h-[76px]" : "min-h-16"`.
