# Phase 4 PO acceptance review

Author: arkhe-po. Date: 2026-10-18. Yardstick: `po-decisions.md` §3 (AC 1–24).

## Verdict: ACCEPTED

Phase 5 (finance) can start. There are no must-fix items.

Evidence:
- `e2e-results.txt`: 322/322 pass. This covers Phases 1–4; `phase4-homework.mjs` has a check tagged for every AC from 1 to 23.
- Lint and typecheck are clean (tech lead, `review-fixes.md`).
- No reviewer raised a P1. The tech lead fixed every P2 (`review-fixes.md`):
  - backend: a surrogate pair split in the subject could crash the detail page (500)
  - ui: focus and announcement on the detail toggle, and focus on the first invalid field
  - ux: the detail header badge for each role, the matrix width at 375 px, the matrix `Toplam` count, and the late joiner's summary line
- I spot-checked the asserted copy in `e2e/phase4-homework.mjs`. These strings are each waited on as literal text: `Ödev verildi.`, `Geçerli bir e-posta adresi gir.`, `Bu esere bağlı ödevler var. Silmek yerine arşivle.`, `Ödev bu arada değişti…`, `Ödev silindi.`, `Teslimini Demo Şef işaretledi.`, `Sonradan katıldı`, `Son tarih geçti`.
- The dev server is up (`/giris` returns 200). I didn't click through the app as a singer, because opening E fires `markFeedbackSeen` and changes fixture data (see the UX review's data note).

## Acceptance criteria

| AC | Result | Evidence (e2e check names) |
|---|---|---|
| 1 | Met | "AC1 korist's badge is 4", "yk's badge is 2", "the conductor has no badge", "yeni@ has no badge", "Ödevler is in the 375 px tab bar with the badge", "more than 9 open homework reads 9+" |
| 2 | Met | "AC2 Güncel lists D, C, B, A and not E or F", "bars read Ölçü 12–34 / Tüm eser", "E is under Geçmiş" |
| 3 | Met | The four seeded badges A–D, the four boundary badges (72h−10min, 72h+10min, +23h, +30min), and "badges carry an icon and the absolute date" |
| 4 | Met | "AC4 mailto prefix, no '+'", the subject/body check with the exact subject, "Konuyu kopyala answers with a toast", "the three steps are shown" |
| 5 | Met | "AC5 Partisyonum opens the alto file", "Esere git links to the piece with the part filter" |
| 6 | Met | "AC6 Teslim ettim → Teslim edildi · today, after reload", "the badge drops to 3", "Geri al restores green and 4", the list submit and toast-undo checks |
| 7 | Met | "AC7 submitting D shows Geç teslim", "the roster shows korist late and Alto 4/6", "the matrix shows korist late on D" |
| 8 | Met | "AC8 E shows Yeni not before opening", "Şefin notu with author and date", "the dot is gone after opening", "no Geri al", "the undo action is refused when a note exists" |
| 9 | Met | "AC9 F has no Teslim ettim…", "submitting F is refused", "nothing is written for F" |
| 10 | Met | Seven AC10 checks: no controls, the three redirects, "another singer's note never reaches korist's HTML", "every manager action refuses a member", "refused actions change no rows". The backend's live leak probe found 0 hits across 14 paths in both HTML and RSC. |
| 11 | Met | "AC11 the late joiner sees D muted with the hint", "not listed before submitting", "…listed as Sonradan katıldı and both numbers rise" |
| 12 | Met | "AC12 no email: a hint, no mailto, Teslim ettim still there", "managers see the Ayarla banner" |
| 13 | Met | "AC13 Ödev ver preselects the piece", "the detail shows bars, parts and the Istanbul due (21 Eki Çar 21:00)", "no Ödev ver on an archived piece" |
| 14 | Met | All five validation messages, plus "a double submit creates one row" |
| 15 | Met | "AC15 D's per-part counts match the seed", "13/22 teslim", "manual mark shows 'şef işaretledi'", "late and overdue states", "Teslim etmeyenler lists the 9 missing" |
| 16 | Met | "AC16 marking shows 'şef işaretledi' and raises the count", "the singer sees Teslim edildi and who marked it", "the singer can undo a manual mark" |
| 17 | Met | "AC17 korist sees Yeni not on A", "Şefin notu shows and Geri al is gone", "a board note is headed Geri bildirim", "Notu sil removes it and Geri al returns" |
| 18 | Met | "AC18 matrix columns are newest-left A, F, B, C, D, E", "korist's cells (pending,none,pending,pending,missing,done)", "AC23 no horizontal scroll on /odevler/matris" |
| 19 | Met | "AC19 korist's A is now Gecikti", "a stale edit form is refused", "the delete confirm names the homework and the submission count", "gone from the list", "and from the matrix" |
| 20 | Met | "AC20 kayit@ is rejected", "the mailto uses the new address" (cleanup restores the original address) |
| 21 | Met | "AC21 nothing is deleted" (with the literal refusal message), "the piece page lists its open homework" |
| 22 | Met | "AC22 korist's Ödevlerim shows D first with Teslim ettim and +3", "the conductor sees the Ödevler card only", "a board singer sees both cards" |
| 23 | Met, one minor gap | No horizontal scroll on every listed page in light and dark, including with the note sheet open; "AC23 targets are ≥ 44px". Gap: the matrix column-header links are 56×38 px (ui P3-6). The test's sample doesn't include them. They are secondary links (each cell is already a 44 px link to the same place), so this doesn't block. It is carried forward as P2 below. |
| 24 | Met | 322/322 e2e; lint and typecheck clean |

Manual check (not e2e): opening the real mail app on iPhone and Android with Turkish characters, and the dark-mode contrast of the solid overdue badge. Both stay on the Phase 6 deploy gate, as `implementation-notes.md` records.

## Must-fix before Phase 5

None.

## Carried forward to Phase 6

P2 (cheap; do it when Phase 5 touches shared files, or at the latest in the Phase 6 polish pass):
1. Matrix column-header links need to be at least 44 px tall: add `min-h-11` to the link (ui P3-6, raised to P2 because it falls under AC23).
2. Actions hit by a concurrent delete throw into the error boundary: catch the FK error and return `NOT_FOUND` / `Bir eser seç.`, and add a catch-all toast in `useRunAction` (backend P3-2). Phase 5 should reuse that safety net.
3. A manager can mark a singer who isn't eligible but still has a note row. `targetAllowed` needs a `requireEligible` check for marking (backend P3-3).

P3:
- Backend:
  - optimistic lock at seconds precision; switch to a `version` column (backend P3-1 / dba P3-2)
  - `markFeedbackSeen` / no-op undo revalidate the whole layout (P3-4)
  - strip bidi/C1 controls in `clean()` (P3-5)
  - stricter `RECORDING_EMAIL_RE` (P3-6)
  - `updateAssignment` returns STALE instead of NOT_FOUND when the homework was deleted (P3-7)
- DB:
  - `rosterFor`/`homeworkMatrix` should check the role themselves (P3-3)
  - whitespace in the trim CHECKs (P3-4)
  - paging for `Geçmiş` once it passes about 200 rows (P3-5)
  - derive `submissionCount` from the roster (P3-6)
  - actor FK indexes, not needed now (P3-7)
- UI:
  - optimistic row move and focus after submitting from the list (P3-1)
  - sheet initial focus away from the mark button (P3-2)
  - side sheet on desktop (P3-3)
  - `NoteForm` should use `submitWithoutReset`, `aria-invalid` and focus-on-error (P3-4)
  - focus after marking in `?filtre=eksik` (P3-5)
  - dangling `·` when parts wrap (P3-7 / ux P3-4)
  - `dueTime` `aria-describedby` (P3-8)
  - keep `Kaydet` disabled after success (P3-9)
- UX:
  - check icon on the part chips (P3-1)
  - `Açıklama` placeholder (P3-2)
  - matrix header word break (P3-3)
  - rename the home manager card to `Teslim takibi` (P3-5)
  - `max-w-3xl` for `/odevler` on desktop (P3-6)
  - outline style for step 1 (P3-7)
- Scope carry-forward from `po-decisions.md` §4:
  - piece combobox, quick deadline picks and subject preview
  - `bugün`/`yarın` dates
  - client-side tone ticking
  - a seeded left member
  - `(portal)/loading.tsx`

Process note for Phase 5: reviewers create only `E2E…` data. Stray rehearsals and a `feedback_seen_at` write from this review round both had to be cleaned up.
