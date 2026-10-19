# Phase 3 — review fixes (tech lead)

Date: 2026-10-18. `npm run lint`, `npm run typecheck` clean; `npm run e2e` see `e2e-results.txt`.

| Finding | Source | Fix |
|---|---|---|
| P1 link label CHECK was 80, app allows 120; long labels 500 and kill a bulk save | dba, backend | `schema.ts` CHECK `between 1 and 120`; new migration `drizzle/0003_phase3_label_length.sql` (rebuilds `piece_links`, applied with `db:migrate`). e2e: 120-char label saved. |
| P1 focus lost after link/programme move and programme remove | ui | Move/remove buttons no longer disabled while pending; `useFocusAfter` (`src/components/repertoire/use-focus-after.ts`) focuses the moved row's button (or the neighbour's remove / `Bitti`) in a layout effect. e2e: focus checks after both moves. |
| P2 `generateMetadata` loaded the piece title without a session | backend | `load()` in `[id]/page.tsx` calls `requireUser()` first. |
| P2 derived labels truncated to identical "Partisyon kay…" on phones | ux | Detail rows name unlabelled links by part (`Alto`, `Tutti`) under the kind heading; label `line-clamp-2`. Editor keeps the full derived label (AC15). |
| P2 `#baglantilar` heading hidden under the top bar | ux | `scroll-mt-20 md:scroll-mt-6`. |
| P2 archiving a programme piece from the edit page had no confirm | ux | `DangerZone` gets `inProgram`, reuses the `arşivlensin mi?` confirm. |
| P2 empty `Etiket` inputs in bulk preview | ux | Placeholder = derived label (`Drive klasörü` for folder rows). |
| P2 bulk `Önizle` dropped focus | ui | Summary line is focusable and focused after preview. |
| P2 inline link edit save/cancel dropped focus | ui | Focus returns to that row's menu button. |
| P2 `Eser ekle`, `Sırayı düzenle`, `Bitti` 40 px | ui | `h-11`. |
| P2 users without a part had no chips to clear `?partisyon=` | ui | Filter row shows whenever a filter is active (`Tümü` + the part chip). |

P3s from all four reviews are carried forward in `design/STATUS.md`.
Manual phone check of a real Drive PDF / YouTube preview (po-decisions §3): not possible in this environment (no device, fake seed ids); carried forward to the Phase 6 deploy check.
