# Phase 4 review: UX (arkhe-ux-designer)

Checked against `ux.md`, with `po-decisions.md` taking precedence, and `implementation-notes.md`. Screens were captured with playwright-core (Chrome) at 375×812 (mobile, DPR 2) and 1280×900, in light and dark. Accounts: `korist@`, `sef@`, `yk@`, `yeni@`. Screens: `/` (home cards), `/odevler` (Güncel/Geçmiş, member and manager), the details for A–F, `/odevler/matris`, `/odevler/yeni` (empty and with errors), `/odevler/a/duzenle`, the roster sheet on D, the piece menu `Ödev ver`, the piece page `ÖDEVLER`, and the tab and sidebar badge. Screenshots are in the session scratchpad `review4-ux/`.

None of the screens scroll sideways at the page level at 375 in either theme. Every core singer action takes one tap: `Teslim ettim` on the row, on the home card and on the detail page.

## D4: dark-mode contrast of the solid overdue badge passes

Contrast values come from the OKLCH tokens in `globals.css` (computed in sRGB):

| Badge | Light | Dark |
|---|---|---|
| Solid overdue: `bg-absent` with `text-white` (light) / `dark:text-background` (dark) | 5.15:1 | 6.23:1 |
| Soon (red, soft): `bg-absent/12 text-absent-ink` on card | 5.41:1 | 8.10:1 |
| Amber: `bg-late/18 text-late-ink` | 5.68:1 | 8.68:1 |
| Green: `bg-present/14 text-present-ink` | 4.64:1 | 9.93:1 |
| Tab badge: `bg-primary` | 11.85:1 | 9.60:1 |

The fallback is not needed. Without the `dark:text-background` override, white text in dark would only reach 3.13:1, so keep it.

## P1

None.

## P2

1. **On the eligible singer's detail page, the deadline badge sits at the bottom inside step 3.** File: `src/app/(portal)/odevler/[id]/page.tsx:215–219` renders the badge in the header only when `!eligible`. `SubmitToggle` renders it inside step 3.
   - At 375, D's `Gecikti · 2 gün` and C's `5 saat kaldı` are below the fold, under the description and steps 1–2. Only the neutral `Son tarih: …` line shows in the header.
   - ux §4.1 says the header row is parts plus `DeadlineBadge`.
   - Fix: always render `DeadlineChip` in the header row for an eligible singer, using the pending badge, or the done badge once submitted. In step 3, keep only the `Teslim edildi · {tarih}` / `Geç teslim · {tarih}` state and the button. Don't show the same badge twice before submission.

2. **Wrong badge in the header for managers and not-eligible singers.** File: same page, lines 215–219, where `deadlineBadge({ … expected: true })` is called.
   - The conductor on D sees a solid red `Gecikti · 2 gün`. D6 requires the muted `Süre doldu` with `CalendarX`, as the `/odevler` row already shows.
   - `korist@` on F (tenor and bass only) sees a green `4 gün kaldı`. ux §2 says "not my part: no badge"; the badge reads as their own deadline.
   - Fix:
     - Manager: before the deadline, use the deadline tone. After it, use `Süre doldu` plus `· {k} eksik` in `text-absent-ink`, the same as the list row.
     - Not-eligible member: no badge, only `Son tarih: …`.

3. **Matrix at 375 shows only 2 homework columns.** File: `src/app/(portal)/odevler/matris/page.tsx:87,138,111`.
   - The name column is `w-[8.5rem]` (136px) and the `Toplam` column is about 78px wide. ux §5 and D12 aim for the 4 newest columns to be visible without scrolling.
   - Fix:
     - Name column: `w-[6.5rem] max-w-[6.5rem]` (104px), keeping `truncate` and a `title` with the full name.
     - `Toplam` column: `w-14 px-2`, centred.
     - Cells: keep the `size-11` link but drop the `p-0.5` wrapper to `p-0`, which makes each column 44px.
     - Result: 104 + 4×44 + 56 = 336px, which fits in the 343px box.
   - Desktop issue on the same page: `min-w-full` stretches `Toplam` to about 420px of empty space. Use `w-max` without `min-w-full`, or give `Toplam` a fixed `w-16`.

4. **Matrix `Toplam` turns almost every row red.** File: `src/lib/homework/queries.ts:365–373`.
   - The denominator counts `pending` cells, so a singer who has missed nothing reads `1/5` in `text-absent-ink`. Currently 20 of 22 rows are red, so the colour carries no signal.
   - Fix: `total = cells.filter(c => c === "done" || c === "late" || c === "missing").length`. Apply red only when `total > 0 && done/total < 0.5`.
   - Copy stays `{n}/{m}`. Add a column header `title`: `Süresi dolan ödevlerden teslim edilen`.

5. **Late joiner sees `Tenor · hepsi tamam` above 4 rows in `YAPILACAK`.** Screen: `/odevler` for `yeni@`.
   - The subtitle counts only expected homework, so it contradicts the list below it.
   - Fix: when the expected count is 0 but optional rows exist, show `Tenor · {n} isteğe bağlı`. Keep `hepsi tamam` only when the `YAPILACAK` group is empty.

## P3

1. **Form part chips:** the selected state is only a 1px `border-primary` with `bg-primary/8` and bold text (`assignment-form.tsx:29`). Add a `Check size-4` icon in front of the label when checked (`has-checked:` or render it conditionally), and use `has-checked:bg-primary/12`.
2. **Form `Açıklama`:** the help text `Herkes görür.` repeats the start of the placeholder. Change the placeholder to `ör. "Metronom 60, 20. ölçüde nefes yok."`.
3. **Matrix column header:** `Bogoroditse Devo` breaks mid-word (`Bogorodit|se Devo`). Remove `break-words` and use `line-clamp-2 hyphens-auto` with `lang="tr"` on the span. Alternatively, show the first word truncated at `w-12`.
4. **Row meta line:** when the parts wrap, `Tüm eser ·` is left with a dangling separator (Aman Gülüm and F at 375). Put the separator inside the `PartList` wrapper, or use `gap-x-1.5` with no separator once it wraps.
5. **Home for `yk@`:** the `Ödevlerim` and `Ödevler` headings sit next to each other and are easy to mix up. Rename the manager card `Teslim takibi`, and its link from `Tümü` to `Teslimler` (ux §8) → `/odevler/{id}#teslimler`.
6. **Desktop `/odevler`:** rows span the full content width (about 944px). Apply `mx-auto max-w-3xl` as on the detail page (ux line 5).
7. **Detail, step 1:** `Partisyonumu aç (Alto)` and `Kaydı e-postayla gönder` are both filled primary buttons stacked, so neither stands out. Make step 1 `variant="outline"` and keep step 2 primary.
8. **Roster sheet:** there is no explicit `Kapat` button (the X is present). This is acceptable; no change needed.

## Data note

Opening E as `korist@` while taking screenshots fired `markFeedbackSeen`, which set `submissions.feedback_seen_at` on E. Its `Yeni not` dot is now gone until the next `cleanup()` / `seedHomework` re-anchors the fixture. I was not permitted to reset the column directly. No `E2E` homework was created.
