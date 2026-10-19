# Phase 3 — UI engineering review

Author: arkhe-ui-engineer. Reviewed against `ui.md` and `po-decisions.md` (which wins). Code: `src/app/(portal)/repertuvar/**`, `src/components/repertoire/*`, `src/components/filter-chip.tsx`, `src/app/(portal)/page.tsx`, `next.config.ts`.

## How I checked

- Read every file in scope. `npm run lint` and `npm run typecheck` are clean.
- Real Chrome (playwright-core) against the dev server as `sef@`: created a piece titled `E2E UI review`, added/edited/moved/deleted links, ran a bulk paste with a forced server-side duplicate (preview first, then the same URL added through the single form, then `Kaydet`), added the piece to the programme, moved and removed it there, then deleted it through the danger zone. All E2E data was removed afterwards; the seeded programme order is unchanged.
- Screens at 390 px and 1280 px, light and dark: home, list (`Çalışılıyor`, `Program`, search), detail (`Ave Verum Corpus`), edit with an open bulk preview. No horizontal scroll anywhere. No console or hydration errors.
- Confirmed against PO: D2 chips/URLs, D3 search across statuses (no chip `aria-current`, status chip on rows), D4 no `Partisyonum` without a part, D8–D11 iframe attributes and one preview at a time, D14 create → `#baglantilar` with the heading focused, D16 AlertDialog with `Vazgeç` focused, D17 visible text + sr-only suffix, D20 CSP `frame-src`. The bulk `rowErrors` mapping (server index = index among valid rows → `validKeys`) is correct: the duplicate row was marked `Bu bağlantı bu eserde zaten var.`, the count went to `Kaydet (2 bağlantı)` and the next save went through. Resetting the add form by remounting it (`addKey`) works, and focus goes back to the URL field. Invalid adds keep URL and label. Deleting a piece goes to `/repertuvar` with `Eser silindi.` and no 404 flash.

## P1

1. **Keyboard focus is lost after every move (links and programme).** `src/components/repertoire/program-editor.tsx:102,112,121` and `src/components/repertoire/links-editor.tsx:255,265` disable all move buttons while `pending`. The button that was pressed gets disabled (so it loses focus), and the `requestAnimationFrame` focus at `program-editor.tsx:37-47` / `links-editor.tsx:209-212` then calls `.focus()` on a disabled button, which does nothing. Measured: after `Enter` on a move button, `document.activeElement` is `BODY` in both editors, and also after `Programdan çıkar`. A keyboard or switch user has to tab from the top of the page for each step. This breaks ui.md §7 ("focus after a move").
   **Fix:** don't disable on `pending`. The actions take the full order and are idempotent, and the server checks for stale sets, so double taps are safe. Keep only the edge rules (`i === 0`, `i === last`), or use `aria-disabled` + an early return in `move()` while pending. Move the focus code out of rAF into a `useLayoutEffect` keyed on `items`, driven by a `focusAfter = useRef<{ id, dir }>()`. After `Programdan çıkar`, focus the next row's `Programdan çıkar` (or `Bitti` when the list is empty).

## P2

2. **Bulk `Önizle` drops focus and is effectively silent.** `src/components/repertoire/bulk-paste.tsx:128-132,191`. The textarea unmounts, so focus goes to `BODY` (measured). The `role="status"` summary is mounted already holding its text, which most screen readers don't announce. **Fix:** give the summary `tabIndex={-1}` and a ref, and focus it after `setRows` (effect on `rows` going from `null` to an array). Do the same for `Metne dön` → focus `#bulk-text`.
3. **Saving an inline link edit drops focus.** `src/components/repertoire/links-editor.tsx:309`: `onDone={() => setEditing(null)}` unmounts the focused form (measured `BODY`). **Fix:** after `setEditing(null)`, focus `[data-row="{id}"] button[aria-label^="İşlemler"]` in a layout effect. Do the same for `Vazgeç`. Opening `Düzenle` should also put focus in the form: pass `autoFocus` to the edit `LinkForm`.
4. **Targets under 44 px (AC21).** `src/app/(portal)/repertuvar/page.tsx:60` `Eser ekle` is `h-10` (40 px). `src/components/repertoire/program-editor.tsx:55,69` `Bitti` and `Sırayı düzenle` are also `h-10`. **Fix:** `h-11` on all three.
5. **`?partisyon=` filters with no visible chips for users without a part.** `src/app/(portal)/repertuvar/[id]/page.tsx:52-53` applies the URL part, but the chip row at `:124` only renders when `mine` is set. A conductor opening `?partisyon=bas` (the Phase 4 homework links, D5) sees a silently filtered page with no `Tümü` to undo it, unless the page ends up completely empty. **Fix:** render the nav when `mine || filter`; for no-part users show `Tümü` plus the active part chip (skip the `Benim partisyonum` chip).

## P3

6. `router.refresh()` after every action is redundant: `revalidatePath` already sends the fresh RSC payload in the action response, so each tap costs an extra round trip. Files: `src/components/repertoire/program-editor.tsx:27`, `src/components/repertoire/piece-menu.tsx:30`. Drop both calls. DangerZone navigates with `router.push` and doesn't need the refresh either.
7. `getPiece` runs twice per detail request (`generateMetadata` and the page, `src/app/(portal)/repertuvar/[id]/page.tsx:37,44`). Wrap it in React `cache()` in `src/lib/repertoire.ts:109`.
8. Removing a bulk row drops focus (`src/components/repertoire/bulk-paste.tsx:243,330`). Focus the next row's remove button, else the summary.
9. Invalid bulk rows have a remove button on desktop (`bulk-paste.tsx:325`) but none on mobile (`:211-213`). Add the same `Trash2` button to the mobile error card for parity.
10. The bulk form-level `state.error` (`n satırda hata var.`, `bulk-paste.tsx:194`) comes back after `Metne dön` → `Önizle`, because the `useActionState` state is never reset. Track a `previewId` counter and only show `state.error` for the preview it belongs to, or remount the form with `key={previewId}`.
11. At 390 px the mobile kind select truncates to `Partisyon kay…` (`bulk-paste.tsx:222`, `grid-cols-2`). Stack kind and part on very narrow screens (`grid-cols-1 min-[400px]:grid-cols-2`), or accept the truncation since the picker shows the full label.
12. The home `Tümü` link (`src/app/(portal)/page.tsx:247-253`) has an ambiguous accessible name. Add `<span className="sr-only"> çalışılan eserler</span>`.
13. `ListMemory`'s `useEffect` has no deps (`src/components/repertoire/back-link.tsx:11-15`), so it writes sessionStorage on every render. It's harmless, but `[]` plus `useSearchParams` as a dependency is the intent.
