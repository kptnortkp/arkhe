# Phase 2 — PO decisions

Author: arkhe-po. Settles every open question in `po-spec.md`, `db.md`, `backend.md`, `ux.md`, `ui.md`, plus the Phase 1 review items that touch this phase. Where this file and an earlier one disagree, this file wins. The final acceptance criteria are in §3; the tech lead builds and the e2e suite tests against §3, not against `po-spec.md` §7.

## 1. Decisions

Each entry gives the decision and the reason.

### Check-in and the code
| # | Question (raised by) | Decision | Reason |
|---|---|---|---|
| D1 | Code shared over WhatsApp / photo of the QR (spec Q1, backend T3) | **Accepted risk.** No GPS or Wi-Fi checks. Mitigations: the 30 s rotation, the live list a manager can see, manager marks winning over self check-in (D3), and the `Sadece kod` view (D12). | 2 of 10,000 odds by guessing, and a friend sending the code is a social problem the conductor solves in one sentence. GPS would cost us iOS permission prompts and trust. |
| D2 | Secret in the browser vs a server-computed code schedule (spec Q2, backend §1.2, ui §2.2) | **Code schedule.** The server sends `{ serverNow, firstStep, codes[] }` covering 2 h. HMAC exists **only on the server** (`node:crypto`). Drop the isomorphic `totp.ts`. | It leaks less and fixes tablet clock skew. It also works on `http://` LAN testing, where `crypto.subtle` is missing. Two hours offline is more than a rehearsal needs. |
| D3 | Check-in overriding an excuse vs a manager's mark (backend §2.1, db §1.5) | Self check-in **overwrites only the member's own advance excuse** (`method='self'`). It never overwrites a manager mark (`manual`/`auto`). The member then sees `Yoklamayı alan kişi seni zaten işaretledi.` A repeat check-in is a no-op: it never downgrades `present` to `late`. | The person in the room has the final word over a phone. Idempotency covers double taps and retries. |
| D4 | `rehearsal_secrets` table vs column (backend §1.3, db §1.3) | **Separate 1:1 table** `rehearsal_secrets (rehearsal_id PK, code_secret, rotated_at)`, read only by `src/lib/attendance/code.ts` (`server-only`). It is upserted (new secret) on every `openAttendance`. | A single careless `select()` can then never leak the secret to a member. It also removes Web Crypto from `schema.ts`. |
| D5 | QR landing: confirm tap vs zero taps (ui §3.2, backend §2.2) | **Zero taps, but never on GET.** The page is rendered by the server. A client effect calls the `checkIn` action **once** on mount, then `router.replace` drops `?c=`. An expired code falls back to the inline code input (ux §7). | Link unfurlers don't run JS and have no session, so a write from the mount effect is safe. At the hall door, every tap counts. |
| D6 | Rate limit | 5 wrong codes per member per rehearsal per 5 min, using insert-then-count (atomic). Add the backend's 30-wrong-codes-per-day cap per user. No IP limit. | Shared choir Wi-Fi would make an IP limit lock everyone out. |
| D7 | Opening window | A manager can open attendance from **2 h before start** until the end of that Istanbul day. | Lets them set up before warm-up, and covers rehearsals that run late. |

### Counting, terms and warnings
| # | Question | Decision | Reason |
|---|---|---|---|
| D8 | Auto-close at the end of the day (ux §3.5, Q1) | **Yes, done lazily.** An opened, unclosed rehearsal whose Istanbul day has ended is closed the next time any loader or route touches rehearsals (`/`, `/calismalar*`, `/raporlar`, CSV, live poll). This uses the same transaction as `closeAttendance`, with `closed_at` set to the end of that day. No cron. | Forgetting to close is the most likely failure. The lazy approach needs no scheduler and costs nothing. |
| D9 | Unmarked people on a past rehearsal (db §6) | **Counted means closed (and not cancelled).** Closing, whether manual or automatic, turns every unmarked expected person into `absent/auto`. A rehearsal that was never opened stays `Yoklama alınmadı` and is excluded until a manager enters marks on its detail page and presses `Yoklamayı kapat`. Drop the "`exists attendance`" branch of the counted CTE. | With one rule, percentages and warnings can't disagree. Advance excuses on a past, never-opened rehearsal don't sneak it into the stats. |
| D10 | Concerts and genel prova weight (spec Q3) | **Weight 1, same as tutti.** The type chip is visible in history and reports. | Simple. The conductor can already see who skipped a dress rehearsal. |
| D11 | Thresholds (spec Q4) | **Kept as code constants** in `src/lib/attendance/rules.ts`: late after 15 min; open from 120 min before; warning at ≥2 `absent` among the last 4 counted rehearsals that weren't excused, or term % < 70 with ≥4 counted. The live screen shows `19:45'ten sonra geç sayılır.` | Realistic for a weekly amateur choir, and a one-line change later. No settings UI. |
| D13 | Off-roster check-ins | They show under `LİSTEDE OLMAYANLAR`. In stats they count as an attended rehearsal, in both the numerator and the denominator (as in the db §3 union). | The person came, and it can never push anyone above 100%. |
| D14 | Joining mid-term: `joined_at` (db §1.1, Q6) | **In scope.** `users.joined_at` and `left_at`. `Koroya katılış tarihi` (native date, default today) goes on the member create/edit form, managers only. Deactivating a member sets `left_at`. The gap when someone leaves and later rejoins is accepted. | Without it, new joiners look like they missed half the term. |
| D15 | Board on the roster (Q5) | Yes, `role in ('member','board')`. The conductor is never on the roster. | Board members sing. |
| D16 | Voice part required (Phase 1 review-ux P1) | `Partisyon` is **required for `member` and `board`** in the member form; there is no `Yok` option for those roles. Existing users without a part keep working (they are expected only at all-parts rehearsals). | Sectionals and Phase 3 part files both depend on it. |
| D17 | Terms | One table, no overlaps (backend rejects with `Dönemler çakışamaz.`), at most 1 year long. The default period is the term containing today, otherwise `Son 90 gün`. | Matches how the choir talks ("bu dönem"). |

### Calendar
| # | Question | Decision | Reason |
|---|---|---|---|
| D18 | `Seriyi bitir` vs future excuses (db §6, backend §3) | It deletes **every occurrence of the series with `starts_at > max(now, this.starts_at)`**, including those with excuse rows (they cascade away). Earlier and current occurrences stay. Dialog copy: `Bu tarihten sonraki 6 çalışma silinecek. Bildirilen mazeretler de silinir.` | Excuses for a rehearsal that no longer exists mean nothing. Keeping those rehearsals around would confuse everyone. |
| D19 | Cancel | Allowed while attendance has not been opened (even if excuses exist). Excuse rows are kept, so `İptali geri al` restores them. An opened rehearsal can't be cancelled; correct the marks instead. | Matches the DBA's CHECK, and a holiday cancellation is reversible. |
| D20 | Editing an occurrence that has rows | Allowed. The start time may move by ≤1 day; statuses are not recalculated. Edit affects only this occurrence. | Covers "we start 30 min later today" without a recalculation engine. |

### Live screen and manual entry
| # | Question | Decision | Reason |
|---|---|---|---|
| D12 | `Sadece kod` view (ux §3.4) | **In.** `?gorunum=kod` shows only the code, QR and countdown, with no names. | When the screen is projected or faces the room, nobody's absence is shown to the choir. It's a layout toggle, so it costs almost nothing. |
| D21 | Clearing a mark: tap again vs explicit button (ui §2.6, ux §3.3) | **An explicit `İşareti kaldır` icon button** (44 px), shown only on marked rows and **only while open**. After close, a mark can be changed but not cleared. | Radio semantics work for keyboard and screen readers, and reports stay complete after close. |
| D22 | Bulk `Kalanları geldi işaretle` | It runs immediately, with an undo toast `Geri al` (5 s) and no confirm dialog. It only works online. | Undo is cheaper than a confirm at the piano. |
| D23 | Offline marks | Kept in memory only. They go as one batched POST to a route handler, with a `markedAt` stale-write guard (backend §3). There is a `beforeunload` warning and the banner `Bağlantı yok — işaretlemeler bağlantı gelince kaydedilecek. Bu sekmeyi kapatma.` Polling never overwrites a row that still has a pending mark. | This covers the poor-signal hall without IndexedDB. |
| D24 | Polling | A route handler (not a server action) returns the full snapshot every 5 s while the screen is visible and open, then backs off on errors. Member phones don't poll; the home hero refreshes on `visibilitychange` (at most once per 30 s). | That is about 1% of the Turso free quota (db §6), and it doesn't block the server-action queue. |
| D25 | Wake lock | Request it, silently. No status pill and no iOS settings hint. | Cheap win; the extras are polish. |

### Reports and privacy
| # | Question | Decision | Reason |
|---|---|---|---|
| D26 | Members seeing their section's turnout (ux Q2) | **No, not in Phase 2.** Members see only their own data. Managers keep the per-part card on home. | A 4-person tenor section is identifiable from a percentage, and peer-pressure features need the conductor's tone, not ours. Revisit later. |
| D27 | CSV separator and format (backend §6, ui §5) | **`;`**, UTF-8 with BOM, `\r\n`, every cell quoted. Cells starting with `= + - @` (or a tab/CR) get a leading `'`. The percentage is an integer without `%` (column header `Yüzde`). Columns: `Ad soyad;Partisyon;Geldi;Beklenen;Yüzde;Geç;Mazeretli;Gelmedi;Uyarı`. Excuse reasons are never exported. | Turkish Excel uses `;` as its list separator, and integers sort as numbers. |
| D28 | Excuse reason visibility | Visible to managers and the member only; never in the CSV or in poll payloads to non-managers. | Health and family reasons are private. |
| D29 | Member-facing warning tone | `bg-accent`, never red, never the word "uyarı" on the member side (ux §8 copy). Managers see the `Uyarı` badge. | It's meant to start a conversation, not to punish. |
| D30 | Inactive-account login message (Phase 1 backend #8) | Keep the **generic** error. | Doesn't leak account status, and the person asks the board anyway. |

### Already decided by the tech lead (recorded, no change)
- **D31** A board member **cannot issue invite/reset links for board members or for themselves**, and cannot create, promote to or edit `board` accounts. Only the conductor can. A user resets their own password via `/profil`. Backed by the Phase 1 review-backend P2-3 finding. PO agrees.

### Routes and IA (ux §0, ui §1)
- The tab `Yoklama` becomes `Çalışmalar` (`/calismalar`), and `/yoklama` redirects there. `Raporlar` is reached from a header link on `/calismalar` and a sidebar item on md+; there is no bottom tab.
- Routes: `/calismalar`, `/calismalar?sekme=gecmis`, `/calismalar/yeni`, `/calismalar/[id]`, `/calismalar/[id]/duzenle`, `/calismalar/[id]/canli`, `/yoklama/kod/[id]`, `/raporlar`, `/raporlar/csv`. The tech lead picks the API paths.

## 2. Cut from Phase 2

To keep the phase buildable, these are **not** built now:
1. Members seeing section turnout (D26).
2. The turnout trend chart on `/raporlar` (ui §6.3). The part tiles, per-person bars and `AttendanceStrip` stay.
3. The streak footnote (`Son 6 çalışmaya üst üste geldin`).
4. The wake-lock status pill and the iOS Auto-Lock hint (D25).
5. The `since` cursor on the poll; full snapshots only.
6. Editing all future occurrences of a series; bulk date-range excuses; "Geç kalacağım" notices.
7. Push notifications, WhatsApp messages, ICS export, GPS/Wi-Fi presence checks.
8. A settings UI for thresholds; type weighting.
9. An audit log beyond `recorded_by` / `corrected_at`.
10. An offline queue on member phones; IndexedDB/localStorage persistence of manager marks.
11. A calendar-grid view (a week-grouped list only); a `datalist` of the 5 most-used locations (prefill the last location only).
12. A per-row "changed" flash animation on the live roster.
13. A separate `Mazeret bildirenler` card above the roster (the excused rows with their reasons already show it). A memberships history table.

## 3. Final acceptance criteria (e2e)

Setup: `sef@` = conductor, `yk@` = board, `korist@` = member (alto). The seed follows db §4 plus one more rehearsal, **opened yesterday and never closed**, for AC 23. The seed file documents the expected report numbers. Tests may create rehearsals relative to "now". Stable hooks: `data-testid="live-code"`, accessible names for `StatusSegment` (`<name> yoklama durumu`).

### Calendar
1. A manager creates a single tutti rehearsal (date, start, end, location). `korist@` sees it in `/calismalar` with the Istanbul date/time and the location.
2. A manager creates a weekly series whose `Son tarih` is exactly 4 weeks after the first date. The preview reads `5 çalışma`, the submit button reads `5 çalışmayı ekle`, and exactly 5 occurrences appear.
3. A manager cancels an occurrence. Members see `İptal edildi` with no `Geldim`/`Gelemeyeceğim`, and it is excluded from reports. `İptali geri al` restores it, including any excuse made before.
4. `Seriyi bitir` on occurrence 2 of 5 deletes occurrences 3–5, **including one with an advance excuse**. Occurrences 1–2 remain.
5. A sectional for Tenor+Bas: a bass member sees it as theirs; `korist@` sees `Senin partisyonun değil`, has no `Gelemeyeceğim`, it is not their home hero, and it is not in their denominator.
6. As `korist@`: `/calismalar/yeni`, `/calismalar/[id]/canli` and `/raporlar` redirect away; the live-poll route and `/raporlar/csv` return 401/403; and calling the create, mark, close and bulk actions returns `Bu işlem için yetkin yok.` with nothing written.

### Self check-in
7. A manager opens the live screen. A 4-digit code, a QR and `… sonra geç sayılır` are visible, and after ≥31 s the code text changes. `?gorunum=kod` shows the code and QR and **no member names**.
8. `korist@` (a second browser context) sees `YOKLAMA AÇIK` on home, taps `Geldim` and enters the code from the manager screen. The hero shows `YOKLAMAYA KATILDIN`. Within 10 s the manager screen shows them as `Geldi` and `Geldi n / m` increments.
9. A wrong code shows `Kod hatalı ya da yenilendi. Ekrandaki yeni kodu gir.` and writes nothing. After 5 wrong codes within 5 min, even the correct code shows `Çok fazla hatalı deneme…`.
10. The previous step's code is accepted; a code two steps old is rejected.
11. Opening `/yoklama/kod/<id>?c=<current>` logged out leads to login; after login the check-in is recorded **with no extra tap**, the success state shows, and the URL no longer contains `?c=`. A plain HTTP GET of the same URL with a member's session cookie (no JS) records nothing.
12. A self check-in on a rehearsal that started 20 min ago is recorded as `Geç geldi`. Submitting the same check-in again does not change the status or the time.
13. `korist@` with an advance excuse checks in and becomes `Geldi`, and the reason is gone. A member whom the manager marked `Gelmedi` checks in, sees `Yoklamayı alan kişi seni zaten işaretledi.`, and stays `Gelmedi`.
14. After the manager closes attendance, `Geldim` is gone, and the QR URL shows `Yoklama kapandı`.

### Excuse
15. `korist@` taps `Gelemeyeceğim` with the reason "Sınavım var" and sees `MAZERETİN İLETİLDİ`. The manager's roster for that rehearsal shows `Mazeretli` with the reason before it starts.
16. `Mazereti geri al` returns the member to unmarked. For a rehearsal that has already started, the button is not shown.
17. The reason never appears for another member (pages they can open), in the poll response or in the CSV.

### Manual entry
18. On the live screen the manager sets one member to `Geldi`, `Geç`, `Mazeretli` and `Gelmedi` in turn; each persists after a reload. `İşareti kaldır` clears the mark while attendance is open.
19. `Kalanları geldi işaretle` for Alto marks every unmarked alto `Geldi` and leaves marked altos unchanged. `Geri al` in the toast reverts exactly those rows.
20. `Yoklamayı kapat` opens a dialog with the exact unmarked count. After confirming, all unmarked expected members are `Gelmedi` and the rehearsal shows as closed.
21. On a closed rehearsal the manager changes a member from `Gelmedi` to `Geldi`. The row shows `Düzeltildi · <first name>`, there is no `İşareti kaldır`, and the member's history and the report both reflect the change.
22. A past rehearsal that was never opened shows `Yoklama alınmadı` and is excluded from percentages. After the manager marks a few people on its detail page and closes it, it is included, and the unmarked people are `Gelmedi`.
23. The seeded rehearsal opened yesterday and never closed shows as closed on the next visit to `/calismalar`, with its unmarked members `Gelmedi`.
24. With `context.setOffline(true)` on the live screen, the code keeps changing, a mark shows `Kaydedilmedi` and the offline banner is visible. After `setOffline(false)` the mark saves with no user action and survives a reload.

### Reports and continuity
25. `/raporlar` (default: the current term) shows each expected person's name, part, attended/expected, %, late, excused and absent, matching the seed file's documented numbers. The part tiles show S/A/T/B averages.
26. The seeded member with 2 `Gelmedi` in their last 4 counted rehearsals has the `Uyarı` badge and appears in the warning section. The member whose misses are all `Mazeretli` does not. `Sadece uyarılılar` filters to flagged people only.
27. Switching the period to another term or to `Son 90 gün` recalculates the table. A manager can add a term in the `Dönemler` dialog, and it appears in the selector. An overlapping term is rejected with `Dönemler çakışamaz.`
28. `CSV indir` downloads a file that starts with a UTF-8 BOM, uses `;`, has the D27 header row and one row per person matching the table. A member named `=1+1` appears as `'=1+1`.
29. `korist@` sees their own term percentage and history under `/calismalar` → `Geçmiş`, and the numbers match their report row. The flagged seed member sees the gentle `bg-accent` text, with no word "uyarı".
30. A member whose `Koroya katılış tarihi` is set to today is not expected at past rehearsals (not on their roster and not in their denominator). The member form requires `Partisyon` for the `Korist` and `Yönetim kurulu` roles.

### Permissions carried over
31. `yk@` cannot create a reset link for another board member or for themselves, and cannot give anyone the `board` role. `sef@` can.

### Quality
32. All new screens have no horizontal scroll at 375 px in light and dark. The live screen works at 1024×768 landscape with a code font ≥ 96 px.
33. `npm run lint`, `npm run typecheck` and `npm run e2e` pass.
