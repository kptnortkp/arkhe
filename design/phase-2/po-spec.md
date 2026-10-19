# Phase 2 — Çalışmalar ve devam takibi (PO spec)

Author: arkhe-po. Inputs: `PLAN_INPUT.md` (Faz 2 + roles table), `src/db/schema.ts` (`rehearsals`, `attendance` from phase 0), `design/phase-1/review-phase0.md` §1 (the `RehearsalHero` states and code sheet, which this spec adopts), `design/phase-1/frontend-review.md` (offline/push notes).

@ux, @ui, @dba, @backend: reply in your own files. Everything marked **Proposal** is my default; argue with it if you have a reason. Open questions at the end get settled in `po-decisions.md`.

## 1. Problem

Today the conductor tracks attendance on paper or in a WhatsApp poll, so nobody can answer "who has missed the last three Tuesdays?" or "is the tenor section reliable enough for the festival?". The paper list also eats rehearsal time: reading 45 names aloud takes 5 minutes.

Phase 2 must give:
1. A rehearsal calendar the whole choir trusts (when, where, what kind).
2. Self check-in in under 10 seconds per singer, without the conductor stopping the warm-up.
3. Manual entry for everything the self check-in can't cover (forgot phone, dead battery, no signal, someone checked in a friend).
4. Continuity tracking: per person and per section percentages for the current term, and a clear warning when someone misses too much.

## 2. Users and roles

| Role | In this phase they… |
|---|---|
| Şef (`conductor`) | Plans rehearsals, opens the live attendance screen on a tablet/laptop at the piano, marks people by hand, closes attendance, reads reports. |
| YK (`board`) | Same rights as the conductor for rehearsals and attendance. In practice a board member often runs the check-in screen so the conductor can conduct. |
| Korist (`member`) | Sees upcoming rehearsals, checks in with code/QR, reports an excuse in advance, sees own history and own percentage. |

"Managers" = conductor + board (`isManager`). All checks are on the server.

**Expected attendees of a rehearsal (the roster):** active users with role `member` or `board` whose voice part is in the rehearsal's target parts (all four for tutti/genel prova/konser) and who were already members on the rehearsal date (`users.createdAt` ≤ `startsAt`). The conductor is never on a roster. A user without a voice part is only expected at all-parts rehearsals. **Proposal.**

## 3. Domain rules (decided defaults)

### 3.1 Rehearsal types
| Value | UI label | Default target parts | Counts toward percentage |
|---|---|---|---|
| `tutti` | Tutti | all | yes |
| `sectional` | Partisyon çalışması | chosen subset (≥1) | yes, only for targeted parts |
| `dress` | Genel prova | all | yes |
| `concert` | Konser | all | yes |

Title is optional; the default title is derived from type (+ parts for sectionals, e.g. `Partisyon çalışması · Tenor, Bas`). Fields: type, date, start time, end time (default start + 2.5 h), location (free text, remembers the last used value as default), target parts, optional note for the choir (e.g. "Requiem nota getirin").

### 3.2 Recurring weekly rehearsals
- Creating a rehearsal has a `Her hafta tekrarla` toggle with an end date (`Son tarih`, required, max 26 weeks ahead). The system creates one real rehearsal row per week, all linked by a `seriesId`.
- Each occurrence can be edited or cancelled on its own (holiday, exam week). Cancelled occurrences stay visible as `İptal edildi` and never count.
- `Seriyi bitir` on any occurrence deletes all later occurrences that have no attendance records. No "edit all future occurrences" in this phase (create a new series instead).

### 3.3 Attendance statuses
| Value | UI label | Set by | Counts as attended |
|---|---|---|---|
| `present` | Geldi | self check-in on time, or manager | yes |
| `late` | Geç geldi | self check-in after the late threshold, or manager | yes (also counted separately) |
| `excused` | Mazeretli | member in advance, or manager | removed from the denominator |
| `absent` | Gelmedi | manager, or automatically at close | no |

- **Late threshold:** check-in more than 15 minutes after `startsAt` is recorded as `late` automatically. Constant in code. **Proposal.**
- **Unmarked at close:** when a manager closes attendance, every expected person with no record becomes `absent` (method `auto`). A past rehearsal that was never opened and has no records shows `Yoklama alınmadı` and is excluded from all percentages until someone records it.

### 3.4 Percentage and term (dönem)
- `Devam oranı = (present + late) / (counted rehearsals where the person was expected − excused)`. Counted = not cancelled, attendance closed or has records, within the selected period.
- **Term:** a `terms` list (name, start date, end date), e.g. `2026–27 Güz`, `2026–27 Bahar`. Managers add/edit terms from the reports screen (3 fields, no more). Reports and the member's own stats default to the term containing today; if none exists, the last 90 days. **Proposal.**
- **Warning (Devamsızlık uyarısı):** a person is flagged when they have **2 or more `absent` in their last 4 counted rehearsals**, or their term percentage is **below 70%** with at least 4 counted rehearsals. Excused absences never trigger it. Thresholds are code constants this phase. **Proposal.**
- The flag is shown to managers (reports, member detail) and gently to the member themself on their own history ("Son 4 çalışmanın 2'sine gelemedin. Bir sorun varsa şefinle konuş."). No automatic messages to anyone.

### 3.5 Self check-in (rotating code / QR)
- A manager presses `Yoklamayı başlat` on a rehearsal (allowed from 2 hours before start until end of that day). That sets `openedAt` and opens the **live screen**.
- The live screen shows a 4-digit code and a QR, both rotating every **30 seconds**. The server accepts the current and the previous code (so a code typed at second 29 still works).
- The code is derived from `codeSecret` + time step (TOTP-style HMAC). **Proposal:** the manager's browser receives the secret and computes the code locally, so the display keeps rotating even if the tablet loses signal for a while. Only managers ever receive the secret.
- QR content: a URL `/yoklama/kod/<rehearsalId>?c=<code>`. Scanned with the phone's normal camera app; if the member isn't logged in, they log in and land back on the check-in. No in-app scanner.
- Member enters the code via the `Geldim` button (code sheet from review-phase0 §1, auto-submit on 4th digit). Success → status `present` or `late` (by time), method `code` / `qr`.
- Wrong/expired code: inline error `Kod hatalı ya da yenilendi. Ekrandaki yeni kodu gir.` Rate limit: 5 wrong attempts per member per rehearsal per 5 minutes, then `Çok fazla hatalı deneme. Birkaç dakika bekle ya da yoklamayı alan kişiye söyle.`
- A member who already has `excused` and shows up anyway can still check in; it overwrites the excuse.
- Check-in only works while the rehearsal is open (`openedAt` set, `closedAt` null). After close: `Yoklama kapandı. Geldiysen yoklamayı alan kişiye söyle.`
- A member not on the roster (e.g. alto at a tenor sectional) can still check in; they appear on the live list under `Listede olmayanlar` and count as present for that rehearsal (they were there), but the rehearsal is not added to their denominator if they hadn't come.

### 3.6 Manual entry (manager)
- On the live screen and on any past rehearsal's attendance page: roster grouped by voice part (S, A, T, B), each row with name and a 4-way segmented control `Geldi / Geç / Mazeretli / Gelmedi`. One tap saves (method `manual`, `recordedBy` = manager). Tapping the selected value again clears it (back to unmarked) while the rehearsal is open.
- Bulk: per part `Kalanları geldi işaretle`; for the whole rehearsal `Yoklamayı kapat` (unmarked → `absent`, with a confirm dialog that states the count: `12 kişi işaretlenmedi. Gelmedi olarak kaydedilsin mi?`).
- Corrections after close are allowed any time by managers; the row shows `Düzeltildi · <manager first name>` when changed after `closedAt`.
- Live counters at the top: `Geldi 28 / 41` plus per-part chips (`S 9/12 · A 8/11 · T 5/8 · B 6/10`). The member list refreshes by polling every 5 s while open (no websockets).

### 3.7 Advance excuse
- On any upcoming (not started, not cancelled) rehearsal where they're expected, a member taps `Gelemeyeceğim`, optionally writes a short reason (max 200 chars, placeholder `Ör. sınav haftası, hastayım`), and confirms. Status `excused`, method `self`.
- They can withdraw it (`Mazereti geri al`) until `startsAt`. After start only a manager can change it.
- Bulk excuse for a date range (e.g. "3 weeks abroad") is **out of scope**; they tap each rehearsal.
- Reasons are visible to managers and the member, never to other members.

### 3.8 Poor signal in the hall
- Live screen: code/QR keep rotating offline (3.5). Manual marks made while offline are shown as `Kaydedilmedi` with a retry button and retried automatically when back online; the screen shows a banner `Bağlantı yok — işaretlemeler bağlantı gelince kaydedilecek.` Marks are kept in memory only (closing the tab loses them; the banner says so).
- Member phone: if submitting the code fails due to network, show `Bağlantı yok. Kodu gönderemedik; bağlantı gelince tekrar dene ya da yoklamayı alan kişiye söyle.` No offline queue on the member side (the code expires anyway).
- Pages must be light: the live screen must work on a 4-year-old iPad Safari and a mid-range Android tablet in landscape.

## 4. User stories

Members
- **M1** As a singer I see the next rehearsal on the home screen (when, where, type, the conductor's note) so I don't have to scroll WhatsApp.
- **M2** I see a list of upcoming rehearsals for the next weeks, sectionals for other parts are visible but marked as not mine.
- **M3** When attendance is open I tap `Geldim`, type the 4 digits from the conductor's screen (or scan the QR) and I'm done.
- **M4** I can tell the conductor in advance that I can't come, with an optional reason, and take it back if plans change.
- **M5** I see my own history this term (each rehearsal with status) and my percentage, so I know where I stand before anyone tells me.

Managers
- **C1** As the conductor I create a weekly tutti series for the whole term in one go, and cancel the one on a holiday.
- **C2** I plan a sectional for tenors and basses only; only they are expected.
- **C3** At rehearsal I open the live screen on the tablet, everyone checks in while we warm up, and I see who's missing per section.
- **C4** I mark people by hand (forgot phone, late, called me to excuse themselves), alone or in bulk, and close attendance.
- **C5** I fix last week's attendance afterwards ("Ayşe was actually there").
- **C6** I see per-person and per-section percentages for the term, who is flagged for missing too much, and export it as CSV for the board meeting.

## 5. Screens (IA proposal; @ux owns final names)

- Bottom tab `Yoklama` becomes **`Çalışmalar`** (`/calismalar`): upcoming list (default) + `Geçmiş` tab. Managers see `Çalışma ekle` and a `Raporlar` link.
- `/calismalar/yeni`, `/calismalar/[id]` (detail: info, my status/excuse for members; roster with manual entry for managers), `/calismalar/[id]/canli` (live screen, managers, landscape-friendly, big code + QR + counters + roster).
- `/yoklama/kod/[id]` QR landing (member).
- `/raporlar` (managers): period selector (terms + `Son 90 gün`), per-person table, per-part summary, warning filter, `CSV indir`, terms management.
- Home: `RehearsalHero` states from review-phase0 §1 become real, plus my term percentage card replacing the preview stats. Remove the "örnek veri" chip for attendance.
- Member detail (`/uyeler/[id]`, managers): small attendance summary (term %, last 4, warning).

## 6. Data (for @dba; schema may change freely, no production data yet)

Proposal only: add `type`, `endsAt`, `targetParts` (or a join table), `seriesId`, `note`, `cancelledAt` to `rehearsals`; extend `ATTENDANCE_STATUSES` with `late`; extend `CHECK_IN_METHODS` with `self` (excuse) and `auto` (close); add `updatedAt`/`updatedBy` on `attendance` for the `Düzeltildi` marker; new `terms` table; a check-in attempts table or reuse `login_attempts` keys for the rate limit. Seed: one term, a weekly tutti series with ~8 past rehearsals carrying varied statuses (so one demo member is flagged), one upcoming sectional, one upcoming concert.

## 7. Acceptance criteria (e2e-verifiable)

Demo users: `sef@` (conductor), `yk@` (board), `korist@` (member). The e2e suite resets data; tests may create rehearsals with start times relative to "now". Elements below must have stable accessible names or `data-testid` (notably the live code: `data-testid="live-code"`).

Calendar
1. Manager creates a single tutti rehearsal (date, time, location); it appears in `/calismalar` for `korist@` with date/time in Europe/Istanbul and the location.
2. Manager creates a weekly series with an end date 4 weeks later; exactly 5 occurrences (or the correct count for the chosen weekday) appear in the upcoming list.
3. Manager cancels one occurrence; it shows `İptal edildi` for members, has no `Gelemeyeceğim`/`Geldim` actions, and is not counted in reports.
4. `Seriyi bitir` on the 2nd occurrence removes the later occurrences without records; earlier ones remain.
5. A sectional for Tenor+Bas: a bass member sees it as theirs; `korist@` (if not T/B) sees it labelled as not for their part and has no `Gelemeyeceğim` button; it is not in their report denominator.
6. `korist@` cannot open `/calismalar/yeni`, `/calismalar/[id]/canli` or `/raporlar` (redirect or 404), and server actions for create/mark/close return an authorization error when called as a member.

Self check-in
7. Manager opens the live screen; a 4-digit code and a QR are visible; after ≥31 s the code text changes.
8. `korist@` (second browser context) on home sees `YOKLAMA AÇIK`, taps `Geldim`, enters the code shown on the manager screen; the hero switches to `YOKLAMAYA KATILDIN`, and within 10 s the manager screen shows the member as `Geldi` and the counter increments.
9. Entering a wrong code shows `Kod hatalı ya da yenilendi. Ekrandaki yeni kodu gir.` and nothing is recorded; the 6th wrong attempt within 5 minutes shows the rate-limit message even with a correct code.
10. The code from the previous 30 s step is still accepted; a code two steps old is rejected.
11. Opening the QR URL (`/yoklama/kod/<id>?c=<current code>`) while logged out redirects to login, and after login records the check-in and shows the success state.
12. For a rehearsal that started 20 minutes ago, a self check-in is recorded as `Geç geldi`.
13. After the manager closes attendance, `Geldim` is gone and a check-in attempt via the QR URL shows `Yoklama kapandı…`.

Excuse
14. `korist@` taps `Gelemeyeceğim` on an upcoming rehearsal with reason "Sınavım var"; the hero/list shows `MAZERETİN İLETİLDİ`; the manager sees `Mazeretli` with the reason on the roster before the rehearsal starts.
15. `Mazereti geri al` returns the member to unmarked; after `startsAt` the button is no longer shown.
16. Another member cannot see `korist@`'s reason anywhere.

Manual entry
17. On the live screen the manager sets a member to each of `Geldi`, `Geç`, `Mazeretli`, `Gelmedi`; each choice persists after reload.
18. `Kalanları geldi işaretle` for Alto marks every unmarked alto `Geldi` and leaves already-marked altos unchanged.
19. `Yoklamayı kapat` shows a confirm dialog with the unmarked count; after confirming, all unmarked expected members are `Gelmedi` and the rehearsal shows as closed.
20. On a closed past rehearsal the manager changes a member from `Gelmedi` to `Geldi`; the row shows `Düzeltildi`, and the member's own history and the report reflect it.
21. A past rehearsal that was never opened shows `Yoklama alınmadı` and is excluded from percentages; once the manager records one status there, it is included.
22. With the browser set offline (Playwright `context.setOffline(true)`), the live code keeps changing, a manual mark shows `Kaydedilmedi` and the offline banner; after going back online the mark saves without user action and survives reload.

Reports and continuity
23. `/raporlar` shows for every expected person: name, part, attended/expected, `%`, late count, excused count, absent count; values match the seeded data (spec'd in the seed file) for the default term.
24. Per-part summary shows the average percentage for S, A, T, B.
25. The seeded member with 2 `Gelmedi` in their last 4 counted rehearsals carries the `Devamsızlık uyarısı` badge; filtering `Sadece uyarılılar` shows only flagged people. A member whose misses are all `Mazeretli` is not flagged.
26. Switching the period to another term or `Son 90 gün` recalculates the table.
27. `CSV indir` downloads a UTF-8 (with BOM, so Excel shows Turkish letters) CSV with the same columns and rows as the table.
28. Manager creates a term (name, start, end); it appears in the period selector.
29. `korist@` sees their own history on `/calismalar` → `Geçmiş` (each rehearsal with status) and their term percentage; numbers match the report row for them. If flagged, they see the gentle warning text.

Quality
30. All new screens work at 375 px without horizontal scroll, light and dark; the live screen also at 1024×768 landscape with the code readable from 3 m (code font ≥ 96 px).
31. `npm run lint`, `npm run typecheck` and `npm run e2e` pass.

## 8. Out of scope (this phase)

Push notifications / WhatsApp messages, "Geç kalacağım" notices, bulk date-range excuses, editing all future occurrences of a series, location/GPS or Wi-Fi checks against cheating, calendar export (ICS), linking rehearsals to pieces (Phase 3), concert ticketing/events detail, configurable thresholds UI, offline queue on member phones, attendance-based eligibility rules for concerts.

## 9. Risks and open questions (to settle in po-decisions.md)

1. **Code sharing over WhatsApp.** A singer at home can get the code from a friend within 30–60 s. Accepted risk: rotation + manager can see the list live and correct it. No GPS.
2. **Client-side code generation** exposes the secret to manager browsers only. @backend: confirm HMAC via Web Crypto on both sides and server-side clock tolerance.
3. **Do concerts and genel prova count the same as tutti?** Proposal: yes, weight 1. Some choirs require 100% at dress rehearsals; we only show it, no rules.
4. **Thresholds** (15 min late, 2-of-4, 70%) are guesses; constants in one file so they're a one-line change.
5. **Board members on the roster:** they sing, so yes. A board member running the live screen marks themself manually.
6. **New members mid-term** are not expected before `users.createdAt`; if the invite was created early, percentages may be slightly off. Acceptable.
7. **Polling every 5 s** with 50 phones + 1 tablet is fine for SQLite/Turso free tier; @backend to confirm the read cost on Turso.
8. **IA:** renaming the `Yoklama` tab to `Çalışmalar` — @ux decide.
