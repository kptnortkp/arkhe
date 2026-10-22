# Phase 10 spec: Web Push notifications

Author: PO. Date: 2026-10-22. Status: **draft for team feedback.** My initial decisions are in `po-decisions.md` (D64–D90). The spec refers to them as `(Dn)`. After the team's replies I amend this file in place, mark changed ACs `(amended Dn)` and never renumber.

> **Ordering: implement this phase only after Phases 7, 8, 8b and 9 are live.** The local HEAD is `99eea25` and is not pushed. Production still runs Phases 0–6 (migrations 0000–0006). Phase 10 hooks into code from Phases 7–9: the backup cron, board tickets, budgets, recordings, assistants and the storage gauge. Its migration is `drizzle/0012_…`, after 0011. Before the first line of Phase 10 code, `db:check` on Turso must show `migrations=12/12` and the Phase 7–9 go-live list must be done (D64).

Inputs:
- **The user's approved list of 2026-10-22:**
  - triggers 1–22, with on/off defaults;
  - personal settings;
  - timing option A.
- **Docs:** `design/STATUS.md`, `design/TEAM.md`, and the format of `design/phase-9/po-spec.md` and `po-decisions.md`.
- **Code spot-checked:**
  - `src/db/schema.ts`: `rehearsals.cancelled_at`, `rehearsal_parts`, `attendance.method = 'auto'`, `assignments`, `assignment_parts`, `submissions.feedback*`, `board_tickets`, `board_ticket_events`, `budgets`, `dues_periods`, `app_settings` with its key CHECK, `recordings`.
  - Rehearsals and attendance: `src/app/(portal)/calismalar/actions.ts` (`createRehearsal`, `updateRehearsal`, `setCancelled`, `endSeries`, `openAttendance`, `closeAttendance`, `submitExcuse`), `src/lib/attendance/close.ts` (`closeRehearsal`, `autoCloseStale`), `roster.ts` (`isExpected`), `rehearsals.ts`.
  - Homework and review: `src/app/(portal)/odevler/actions.ts` (`createAssignment`, `saveFeedback`), `kayit-actions.ts`, `src/lib/homework/eligibility.ts`, `src/lib/review/*` (`assistantQueueCount`, `conductorCounts`).
  - Board: `src/app/(portal)/yonetim/actions.ts` and `src/lib/board/*`.
  - Finance: `src/app/(portal)/finans/butce/actions.ts` (`createBudget`, `savePlan`, `approveBudget`), `src/lib/finance/budget.ts`, `src/app/(portal)/finans/aidat/actions.ts`, `src/components/finance/my-dues.tsx` (`#aidat`).
  - Backup and storage: `src/lib/backup/run.ts`, `src/lib/storage/quota.ts`, `sweep.ts`, `hooks.ts`.
  - Cron: `src/app/api/cron/aylik-yedek/route.ts` and `vercel.json` (one cron, `0 5 * * *`, region `arn1`).
  - PWA: `public/sw.js` (VERSION `arkhe-v1`, the KILL switch), `src/app/manifest.ts`, `src/components/install-card.tsx`, `src/components/pwa-boot.tsx` (the worker is registered in production only), `src/lib/pwa-store.ts`.
  - Headers: `next.config.ts` (`Permissions-Policy`, the `/sw.js` CSP) and `src/proxy.ts` (`connect-src 'self'`, `worker-src 'self'`).
  - `src/lib/auth/session.ts` (90-day sessions).
- **Docs and packages:**
  - `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`.
  - `npm view web-push` on 2026-10-22: **3.6.7, licence MPL-2.0** (not MIT), last published 2024-01-16, Node ≥ 16; its dependencies are `asn1.js`, `http_ece`, `https-proxy-agent`, `jws` and `minimist`.

Fixed constraints (not up for discussion):
1. **Zero budget.**
   - Web Push with VAPID is free on every push service: FCM, Apple and Mozilla.
   - No paid notification SaaS, no OneSignal or Firebase SDK, no SMS.
   - Libraries must be free and open source (D65).
2. **Push is best effort.** Every fact a notification carries must already be visible in the portal (D86). A user who never turns notifications on loses nothing but the buzz.
3. **Authorize on the server.** Recipients are computed on the server from the same rules the pages use: `isExpected`, `isEligible`, the review scope and the manager roles. Subscriptions and preferences belong to the logged-in user only.
4. **Privacy.**
   - The payload carries only what a locked screen may show (D82).
   - Never in any payload:
     - assistant notes;
     - comment text;
     - excuse notes;
     - money amounts;
     - budget revision reasons;
     - email addresses or phone numbers.
5. **Never slow down or fail the user's action.** Sending happens after the response, through `after()`. A failure or a slow push service changes nothing for the person who tapped the button (D68).
6. **Vercel Hobby.**
   - One cron a day at 05:00 UTC, which fires between 08:00 and 08:59 Istanbul. No second cron in `vercel.json`.
   - Functions have 60 s.
   - Every scheduled notification is a morning one (timing option A, D69).
7. **e2e only.**
   - Real push services can't run in e2e. Outside production every send goes to a file outbox, like Phase 7's email (D66).
   - The service worker's `push` and `notificationclick` handlers are checked in `e2e:prod` through Chrome's DevTools protocol (D88).
8. **The migration is additive.** `0012` only creates tables and indexes. It never rebuilds a live table, `app_settings` included (D80).

## 1. Problem

The portal knows things before the choir does, and nobody hears about them unless they open it:

- **Attendance opens, and half the alto section is still in the corridor.** They find out when the conductor shouts "kodu girin".
- **A rehearsal moves from Salı 19:30 to Çarşamba 19:00, or is cancelled.** Today it goes to WhatsApp, where it drowns in 200 messages, and three people come to a locked hall.
- **Homework deadlines** pass because nobody opened `/odevler` that week. The conductor's comment sits unread for days. The `Yeni not` dot only works for people who come back anyway.
- **Assistants and the conductor have a listening queue** (Phase 9) that nobody looks at until Sunday night.
- **Board tickets** (Phase 8) were meant to move jobs out of WhatsApp. If a new or urgent ticket makes no sound, WhatsApp wins again.
- **Silent failures:** the monthly backup failing or the storage filling up is only visible to someone who opens `/yedek` or `/odevler/depolama`.

The user approved a list of 22 triggers, per-group switches, quiet hours, several devices per person and a test button. Scheduled reminders come only from the existing daily cron (option A).

## 2. Users and roles

No new role. Who receives what follows the existing roles and appointments. The group switches each person sees depend on their role (D72).

| Who | In this phase they… |
|---|---|
| **Korist** (and board members as singers) | Turn notifications on per device from `Profilim`. Get rehearsal, attendance, homework and comment notifications, plus repertoire news and dues reminders if they choose and the board allows. Set group switches and quiet hours. Remove old devices. Send a test. |
| **Dinleme asistanı** | Everything a korist gets, plus a morning line about their listening queue. |
| **Yönetim kurulu** | Everything a korist gets, plus board tickets (new, assigned, comments, moves, due, urgent) and budget events. Turn the choir-wide dues reminders on or off on `/finans/ayarlar`. |
| **Şef** | Rehearsal announcements (not attendance, since the conductor isn't on the roster), the review queue line, board tickets, budget events, and the system alerts: backup failure and storage. |
| **Machine** | The daily cron builds the morning notifications, delivers the night's held items, retries failed sends, prunes old rows, and checks the storage and dues conditions. |

## 3. Key product decisions (summary; details and reasons in `po-decisions.md`)

- **D66: Outbox outside production.**
  - Outside production, sends never touch the network. Each send is a JSON file in `data/push-outbox/`.
  - Fake subscriptions use the host `push.invalid`. A path suffix chooses the simulated answer: `/ok`, `/gone` (410), `/notfound` (404), `/fail` (500) or `/slow` (no answer within the timeout).
  - Production refuses that host.
- **D67: Push endpoints must be on an allowlist** (protection against SSRF). Endpoints must be `https:` on a known push service. Keys are validated.
- **D68: Sending happens after the response.**
  - The action writes `notifications` rows, one per recipient, and an `after()` callback sends them.
  - Unsent rows are retried by the next dispatcher run until they expire.
  - Every kind has an expiry, which is also the Web Push `TTL`.
- **D69: The dispatcher.**
  - The daily cron route runs the dispatcher after the backup and before the storage sweep. The reply stays `{ status }`.
  - A second route, `/api/cron/bildirimler`, runs only the dispatcher, behind the same bearer secret. It is not scheduled now; an external trigger such as cron-job.org can call it later with no code change.
  - Morning work runs once per Istanbul day, on the first run at or after 08:00.
- **D70: One morning notification per person.**
  - The morning's digest lines and the items held overnight go out as one notification, titled `Bugün Arkhe'de`.
  - Someone with exactly one item gets that item's own notification.
- **D71: Quiet hours are a switch with a fixed window**, 22:00–08:00 Istanbul, on by default. The times can't be edited, because the only delivery after the window is the 08:00–08:59 cron. *(A change from the user's list.)*
- **D72: Groups and defaults** are in the table in §4.
- **D73: Cancellation** is the existing `rehearsals.cancelled_at`.
  - Undoing a cancellation notifies too.
  - `Seriyi bitir` (`endSeries`), which deletes future occurrences, counts as a cancellation.
- **D75: Trigger 6 can't offer "add an excuse".** The portal refuses excuses once a rehearsal has started (`submitExcuse`). The notification therefore says to tell the person who took attendance. *(A change from the user's list.)*
- **D77: Repertoire news (trigger 12) is a morning line only**, never sent at once. A bulk paste of 20 links must not mean 20 buzzes. *(A change in timing.)*
- **D78: Board tickets.**
  - A ticket raised to `Acil` later is treated like a new urgent ticket. *(An addition.)*
  - Urgent bypasses quiet hours, but it still follows the person's `Yönetim işleri` switch.
- **D79: Budgets have no "submitted for approval" state**, because any manager can approve a draft. Trigger 20 therefore fires on three events:
  - a new draft (`onay bekliyor`);
  - an approval;
  - a revision of an approved budget.

  *(A change from the user's list.)*
- **D80: Dues reminders.**
  - A choir-wide switch on `/finans/ayarlar`, off by default, decides whether dues reminders exist at all.
  - "Period opened" means the period's `starts_on` day has come, not that the row was created: periods are bulk-created ahead.
  - The overdue reminder goes out at most once every 30 days per person.
- **D81: System alerts.**
  - Only a cron backup failure notifies; a manual send shows its own error.
  - Storage notifies at 80% and again at 95% (uploads stop), once per crossing. *(The 95% alert is an addition.)*
- **D83: Turning notifications on.**
  - Opt-in lives on `Profilim` under `Bildirimler`, with a dismissible nudge card on the home page.
  - On an iPhone outside the installed app, the flow leads to `Ana ekrana ekle` first.
- **D84: Devices.**
  - At most 10 per person.
  - An endpoint belongs to the last user who subscribed it.
  - Logging out removes this device's subscription. Deactivating a person removes all of theirs.
  - A 404/410 answer deletes the subscription.
- **D86: No notification inbox.** Deep links land on pages that already show the fact.

## 4. Triggers, recipients, copy and deep links

**Conventions**
- **Copy:** everything in backticks is the exact Turkish text.
- **Placeholders:**
  - `{çalışma}` is `rehearsalTitle()`, e.g. `Koro çalışması`, `Soprano + Alto partisyon çalışması`, `Genel prova`, `Konser`, or the custom title.
  - `{gün}` is `Intl.DateTimeFormat("tr-TR", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Istanbul" })`, e.g. `Çar 29 Eki`.
  - `{saat}` is `HH:mm`, Istanbul time.
  - `{yer}` is the location. When it's empty, the ` · {yer}` part is dropped.
  - `{eser}` is the piece title.
  - `{no}` is the ticket number.
  - `{başlık}` is the ticket title, cut to 60 characters plus `…`.
  - `{kişi}` is the actor's full name.
- **Lengths:** titles ≤ 40 characters and bodies ≤ 140 after substitution. Longer substitutions are cut with `…`.
- **"Line":** the text the item contributes to the combined morning notification (D70).
- **"Tag":** the Web Push / Notification `tag`. A newer notification with the same tag replaces the older one on the device.
- **Exclusions for every trigger:**
  - The actor never receives their own event.
  - Inactive users never receive anything (`left_at` set).
  - A person whose group switch is off receives nothing for that group.
- **Timing:**
  - **"At once":** sent after the action's response, unless the recipient is in quiet hours (then held until morning).
  - **"Morning":** built by the first dispatcher run of the Istanbul day at or after 08:00.

### Group switches (D72)

| Key | Switch label (`Profilim › Bildirimler`) | Triggers | Shown to | Default |
|---|---|---|---|---|
| `calisma` | `Çalışma ve konser duyuruları` | 1, 2, 3, 4, 5 | everyone | on |
| `devamsizlik` | `Gelmedi olarak işaretlendiğimde` | 6 | everyone with a voice part | **off** |
| `odev` | `Ödevler ve şef yorumları` | 7, 8, 9 | everyone with a voice part | on |
| `dinleme` | `Dinleme kuyruğu` | 10, 11 | the conductor and appointed assistants | on |
| `repertuvar` | `Repertuvar yenilikleri` | 12 | everyone | **off** |
| `yonetim` | `Yönetim işleri` | 13–18 | the conductor and the board | on |
| `aidat` | `Aidat hatırlatmaları` | 19 | everyone, **only while the board's switch is on** | on (inside the board's switch, which is off by default) |
| `butce` | `Bütçe` | 20 | the conductor and the board | on |
| `sistem` | `Yedek ve depolama uyarıları` | 21, 22 | the conductor | on |
| — | `Gece sessiz (22:00–08:00)` | quiet hours | everyone | on |

### Rehearsals, concerts, attendance

| # | When | To | Title | Body | Line | Link | Tag |
|---|---|---|---|---|---|---|---|
| 1 | At once, when `openAttendance` actually opens it (the first opener only) | Everyone `isExpected` for this rehearsal (sectional parts honoured), minus anyone who already has a mark (e.g. a sent excuse), minus the opener | `Yoklama açıldı` | `{çalışma} · {saat}{ · {yer}}. Yoklamaya katılmak için dokun.` | `Yoklama açık: {çalışma}` | `/yoklama` | `yoklama-{id}` |
| 2 | Morning, for each non-cancelled rehearsal starting today that isn't a concert | Expected members plus the conductor | `Bugün çalışma var` | `{çalışma} · {saat}–{bitiş}{ · {yer}}` | `Bugün {saat}: {çalışma}{ ({yer})}` | `/calismalar/{id}` | `bugun-{id}` |
| 3a | Morning of the day before a `concert` | Expected members plus the conductor | `Yarın konser` | `{çalışma} · {gün} {saat}{ · {yer}}` | `Yarın konser: {çalışma}, {saat}{, {yer}}` | `/calismalar/{id}` | `konser-{id}` |
| 3b | Morning of a `concert` day (replaces 2 for that event) | Same | `Bugün konser` | `{çalışma} · {saat}{ · {yer}}` | `Bugün konser: {çalışma}, {saat}{, {yer}}` | `/calismalar/{id}` | `konser-{id}` |
| 4a | At once, after `createRehearsal`, when the first occurrence starts in the future | Expected for the first occurrence | `Yeni çalışma` | One: `{çalışma} · {gün} {saat}{ · {yer}}`. Series: `{çalışma} · her {haftanın günü} {saat}, {ilk gün}–{son gün}` | `Yeni çalışma: {çalışma}, {gün} {saat}` | One: `/calismalar/{id}`. Series: `/calismalar` | `calisma-{id or seriesId}` |
| 4b | At once, after `updateRehearsal` of a future rehearsal whose start day/time, end time or location changed | The union of the people expected before and after the edit | `Çalışma değişti` | `{çalışma}: artık {gün} {saat}{ · {yer}}` | `Değişti: {çalışma}, artık {gün} {saat}` | `/calismalar/{id}` | `calisma-{id}` |
| 5a | At once, `setCancelled(id, true)` on a future rehearsal | Expected | `Çalışma iptal` | `{gün} {saat} {çalışma} yapılmayacak.` | `İptal: {gün} {saat} {çalışma}` | `/calismalar/{id}` | `calisma-{id}` |
| 5b | At once, `setCancelled(id, false)` on a future rehearsal | Expected | `Çalışma yeniden programda` | `İptal geri alındı: {gün} {saat} {çalışma} yapılacak.` | `İptal geri alındı: {gün} {saat} {çalışma}` | `/calismalar/{id}` | `calisma-{id}` |
| 5c | At once, `endSeries` deleted ≥ 1 future occurrence | The union of those expected at the deleted occurrences | `Haftalık çalışmalar bitti` | `{çalışma}: {gün} sonrasındaki {n} çalışma yapılmayacak.` | `Seri bitti: {çalışma} ({n} çalışma)` | `/calismalar` | `seri-{seriesId}` |
| 6 | At once, when attendance closes (`closeAttendance`, or `autoCloseStale` on a later page load) | Each person the close recorded as `absent` with `method = 'auto'` | `Gelmedi olarak kaydedildin` | `{çalışma}, {gün}. Mazeretin varsa yoklamayı alana ilet.` | `Gelmedi: {çalışma}, {gün}` | `/calismalar/{id}` | `devamsiz-{id}` |

### Homework and recordings

| # | When | To | Title | Body | Line | Link | Tag |
|---|---|---|---|---|---|---|---|
| 7 | At once, after `createAssignment` | `isEligible` singers of the target parts, minus the creator | `Yeni ödev` | `{eser}{ · ölçü {a}–{b}} · son gün {gün} {saat}` | `Yeni ödev: {eser}, son gün {gün}` | `/odevler/{id}` | `odev-{id}` |
| 8a | Morning, 2 Istanbul days before the due day | `isEligible` singers without a submission (any method) | `Ödevin 2 gün sonra bitiyor` | `{eser} · son gün {gün} {saat}. Kaydını yap.` | `2 gün kaldı: {eser}` | `/odevler/{id}#kayit` | `odev-son-{id}` |
| 8b | Morning of the due day, only if `due_at` is still in the future | Same | `Ödevin bugün bitiyor` | `{eser} · son saat {saat}. Kaydını yap.` | `Bugün son gün: {eser} ({saat})` | `/odevler/{id}#kayit` | `odev-son-{id}` |
| 9 | At once, `saveFeedback` outcome `sent` (first comment, including after a delete and resend). An edit (`updated`) sends nothing (D76) | The singer only | `Şeften yorum var` | `{eser} ödevin için. Okumak için dokun.` | `Şeften yorum: {eser}` | `/odevler/{id}` | `yorum-{id}` |
| 10 | Morning, if the `Dinlenecek` count is > 0 | Each appointed assistant (`assistantQueueCount`) | `Dinleme kuyruğun` | `{n} kayıt dinlenmeyi bekliyor.` | `Dinleme kuyruğun: {n} kayıt` | `/odevler/dinle` | `dinleme` |
| 11 | Morning, if live recordings without a conductor comment > 0 | The conductor | `Yorum bekleyen kayıtlar` | `{n} kayıt yorum bekliyor{; {k} tanesinde asistan notu var}.` | `Yorum bekleyen: {n} kayıt{ ({k} asistan notlu)}` | `/odevler/dinle` | `dinleme` |
| 12 | Morning, if since the previous morning run any piece was created, or any link or MIDI file was added | Everyone with `repertuvar` on | `Repertuvarda yenilik` | One piece: `{eser}: {yeni eser \| {n} yeni dosya}`. Several: `{n} eserde yenilik: {eser1}, {eser2}…` | `Repertuvar: {n} eserde yenilik` | One piece: `/repertuvar/{id}`. Several: `/repertuvar` | `repertuvar` |

For 11, `{n}` counts submissions with a live recording and no conductor comment. `Portalda kayıt yok` rows are left out, so the line doesn't nag forever about the past (Phase 9 D50). `{k}` is the `Asistan notlu` count.

### Board kanban

| # | When | To | Title | Body | Line | Link | Tag |
|---|---|---|---|---|---|---|---|
| 13 | At once, `createTicket` with urgency other than `urgent` | The conductor and the board, minus the author | `Yeni iş #{no}` | `{başlık} · {kişi}` | `Yeni iş #{no}: {başlık}` | `/yonetim/{no}` | `is-{no}` |
| 18 | At once, `createTicket` with `urgent`, or `updateTicket` raising urgency to `urgent` (D78). **Never held by quiet hours**; Web Push `Urgency: high` | Same as 13 (for a raise: minus the person who raised it) | `Acil iş #{no}` | `{başlık} · {kişi}` | — (never held, so never a line) | `/yonetim/{no}` | `is-{no}` |
| 14 | At once: created with an assignee, or the assignee changed to someone, unless the actor assigned themselves | The new assignee | `Sana iş atandı #{no}` | `{başlık}{ · son gün {gün}}` | `Sana atandı #{no}: {başlık}` | `/yonetim/{no}` | `is-{no}` |
| 15 | At once, `addComment` | The ticket's author and its assignee, minus the commenter | `#{no} işine yorum` | `{kişi} yorum yazdı: {başlık}` | `Yorum #{no}: {başlık}` | `/yonetim/{no}` | `is-{no}` |
| 16 | At once, `moveTicket` or `updateTicket` to `blocked` or `done` | The author, unless they made the move | `#{no} Takıldı` / `#{no} Bitti` | `{başlık} · {kişi} taşıdı.` | `#{no} {Takıldı\|Bitti}: {başlık}` | `/yonetim/{no}` | `is-{no}` |
| 17 | Morning, for the assignee's tickets not `done` that are overdue (`due_on` < today) or due today or tomorrow | The assignee | `İşlerin` | Only the non-zero parts, joined with `, `: `{a} iş bugün`, `{b} iş yarın`, `{c} iş gecikti` | `İşlerin: {same text}` | `/yonetim?kim=ben` | `islerim` |

When one action triggers several of 13/14/15/16/18 for the same person, that person gets one notification. The precedence is **18 > 14 > 16 > 15 > 13**. Example: a new urgent ticket assigned to you gives only `Acil iş`.

### Finance and administration

| # | When | To | Title | Body | Line | Link | Tag |
|---|---|---|---|---|---|---|---|
| 19a | Morning of a dues period's `starts_on`, **only while the board's switch is on** | Active members with a voice part, conductor excluded, who aren't waived for that period | `Aidat dönemi başladı` | `{dönem}. Ödeme bilgisi Profilim'de.` | `Aidat dönemi başladı: {dönem}` | `/profil#aidat` | `aidat` |
| 19b | Morning, while the person has an amount `Aidatım` shows as late, at most once every 30 days, only while the switch is on | That person | `Aidat hatırlatması` | `Ödenmemiş aidatın görünüyor. Ayrıntılar Profilim'de.` | `Aidat: ödenmemiş dönem var` | `/profil#aidat` | `aidat` |
| 20a | At once, `createBudget` | The conductor and the board, minus the creator | `Yeni bütçe taslağı` | `{ad} · {kişi} oluşturdu. Onay bekliyor.` | `Bütçe taslağı: {ad}` | `/finans/butce/{id}` | `butce-{id}` |
| 20b | At once, `approveBudget` that actually approved | Same, minus the approver | `Bütçe onaylandı` | `{ad} · {kişi} onayladı.` | `Bütçe onaylandı: {ad}` | `/finans/butce/{id}` | `butce-{id}` |
| 20c | At once, `savePlan` on an approved budget (a revision was written) | Same, minus the reviser | `Bütçe değişti` | `{ad} · {kişi} planı değiştirdi.` | `Bütçe değişti: {ad}` | `/finans/butce/{id}` | `butce-{id}` |
| 21 | In the cron run, when `runMonthlyBackup({ trigger: "cron" })` returns `failed` | The conductor | `Aylık yedek gönderilemedi` | `{ay} yedeği gitmedi. Yarın sabah yeniden denenecek.` | `Yedek gönderilemedi ({ay})` | `/yedek` | `yedek` |
| 22a | In the cron run, when any storage meter is ≥ 80% and it wasn't ≥ 80% at the previous alert check | The conductor | `Kayıt alanı %{n} dolu` | `Depolama sayfasına bak; gerekirse eski kayıtları erken sil.` | `Kayıt alanı %{n} dolu` | `/odevler/depolama` | `depolama` |
| 22b | Same, at ≥ 95% (uploads stop) | The conductor | `Kayıt alanı dolu` | `Yeni kayıt yüklenemiyor. Depolama sayfasına bak.` | `Kayıt alanı dolu; yükleme durdu` | `/odevler/depolama` | `depolama` |

### Other copy

| Notification | Title | Body | Link | Tag |
|---|---|---|---|---|
| Test | `Deneme bildirimi` | `Bildirimler bu cihazda çalışıyor.` | `/profil#bildirimler` | `deneme` |
| Combined morning (2+ items, D70) | `Bugün Arkhe'de` | Up to 4 lines, one per item, in the order of this section, joined with `\n`, then `+{n} bildirim daha` when there are more | `/` | `sabah` |
| Fallback when the payload is unreadable (shown by the service worker) | `Arkhe` | `Portalda yeni bir şey var.` | `/` | `arkhe` |

## 5. Expiry and retry (D68)

Each notification row has an `expires_at`. A row isn't sent after it expires: it is marked `dropped`. The Web Push `TTL` is the time left until `expires_at`, capped at 24 h.

| Kind | Expires |
|---|---|
| 1 | The rehearsal's `openUntil` |
| 2, 3b | The rehearsal's start |
| 3a | The concert's start |
| 4, 5 | The (first) rehearsal's start |
| 6 | 48 h |
| 7 | The due time |
| 8 | The due time |
| 9 | 7 days |
| 10, 11, 12, 17 | The end of that Istanbul day |
| 13–16 | 3 days |
| 18 | 24 h |
| 19, 20 | 3 days |
| 21, 22 | 24 h |
| Test | 10 min |

A failed send (5xx, timeout or network) is retried on the next dispatcher run, up to 3 attempts per device, while the row hasn't expired. A 404/410 deletes the subscription and doesn't count as a failure.

## 6. User stories and acceptance criteria

**e2e conventions**
- **Fake subscriptions:** the subscribe action accepts `https://push.invalid/e2e/<uuid>/<ok|gone|notfound|fail|slow>`, but only where the test hooks are enabled (`NODE_ENV !== "production"` and a `file:` database, the 8b rule), D66.
- **The outbox:** each attempted send writes one JSON file to `data/push-outbox/`, with `{ notificationId, userId, subscriptionId, ttl, urgency, topic, payload }`. This includes simulated failures, which carry `{ result }`.
- **The clock hook:** `arkhe_e2e_clock=<ISO>` (cookie, for actions) and `?simdi=<ISO>` (on the cron routes) set "now" for notification timing only. Both follow the same hook rule.
- **Push fault hook:** the cookie `arkhe_e2e_push_fault=throw|slow` makes the sender throw or hang for every endpoint.
- **"Arrange"** means the test writes DB state directly.
- **Cleanup:** every suite removes its own rows and outbox files.

### S1. Platform, privacy and security (D64–D68, D82)

*As a singer I want notifications that can't be abused and don't show my private things on a locked screen.*

1. **Additive migration.**
   - `drizzle/0012_*.sql` only creates new tables and indexes:
     - push subscriptions;
     - per-user group preferences, with quiet hours;
     - the notifications outbox, with a unique (user, dedupe key);
     - the choir-wide dues switch, outside `app_settings` (D80).
   - It has no `ALTER`, `DROP` or `__new_` rebuild of an existing table.
   - `npm run db:migrate` on a copy of a Phase 9 database succeeds, and `db:check` shows `migrations=13/13`.

   (script: grep the SQL; migrate a snapshot.)
2. **VAPID configuration** (D90).
   - Without `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` in production, the app still boots. The `Bildirimler` section then shows `Bildirimler henüz açılmadı.` with no button. No notification row is ever sent; rows are written and marked `dropped`.
   - With the keys set, only the public key reaches the browser. The private key appears in no HTML, RSC or client JS chunk.

   (e2e:prod: once without the keys and once with dev keys; grep the `.next/static` chunks.)
3. **The outbox outside production** (D66). With the hooks enabled, a send to a `push.invalid` endpoint writes exactly one outbox file and makes no outbound HTTP request. `/gone` and `/notfound` act as 410 and 404, `/fail` as 500, and `/slow` hangs past the 10 s send timeout.

   (e2e: outbox files; DB rows.)
4. **Endpoint allowlist** (D67).
   - These are refused with `Bu bildirim adresi kabul edilmedi.`, and no row is written:
     - an `http:` URL;
     - `https://localhost/…`, `https://127.0.0.1/…`, `https://10.0.0.1/…`;
     - an IP-literal host;
     - a host off the list;
     - a `p256dh` that isn't a 65-byte base64url P-256 point;
     - an `auth` that isn't 16 bytes;
     - an endpoint over 1024 characters.
   - `push.invalid` is accepted only where the hooks are enabled. `e2e:prod` gets the refusal.

   (e2e: direct action calls; e2e:prod.)
5. **Authorization.**
   - Logged out, the subscribe, unsubscribe, remove-device, preference and test actions all refuse with `Bu işlem için yetkin yok.` and write nothing.
   - korist@ calling remove-device with sef@'s subscription id gets `Cihaz bulunamadı.`, and the row stays.
   - Setting a group the role doesn't show is refused and writes nothing: korist@ with `yonetim`, yk@ with `sistem`, a non-assistant member with `dinleme`.
   - No page or RSC payload for any user contains another user's endpoint.

   (e2e: direct calls; grep.)
6. **Payload shape.**
   - Every outbox payload is JSON with exactly the keys `title`, `body`, `url`, `tag`, and is ≤ 1024 bytes.
   - `url` starts with a single `/`.
   - Titles are ≤ 40 characters and bodies ≤ 140.

   (e2e: over all outbox files the suite produced.)
7. **Nothing private in a payload** (D82).
   - With unique markers in an assistant note, a conductor comment, a ticket comment, an excuse note and a budget revision reason, and after running every trigger in this spec plus two morning runs, no outbox payload contains any marker.
   - No payload contains `@`, `₺`, `TL` or a digit sequence equal to any dues or budget amount in the DB.
   - Assistants' and the conductor's lines carry counts only.

   (e2e: marker grep across the whole outbox.)
8. **Sending never slows or breaks the action** (D68).
   - Arrange 40 expected singers with one `/slow` device each. sef@'s `Yoklamayı başlat` still reaches `/calismalar/<id>/canli` within 3 s.
   - With `arkhe_e2e_push_fault=throw`, these actions still show their usual success and commit their change:
     - `openAttendance`;
     - `setCancelled`;
     - `createAssignment`;
     - `saveFeedback`;
     - `createTicket`;
     - `addComment`;
     - `approveBudget`.
   - The affected notification rows stay unsent and are retried later (AC 50).

   (e2e: timing and DB.)
9. **Expired subscriptions** (D84).
   - After a send, a `/gone` or `/notfound` device row is deleted.
   - A `/fail` device row stays, with its failure count raised.
   - An `/ok` device row records `last_success_at`.
   - A device that has failed 10 times in a row over at least 14 days is deleted by the cron.

   (e2e: DB.)

### S2. Turning it on, devices and preferences (D71, D72, D83–D85)

*As an alto I want to switch on the notifications I care about in one tap, and quiet them at night.*

10. **The `Bildirimler` section on `/profil`** (`id="bildirimler"`, under `Telefonuna ekle`). Each state is forced in the test:
    - **Unsupported** (init script deletes `PushManager`): `Bu tarayıcı bildirim göstermiyor. Android'de Chrome'u, iPhone'da ana ekrana eklenmiş Arkhe'yi kullan.`
    - **iPhone outside the installed app** (iOS UA, not standalone): `iPhone'da bildirim almak için önce Arkhe'yi ana ekrana ekle, sonra ana ekrandaki Arkhe'yi açıp buraya gel.` It shows the same Safari steps as the install card, and no `Bildirimleri aç`.
    - **iPhone in the app without Push** (iOS < 16.4): `Bildirim için iOS 16.4 ya da daha yeni bir sürüm gerekiyor.`
    - **Not asked yet:** the intro `Yoklama, çalışma değişikliği ve ödevler için telefonuna haber verelim. Bildirim gelmese de her şey portalda durur.` and the button `Bildirimleri aç`.
    - **Denied:** `Bildirim izni kapalı. Telefonunun ayarlarından Arkhe'ye bildirim izni ver, sonra bu sayfayı yenile.`
    - **On:** `Bu cihazda bildirimler açık.` with `Deneme bildirimi gönder` and `Bu cihazda kapat`.

    (e2e: init scripts and UA override; context permissions.)
11. **Permission only from a tap.**
    - Loading `/profil` and `/` never calls `Notification.requestPermission` or `pushManager.subscribe` (spied by an init script).
    - Tapping `Bildirimleri aç` calls both, then saves the subscription.
    - The device appears under `Cihazların` as `<cihaz> · <tarayıcı>` (e.g. `Android · Chrome`, `iPhone · Safari`, `Mac · Chrome`), with `Bu cihaz` and `Eklendi {gün}`.

    (e2e: stubbed `PushManager` returning a `push.invalid` subscription, D88.)
12. **Removing devices.**
    - `Bu cihazda kapat` unsubscribes in the browser and deletes the row: `Bu cihazda bildirimler kapandı.`
    - `Kaldır` on another listed device deletes it, with confirm `{cihaz} kaldırılsın mı?` / `Bu cihaza artık bildirim gitmez.`
    - The list then has no such row.

    (e2e.)
13. **One endpoint, one owner.** korist@ subscribes an endpoint; yk@ then subscribes the same endpoint. The row now belongs to yk@: korist@'s list no longer shows it, and korist@'s notifications no longer go to it.

    (e2e: DB and outbox.)
14. **At most 10 devices.** An 11th subscription for the same user removes the one with the oldest `last_success_at` (or `created_at`).

    (e2e: arrange 10.)
15. **Logout and leaving.**
    - Logging out from a subscribed browser deletes that browser's subscription and no other.
    - Deactivating a member on `/uyeler` deletes all their subscriptions.
    - From then on no row is sent to them.

    (e2e.)
16. **Group switches** (D72).
    - The switches visible per role match §4 exactly:
      - korist@: `Çalışma ve konser duyuruları`, `Gelmedi olarak işaretlendiğimde`, `Ödevler ve şef yorumları`, `Repertuvar yenilikleri`;
      - asistan@: those plus `Dinleme kuyruğu`;
      - yk@: korist@'s four plus `Yönetim işleri` and `Bütçe`;
      - sef@: `Çalışma ve konser duyuruları`, `Dinleme kuyruğu`, `Repertuvar yenilikleri`, `Yönetim işleri`, `Bütçe`, `Yedek ve depolama uyarıları`;
      - `Aidat hatırlatmaları` appears for everyone only while the board switch is on (AC 43).
    - Defaults match §4.
    - A change saves at once (`Kaydedildi.`), survives a reload, and applies to every device of that person.
    - With `Ödevler ve şef yorumları` off, korist@ gets nothing for 7, 8 or 9.
    - Everyone sees the switches, even without a device, under the hint `Bildirimleri bir cihazda açınca bu ayarlar geçerli olur.`

    (e2e at 375 px.)
17. **Quiet hours switch.** `Gece sessiz (22:00–08:00)` is on by default, with the help text `Bu saatlerde gelenler sabah 08:00–09:00 arası tek bildirimde gelir.` Managers also see `Acil yönetim işleri beklemez.` Turning it off makes a 23:30 event go at once (AC 49).

    (e2e.)
18. **Test button** (D85).
    - `Deneme bildirimi gönder` sends `Deneme bildirimi` to every device of the user, ignoring switches and quiet hours. Toast: `Deneme bildirimi gönderildi ({n} cihaz).`
    - A `/gone` device is removed. The toast adds `{k} cihaz artık bildirim almıyor; listeden kaldırıldı.`
    - With no device: the button is disabled with `Önce bu cihazda bildirimleri aç.`
    - The 6th test within 10 minutes: `Çok sık denedin. Biraz sonra tekrar dene.`

    (e2e.)
19. **The home nudge card** (D83).
    - On `/`, a logged-in user sees the card when the browser supports push, permission is `default` and this browser has no subscription:
      - title `Yoklama açılınca haber verelim mi?`;
      - body `Çalışma değişikliği, yoklama ve ödevler için telefonuna bildirim gönderelim.`;
      - buttons `Bildirimleri aç` and `Şimdi değil`.
    - `Şimdi değil` hides it for 30 days on this browser.
    - It never shows when VAPID isn't configured, when permission is `denied`, or when subscribed.
    - On an iPhone outside the installed app the body is `iPhone'da önce Arkhe'yi ana ekrana ekle.`, with a `Nasıl?` link to `/profil#bildirimler` instead of the button.

    (e2e: localStorage; init scripts.)

### S3. The service worker (D87)

20. **Push always shows something** (e2e:prod: CDP `ServiceWorker.deliverPushMessage`, notifications permission granted).
    - A valid payload shows a notification with that `title`, `body` and `tag`, the `/icons/icon-192.png` icon and the monochrome `badge` icon (`registration.getNotifications()`).
    - An empty or non-JSON payload still shows `Arkhe` / `Portalda yeni bir şey var.`
21. **A click opens the right page** (e2e:prod).
    - `notificationclick` focuses an open portal window and navigates it to `url`. With no window open, it opens one.
    - A `url` that doesn't start with exactly one `/` (e.g. `//evil.test`, `https://evil.test`) opens `/`.
    - The notification closes.
22. **The worker update is safe.**
    - `VERSION` is bumped.
    - Every Phase 6 PWA and offline check passes unchanged.
    - `/sw.js` keeps its Phase 6 headers.
    - The page CSP is unchanged: `connect-src 'self'` is enough, because the browser, not the page, talks to the push service.

    (e2e:prod; header compare.)
23. **Re-sync.** On page load, when permission is `granted` and the browser has a subscription the server doesn't know (e.g. the row was deleted), the client registers it again silently, at most once per 24 h per browser. With permission not granted it does nothing.

    (e2e: stubbed `PushManager`; delete the row; reload.)

### S4. Rehearsals, concerts and attendance

*As a tenor I want to know the moment attendance opens, and when a rehearsal moves, without reading WhatsApp.*

24. **Trigger 1: attendance opened.** Arrange a tenor+bass sectional starting in 30 minutes. One tenor has already sent an excuse, and one bass is the board member who opens it.
    - After `Yoklamayı başlat`, every other tenor and bass with a device gets `Yoklama açıldı` with the §4 body, url `/yoklama` and tag `yoklama-<id>`.
    - Sopranos, altos, the conductor, the excused tenor and the opener get nothing.
    - A second `openAttendance` on the already-open rehearsal sends nothing more.

    (e2e: outbox per user.)
25. **Trigger 2: rehearsal today.** On the morning run (`?bugun=` and `?simdi=<day>T08:20+03:00`), each person expected at today's tutti, and the conductor, gets the §4 line. A sectional reaches only its parts. A cancelled rehearsal reaches nobody.

    (e2e.)
26. **Trigger 3: concert.** For a `concert` tomorrow, the morning run sends `Yarın konser`. On the concert day it sends `Bugün konser` instead of `Bugün çalışma var` for that event. A `dress` rehearsal is treated as a rehearsal (2), not a concert.

    (e2e.)
27. **Trigger 4a: added.**
    - A single future rehearsal sends `Yeni çalışma` once to each expected person.
    - A weekly series of 8 sends exactly one notification per person, with the series body and url `/calismalar`.
    - A rehearsal created with a start in the past sends nothing.

    (e2e.)
28. **Trigger 4b: changed.**
    - Moving a future rehearsal from 19:30 to 19:00, or changing its location, sends `Çalışma değişti` (copy in §4) with tag `calisma-<id>` to the union of the people expected before and after.
    - Changing a sectional from Soprano to Soprano+Alto together with the time reaches the altos too.
    - Editing only the title or the note sends nothing.

    (e2e.)
29. **Trigger 5: cancelled** (D73).
    - `İptal et` on a future rehearsal sends `Çalışma iptal`.
    - `İptali geri al` sends `Çalışma yeniden programda`.
    - Cancelling a rehearsal whose start has passed sends nothing.
    - `Seriyi bitir` that deletes 3 future occurrences sends one `Haftalık çalışmalar bitti` per affected person, with `3` in the body.

    (e2e.)
30. **Trigger 6: marked absent** (D75).
    - Off by default: closing attendance sends nothing to anyone.
    - With `Gelmedi olarak işaretlendiğimde` on for korist@ and korist@ unmarked, `Yoklamayı kapat` sends `Gelmedi olarak kaydedildin` to korist@ only.
    - People marked present, late, excused or manually absent get nothing.
    - The same happens when `autoCloseStale` closes it on a later page load.

    (e2e.)

### S5. Homework and recordings

*As an alto I want to be reminded before the deadline only if I haven't sent my take yet.*

31. **Trigger 7: new homework.** An Alto+Tenor homework sends `Yeni ödev` to active altos and tenors (board members included) with a device. It sends nothing to the creator, the conductor, sopranos, basses, inactive users or users without a part.

    (e2e.)
32. **Trigger 8: due soon.**
    - For a homework due 2 Istanbul days after the run day, the morning run sends `Ödevin 2 gün sonra bitiyor` only to eligible singers without a submission. Singers who submitted by recording or by `Teslim ettim`, and those with a manager's mark, get nothing.
    - On the due day it sends `Ödevin bugün bitiyor`, unless `due_at` is already past at the run time.
    - Nothing is sent on the day in between.

    (e2e.)
33. **Trigger 9: the conductor's comment** (D76).
    - sef@'s first `Yorumu gönder` on korist@'s recording sends `Şeften yorum var` to korist@ only. Assistants and the board get nothing.
    - Editing the comment sends nothing.
    - Deleting it and sending a new one sends again.
    - A comment on a `Portalda kayıt yok` submission sends too.
    - The payload never contains the comment text (AC 7).

    (e2e.)
34. **Trigger 10: assistant digest.** On the seed, the morning run gives asistan@ the line `Dinleme kuyruğun: 3 kayıt`, equal to `assistantQueueCount`. An assistant with an empty queue gets no line. A member who isn't appointed gets nothing.

    (e2e.)
35. **Trigger 11: conductor digest.** sef@ gets `Yorum bekleyen: {n} kayıt ({k} asistan notlu)`, with n = live recordings without a comment (no `Portalda kayıt yok`) and k = the `Asistan notlu` count from the seed. When n = 0 there is no line.

    (e2e: compare with SQL.)
36. **Trigger 12: repertoire news** (D77).
    - Off by default.
    - With the switch on, a new piece and 3 new links on another piece added since the previous morning run give one line, `Repertuvar: 2 eserde yenilik`, and nothing at the moment they were added.
    - A morning with nothing new gives no line.

    (e2e.)

### S6. Board kanban

*As a board member I want the job I was given to reach me, and an urgent one to wake me.*

37. **Trigger 13: new ticket.** yk@ creates a `Yüksek` ticket. sef@ and the other board members get `Yeni iş #<no>`; yk@ and every `member` get nothing.

    (e2e.)
38. **Trigger 18: urgent** (D78).
    - At simulated 23:30, with quiet hours on for everyone, a new `Acil` ticket reaches sef@ and the board at once, with Web Push urgency `high`.
    - Raising an existing ticket to `Acil` does the same, except for the person who raised it.
    - A person with `Yönetim işleri` off gets nothing.
    - Lowering a ticket from `Acil` sends nothing.

    (e2e: clock hook, outbox `urgency`.)
39. **Trigger 14: assigned.** Creating a ticket with assignee X, or changing the assignee to X, sends `Sana iş atandı` to X. Assigning yourself, or removing the assignee, sends nothing. A new urgent ticket assigned to X gives X only `Acil iş` (precedence, §4).

    (e2e.)
40. **Trigger 15: comment.** A comment by Z on a ticket opened by A and assigned to B sends `#<no> işine yorum` to A and B, never to Z. A comment by A reaches only B. The payload has no comment text.

    (e2e.)
41. **Trigger 16: moved.** Moving A's ticket to `Takıldı` or `Bitti` (by drag, the `Taşı` menu or the edit form) sends to A, unless A moved it. Moves to `Yapılacak` or `Devam ediyor` send nothing.

    (e2e.)
42. **Trigger 17: due digest.** Arrange B's tickets: 1 due today, 1 due tomorrow, 2 overdue, and 1 overdue but `Bitti`. B's morning line reads `İşlerin: 1 iş bugün, 1 iş yarın, 2 iş gecikti`. Unassigned tickets reach nobody.

    (e2e.)

### S7. Finance and administration

43. **Trigger 19: dues** (D80).
    - `/finans/ayarlar` has `Aidat bildirimleri` (`Yönetim kurulu açarsa koristlere aidat dönemi başlangıcında ve ödenmemiş aidat için ayda en fazla bir hatırlatma gider. Tutar yazılmaz.`), off by default. Managers can change it; a member's direct call is refused.
    - While it's off, no dues notification is ever sent and `Aidat hatırlatmaları` isn't shown on profiles.
    - With it on:
      - the morning run on a period's `starts_on` sends `Aidat dönemi başladı` to non-waived active members;
      - a member with a late period gets `Aidat hatırlatması`, and a second morning run within 30 days doesn't repeat it;
      - payloads contain no amount (AC 7).

    (e2e.)
44. **Trigger 20: budget** (D79). Creating a draft, approving it, and saving a revised plan with a reason each send their §4 notification to the conductor and the board, minus the actor. Members get nothing, and no payload contains an amount or the reason.

    (e2e.)
45. **Trigger 21: backup failure.**
    - A cron run whose backup step fails (Phase 7's fault setup, e.g. no passphrase) sends `Aylık yedek gönderilemedi` to sef@ only.
    - A `sent` or `skipped` run sends nothing.
    - A failed manual `Şimdi gönder` sends nothing; the page already says so.

    (e2e: Phase 7 cron helpers.)
46. **Trigger 22: storage** (D81).
    - Arrange 81% stored. The cron run sends `Kayıt alanı %81 dolu` to sef@ only.
    - The next day at 82% it sends nothing.
    - After a run below 80% and then one at 81%, it sends again.
    - At 96% it sends `Kayıt alanı dolu` once.

    (e2e: arranged storage rows, as in Phase 9 AC 44.)

### S8. Dispatcher, morning run and quiet hours (D68–D71)

47. **The cron reply and the backup are untouched.**
    - With the dispatcher running, the daily cron's reply keys are exactly `["status"]`, and the Phase 7 `backup_runs` behaviour is unchanged (all Phase 7 cron checks pass unedited).
    - The dispatcher runs whether the backup sends, skips or fails.
    - With the dispatcher made to throw (fault hook), the reply is unchanged and the storage sweep still writes its `storage_sweeps` row.

    (e2e: Phase 7 and Phase 9 cron helpers.)
48. **One morning notification per person** (D70).
    - A person with 3 morning items gets exactly one notification: `Bugün Arkhe'de`, the three lines in §4 order, url `/`, tag `sabah`.
    - With 6 items: 4 lines and `+2 bildirim daha`.
    - With exactly one item: that item's own title, body and url.

    (e2e.)
49. **Quiet hours** (D71).
    - At simulated 23:30, a new homework is held (no outbox file) for a singer with quiet hours on, and sent at once to one with them off.
    - The next morning run sends the held item inside that singer's morning notification.
    - A held item that expired overnight is dropped, e.g. `Yoklama açıldı` for a rehearsal whose `openUntil` has passed.
    - Urgent tickets are never held (AC 38).

    (e2e: clock hook.)
50. **Retries and expiry.**
    - A `/fail` device's row is retried on the next dispatcher run, at most 3 attempts in total, then marked `failed`.
    - A row past `expires_at` is marked `dropped` and never sent.
    - A `/slow` send gives up after 10 s, and the run carries on.

    (e2e.)
51. **Idempotent, and ready for a more frequent trigger** (D69).
    - Calling the daily cron twice with the same `bugun` sends each morning item once (unique user + dedupe key).
    - `GET /api/cron/bildirimler`:
      - answers 401 without the bearer and 503 without `CRON_SECRET`;
      - with the bearer it runs only the dispatcher, with no `backup_runs` or `storage_sweeps` row;
      - its reply is `{}` with `Cache-Control: no-store`.
    - Called at simulated 03:00, it sends no morning items and no held items.
    - Called at 08:05, it sends them.
    - Called again at 12:00, it sends nothing new, but delivers an at-once item that was waiting for a retry.
    - `vercel.json` is unchanged.

    (e2e.)
52. **Fits Vercel Hobby.**
    - With 60 active users × 2 `/ok` devices at a 100 ms simulated latency, the attendance fan-out finishes within 15 s of the action.
    - The morning run finishes within 30 s.
    - The whole daily cron call stays under 55 s on the backup day.
    - Sending uses at most 10 concurrent requests.

    (e2e timing, loose; the fake latency is a hook.)
53. **Housekeeping.** The cron deletes notification rows older than 30 days, and outbox files only in dev and e2e cleanup. Logs carry counts and kinds, never endpoints, payloads or names.

    (e2e: DB; grep the dev log for a known endpoint string.)

### S9. Quality and the test round

54. **Phone, themes, accessibility.**
    - At 375 px, in light and dark: the `Bildirimler` section in each AC 10 state, the device list, the switches, the home nudge card, and the `/finans/ayarlar` switch.
    - No horizontal scroll, and targets ≥ 44 px.
    - Switches are labelled `role="switch"` controls with their state announced.
    - The toast region is polite.
    - axe-core is clean, and colours come from tokens only.

    (e2e + axe + grep for raw hex.)
55. **Test round.**
    - `npm run e2e` is green with the new files `e2e/phase10-a-subscribe.mjs`, `phase10-b-triggers.mjs`, `phase10-c-dispatch.mjs` (names may differ). Phase 1–9 checks pass unchanged except those listed with a reason in `design/phase-10/review-fixes.md`.
    - `npm run e2e:prod` is green, including:
      - AC 2, 4, 20 and 21;
      - the clock, fault and fake-latency hooks ignored;
      - `push.invalid` refused.
    - `npm run lint` and `npm run typecheck` are clean.
    - The README has a `Bildirimler` section:
      - generating VAPID keys once (`npx web-push generate-vapid-keys`) and storing them as Production-only Vercel env vars;
      - **never rotate the keys** unless they leak, since rotation silently ends every subscription;
      - the iPhone rule (16.4+, home screen only);
      - the KILL switch in `sw.js` also ends every subscription;
      - how to add a host to the allowlist;
      - `/api/cron/bildirimler` for an optional external trigger.
    - Results go in `design/phase-10/e2e-results.txt`.

## 7. Out of scope (explicitly)

- **Channels:**
  - email, SMS or WhatsApp notifications;
  - native apps;
  - Firebase SDK or any push SaaS.
- **Timing:**
  - reminders at a set time before an event ("1 hour before");
  - a second Vercel cron;
  - any external scheduler wired up now (the route is ready, D69);
  - per-user quiet-hour times (D71).
- **An in-portal notification inbox or bell**, and read/unread state for notifications (D86).
- **Delivery statistics:** "who has notifications on" and per-message delivery reports for managers.
- **Content:**
  - manager-written broadcast messages ("Duyuru gönder");
  - rich notifications (images, action buttons such as `Geldim`);
  - per-rehearsal or per-ticket mute;
  - snooze.
- **New in-portal features the triggers might suggest:**
  - adding an excuse after the rehearsal started (D75);
  - a "submit budget for approval" state (D79);
  - a "changed" marker on rehearsals;
  - homework-edit notifications.
- **The Phase 7 and 8 backlogs** (`phase-7/review-po.md` §5, `phase-8/review-po.md` §5) stay there.

## 8. Open questions for the team

1. **@backend:**
   - Confirm `web-push@3.6.7` (MPL-2.0, D65): its transitive licences, behaviour on Node 20/22 on Vercel, and `TTL`/`Urgency`/`Topic` support. Or argue for our own RFC 8291 (aes128gcm) + RFC 8292 (VAPID) on `node:crypto`, if `web-push`'s 2024 last release or its `https-proxy-agent` dependency worries you.
   - The final push-host allowlist. Mine: `fcm.googleapis.com`, `web.push.apple.com`, `updates.push.services.mozilla.com`, `*.notify.windows.com`. Check Samsung Internet and Opera.
   - `after()` inside server actions that `redirect()` (`openAttendance`, `createRehearsal`): confirm the callback still runs on Vercel and locally.
   - The dispatcher's time budget inside the cron route: backup → dispatcher (stops by `started + 40 s`) → sweep (`started + 55 s`).
   - Should `pushsubscriptionchange` in the worker POST to a small route handler (`/api/bildirim/abonelik`, `sameOrigin` + session), or is the page-load re-sync (AC 23) enough?
   - How the logout form learns this browser's endpoint (AC 15).
2. **@dba:**
   - Tables and keys:
     - `push_subscriptions` (unique endpoint);
     - `notification_prefs` (user, group), where no row means the default;
     - `notifications` (id, user, kind, group, dedupe key unique per user, title, body, url, tag, urgent, created, not_before/held, expires, status, attempts, sent_at);
     - a one-row `notification_settings` for the dues switch, or another way that avoids rebuilding `app_settings`.
   - Where the dispatcher remembers "last morning run day", "last storage alert level" and "last dues reminder per user": rows in the same tables, or a small state table?
   - The pruning indexes.
   - Seed: one fake `push.invalid/…/ok` device for each demo login, so the profile list isn't empty in dev. Is that safe given the production refusal?
3. **@ux:**
   - The `Bildirimler` section's order on `/profil`: under `Telefonuna ekle`, above `Aidatım`?
   - How the iPhone path reads as one story with the install card, without repeating it.
   - The switch list for the conductor (6 rows) at 375 px.
   - The home nudge card's place among the existing home cards.
4. **@ui:**
   - Detecting iOS standalone (reuse `install-card.tsx`'s `isStandalone`/`isIos`).
   - The device label from the UA.
   - The `PushManager` stub for e2e in dev (the worker isn't registered in dev; `pwa-boot.tsx` unregisters it).
   - Generating the monochrome badge icon (96×96, white on transparent) with the existing icon script.
   - CDP `ServiceWorker.deliverPushMessage` in `e2e:prod`.

## 9. Open risks

1. **iPhone adoption.** Push works only in the home-screen app on iOS 16.4+. Many singers never install it. Mitigations: the profile path, the home nudge, and the fact that nothing depends on push (constraint 2). Measure after a month: the share of active users with ≥ 1 device. Ask the board, and record it in STATUS.
2. **Silent subscription loss.** A browser can drop subscriptions: storage cleared, iOS app removed, Android battery savers. So can our KILL switch or a VAPID key change. Mitigations: the re-sync (AC 23), the test button, and the README warnings. People will still say "bildirim gelmedi"; the answer is "Deneme bildirimi gönder".
3. **The morning time drifts.** Vercel Hobby fires at any minute of 05:00–05:59 UTC, so the morning notification comes between 08:00 and 09:00. Some days the cron may not fire at all; then digests are skipped for that day, and held items wait a day or expire. Acceptable for a choir; an external trigger can fix it later (D69).
4. **Notification fatigue.** A board member who is also an assistant could get 6+ things a day. Mitigations: the combined morning notification, the precedence rule, tags that replace, per-group switches, and quiet hours. If people turn everything off, we cut defaults rather than add features.
5. **Lock-screen exposure.** Ticket titles and piece names appear on a locked phone. Board titles are short work items by design. If the board objects, we drop `{başlık}` from 13–17 (a copy change, not a redesign).
6. **The `web-push` package is stale** (last release January 2024) and MPL-2.0. The protocol is stable, and the fallback is our own implementation (§8, question 1).
7. **Push services rate-limit or change policy.** At ~60 users × 2 devices it's a non-issue; FCM and Apple are free with no published cap at this scale.
8. **Duplicate WhatsApp habits.** Managers may keep announcing in WhatsApp as well. Not a software problem. One month after go-live, ask whether `Çalışma değişti` replaced the WhatsApp message.

## 10. Go-live checks (manual, tech lead; not e2e)

1. Generate the VAPID keys once on a trusted machine. Put `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT=mailto:<koro adresi>` in Vercel, Production only. Keep a copy with the backup passphrase.
2. `db:migrate` → `migrations=13/13`.
3. On a real Android phone (Chrome, browser closed), an iPhone with iOS 16.4+ (home-screen app) and desktop Chrome: turn on, send a test, lock the phone, then:
   - open attendance on a test rehearsal;
   - cancel and un-cancel it;
   - comment on a test recording;
   - create an urgent test ticket at night (check that quiet hours are bypassed).
4. Check that tapping each notification opens the right page, cold and with the app already open.
5. The next morning: one combined notification arrived between 08:00 and 09:00, and the cron log shows the dispatcher counts after the backup step.
6. Remove a device from the list and confirm it gets nothing more.

## 11. Priorities if time runs short

Must, in order:
1. AC 1–9: safe storage, allowlist, authorization, privacy, never blocking, cleanup.
2. AC 10–12, 15, 16, 18: turning it on, devices, switches, test.
3. AC 20–22: the worker shows and opens notifications.
4. AC 24, 27–29, 31, 33, 37–39: the at-once triggers that replace WhatsApp (attendance, rehearsal changes, cancellations, homework, comment, new/urgent/assigned tickets).
5. AC 47–51: dispatcher, morning run, quiet hours, retries, idempotency.
6. AC 25, 26, 32, 34, 35, 42, 45, 46: the morning lines and system alerts.
7. AC 54, 55: phone, accessibility and the test round.

Should: AC 13, 14, 17, 19, 23, 30, 36, 40, 41, 43, 44, 52, 53.

Could: none. Anything cut gets an entry in `po-decisions.md`, and the phase can't be accepted with a Must missing.
