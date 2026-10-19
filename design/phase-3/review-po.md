# Phase 3 PO acceptance review

Author: arkhe-po. Date: 2026-10-18. Yardstick: `po-decisions.md` §3 (AC 1–22).

Evidence used:
- `e2e-results.txt`: 210/210 pass. This includes Phase 1–2 and the new `phase3-repertoire.mjs` (86 checks).
- `npm run lint` and `npm run typecheck`: clean, as reported by the tech lead.
- The four team reviews and `review-fixes.md`. Both P1s are fixed and backed by e2e:
  - DBA/backend P1-1: the label CHECK is now 120 via `drizzle/0003_phase3_label_length.sql`. e2e: "review: a 120-character label is saved".
  - UI P1: focus after a move. e2e: "focus stays on the moved row's button after a link move" and the programme equivalent.
  - Every P2 is fixed: the metadata auth leak, derived-label truncation, the `#baglantilar` scroll margin, the edit-page archive confirm, bulk placeholders, bulk focus, inline-edit focus, 44 px buttons, and `?partisyon=` without a part.
- A spot-check in real Chrome at mobile size on the running app:
  - As `korist@` (alto): home, `/repertuvar`, and the `Ave Verum Corpus` detail page.
  - As `sef@`: `?liste=program` and `/repertuvar/yeni`, where I filled the form but didn't submit it, so no data was created.
  - Results:
    - Chips read `Çalışılıyor 3 · Program 3 · Hazır 2 · Arşiv 1 · Tümü 6`.
    - Rows show the meta chips (`3:40`). `Partisyonum` is visible, and on `Hallelujah` it is the dashed `Partisyon kaydı yok`.
    - The detail page shows `Partisyonumu aç (Alto)`. The `Benim partisyonum (Alto)` filter hides the S/T/B rows. Link rows are now titled `Alto` / `Tutti` and fit at 390 px.
    - The programme eyebrow reads `KONSER PROGRAMI · 3 ESER · TOPLAM 8:40`, numbered 1–3.
    - The home card lists the learning pieces with `Partisyonum`, and there's no sample-data pill.

## Acceptance criteria

| AC | Result | Evidence |
|---|---|---|
| 1 | Met | e2e AC1 ×5 (default view, the counts `3/3/2/1/6`, Hazır, Arşiv, Tümü). Spot-check matches. |
| 2 | Met | e2e AC2 ×7: `gulum`, `Mozart`, archived `Abendlied` with its status chip and the `tüm durumlar` line, no chip current, `Eşleşen eser yok.`, `Aramayı temizle`. |
| 3 | Met | e2e AC3 ×2. Spot-check: `Latince · SATB · 3:40`. |
| 4 | Met | e2e AC4 ×2 (alto href, `_blank` + `noopener`). The accessible name starts with `Partisyonum` (D17 sr-only suffix, seen in the spot-check text). |
| 5 | Met | e2e AC5 ×3: the soprano chooser shows `Soprano 1`/`Soprano 2`, the Tutti fallback works, and the disabled state shows `Partisyon kaydı yok`. |
| 6 | Met | e2e AC6 ×3 (list, home, detail with no filter and every link). The UI P2-5 fix keeps the chips visible when a URL filter is active, which is consistent with D4. |
| 7 | Met | e2e AC7 ×5. |
| 8 | Met | e2e AC8 ×9: no iframe before preview, `resourcekey`, `start`, folder `embeddedfolderview`, `title` + `referrerpolicy` + no `sandbox`, one preview at a time, `Kapat`, and the fallback line. |
| 9 | Met | e2e AC9 ×3 (order, numbering 1..n, chip hidden from members when the programme is empty). |
| 10 | Met | e2e AC10 ×6. All 13 actions refuse a member and change no rows, and `yeni`/`duzenle` redirect. The backend review confirms that `assertManager()` runs first in every action. |
| 11 | Met | e2e AC11 ×5 (create → `#baglantilar` + toast, `4:05`, `4.05`→`4:05`, `abc`, empty title). |
| 12 | Met | e2e AC12 ×2. |
| 13 | Met | e2e AC13 ×7 (4 bad schemes/userinfo, duplicate, folder, nothing stored). |
| 14 | Met | e2e AC14 ×5 (51 lines, 5 valid + invalid + duplicate, guessed kinds, `Kaydet (5 bağlantı)` saves in order with the edit applied). |
| 15 | Met | e2e AC15. The editor keeps the full derived label. On the detail page the kind heading plus the part title is an accepted refinement (ux P2-1). |
| 16 | Met | e2e AC16 ×3 plus the focus check. |
| 17 | Met | e2e AC17 ×4: append `Programda 4. sıra`, reorder persists, the archive confirm `Arşivlenen eser programdan da çıkar.` removes the piece from the programme, and clear with its confirm. The edit-page archive path now confirms too (ux P2-3). |
| 18 | Met | e2e AC18 ×4 (links kept, `Arşivden çıkar`→`Hazır`, no delete on detail, exact confirm title, `Eser silindi.`, links gone). |
| 19 | Met | e2e AC19 ×3. Spot-check matches. |
| 20 | Met | e2e AC20. |
| 21 | Met | e2e AC21: the no-scroll checks in light and dark (list views, detail, `yeni`, and edit with the bulk preview open) all pass, plus 44 px chips/part buttons and `/uyeler` chips. The three 40 px buttons were raised to `h-11` (UI P2-4). |
| 22 | Met | 210/210, and lint and typecheck are clean. |

Manual real-phone preview check: **not done, and carried to the Phase 6 deploy check.** The environment has no device and the seed ids are fake. The risk is contained:
- The `Aç` link and the permanent fallback line `Drive'da aç` always work, even if an embed fails.
- e2e already pins the exact `src`, `referrerpolicy` and CSP.
- Phase 6 must preview one real public Drive PDF and one real YouTube video on an iPhone (Safari) and an Android (Chrome) before go-live.

## Verdict: ACCEPTED

There is nothing to fix before Phase 4. The tech lead may record the acceptance in `design/STATUS.md` and start Phase 4.

## Carry forward (for `design/STATUS.md`)

P2:
- **Phase 6 gate:** a real-phone preview of a public Drive PDF and a YouTube video (iOS Safari plus Android Chrome).
- **Phase 4 (already decided):**
  - `assignments.piece_id → pieces (restrict)`;
  - `deletePiece` maps the FK error to `Bu esere bağlı ödevler var. Silmek yerine arşivle.`;
  - homework links use `/repertuvar/[id]?partisyon=…`.
- **Backend P3-1:** guard `?partisyon=` against prototype keys (`Object.hasOwn` or `z.enum`). It renders a broken chip today, and Phase 4 homework links will build this param, so fix it with Phase 4.
- **Backend:** map `CHECK constraint failed` / FK errors in `addLink`, `updateLink` and `saveBulkLinks` to a form error instead of the error boundary (P1-1 defence in depth, P3-6, P3-7).
- **Carried from Phase 2, still open:** DBA P2-1 (freeze reports at close) and P1-A (`db:backup`/`db:check` before the first Turso migration).

P3:
- UX P3-1: scroll the active list chip into view (`Arşiv`/`Tümü` are off-screen at 390 px).
- Detail link rows: line 2 still repeats the part (`Tutti · Drive` under the title `Tutti`). Show `PartDot` + host only when the title is derived (rest of ux P2-1 / P3-7).
- UX P3-3: count the bulk folder line separately (`Kaydet (5 bağlantı + klasör)`); backend P3-7 adds the folder-only toast.
- UX P3-4: the active detail filter chip competes with the primary button.
- UX P3-5: `max-w-3xl` on the desktop list.
- UX P3-6: double empty message.
- UX P3-8: the back link on `/duzenle` goes to the piece.
- UX P3-9 and P3-10: the empty `<p>` and the home row height.
- UI P3-6/7 and DBA P3-1: drop the extra `router.refresh()` calls and wrap `getPiece` in `cache()`.
- UI P3-8 to P3-13: bulk row focus/remove parity on mobile, the stale bulk error, the kind select width (also ux P3-2), the home `Tümü` sr-only text, `ListMemory` deps.
- Backend P3-3/4/5/8: re-parse part hrefs, `removeFromProgram` NOT_FOUND, the `setPieceStatus` toast, and note the empty-authority URL in the docs.
- DBA P3-2: seed in one `db.batch`. DBA P3-3/4/5 are notes only.
- `(portal)/loading.tsx` goes to Phase 4 polish (D25).
