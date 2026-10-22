# Phase 10 PO decisions

Author: PO. Date: 2026-10-22. These are the initial decisions behind `po-spec.md`, made before the team's replies. Numbering continues from Phase 9 (D31–D63). When `ux.md`, `ui.md`, `db.md` and `backend.md` arrive, I settle their `@po` points here from D91 onward and mark changed ACs in the spec `(amended Dn)`. Where this file is silent, the role file that owns the topic stands; this file overrides all of them.

**Changes from the user's approved list** (all explained below):
- D71: quiet hours are a fixed window with an on/off switch, not editable times.
- D75: trigger 6's copy can't offer "add an excuse".
- D77: trigger 12 is a morning line only.
- D78: a ticket raised to `Acil` counts as trigger 18.
- D79: trigger 20 fires on draft / approve / revise, because there is no "submitted" state.
- D80: trigger 19 "opened" means the period's start day.
- D81: an extra 95% storage alert.

## Ordering, platform and security

**D64. Phase 10 is built only after Phases 7–9 are live.**
- `db:check` on Turso must show `migrations=12/12` first.
- Phase 10's migration is `0012`. It is additive: new tables and indexes only.
- Why: Phase 10 hooks into the backup cron (7), tickets and budgets (8), and recordings and assistants (9). Building on unpushed code makes one huge, risky push even bigger.

**D65. `web-push@3.6.7`, pinned. Its licence is MPL-2.0, not MIT as the brief assumed, and I accept it.**
- MPL-2.0 is free and open source with file-level copyleft. We use the package unmodified as a dependency, so our own code carries no obligation.
- Its runtime dependencies (`asn1.js`, `http_ece`, `https-proxy-agent`, `jws`, `minimist`) are MIT-licensed; @backend confirms.
- Fallback, if @backend finds a blocker: our own RFC 8291/8292 implementation on `node:crypto`, about 150 lines, with no new dependency.
- Why: it is the de-facto reference implementation, and the zero-budget rule asks for free/open source, not specifically MIT. The protocol hasn't changed since 2017, so an old release isn't a defect in itself.

**D66. Outside production, every send goes to a file outbox, `data/push-outbox/`.**
- Fake endpoints use `https://push.invalid/...`, and a path suffix decides the simulated answer: `ok`, `gone`, `notfound`, `fail` or `slow`.
- Production refuses `push.invalid`.
- Why: it is the Phase 7 email pattern. e2e can check who got what, with what payload, TTL and urgency, and can test the 404/410 cleanup, all without Google or Apple. `.invalid` is a reserved TLD, so it can never resolve.

**D67. The push endpoint must be on an allowlist.**
- It must be `https:`, ≤ 1024 characters, and not an IP literal.
- Its host must be one of `fcm.googleapis.com`, `web.push.apple.com`, `updates.push.services.mozilla.com` or `*.notify.windows.com`. @backend may extend the list after checking Samsung Internet and Opera.
- The keys are validated: `p256dh` is a 65-byte P-256 point, `auth` is 16 bytes.
- Why: the server POSTs to a URL the browser hands it. Without the list, any logged-in user could make our function call internal or arbitrary hosts (SSRF).

**D68. Write first, send after the response.**
- The triggering action computes recipients and inserts `notifications` rows: one per recipient, with a dedupe key, an expiry and a `not_before` for quiet hours.
- Inserting the rows inside the action's transaction is @backend's call. The action never fails because of them: a failed insert is logged and swallowed.
- Then `after()` sends the rows that are due, to every device, at most 10 at a time, with a 10 s timeout each.
- Rows that are unsent or failed are retried by the next dispatcher run, up to 3 attempts per device, until `expires_at`.
- Web Push `TTL` = time to expiry, capped at 24 h. `Urgency: high` is used only for trigger 18, and `normal` otherwise.
- Why: the user's rule that sending must never slow down or fail the action. A durable row means a crashed `after()` loses nothing until the next run.

**D69. Timing (option A): one dispatcher, two entry points, one cron.**
- **The daily cron** `/api/cron/aylik-yedek` (05:00 UTC, fires 08:00–08:59 Istanbul) runs the backup, then the dispatcher (stopping by `started + 40 s`), then the storage sweep (deadline `started + 55 s`, as today). Its reply stays exactly `{ status }`.
- **A new route** `GET /api/cron/bildirimler`, with the same bearer check, runs only the dispatcher. It is **not** in `vercel.json`.
- **What a dispatcher run does:**
  - It always sends at-once rows that are due and retries failed ones.
  - It releases rows held by quiet hours only when "now" is outside 22:00–08:00.
  - It builds the morning lines (2, 3, 8, 10, 11, 12, 17, 19) only on the first run of an Istanbul day at or after 08:00. The guard is the dedupe key `sabah-<day>`.
- Why:
  - The user chose option A and asked for no second cron.
  - Running the dispatcher before the sweep puts the time-sensitive step before the step that can wait a day.
  - Because every run is idempotent, a later hourly call from cron-job.org needs no code change: only a URL and the secret.
  - 08:00 is both the end of quiet hours and the earliest minute the Hobby cron can fire.

**D70. One morning notification per person.**
- Everything a person gets in a morning run goes out as one notification: their morning lines plus the items held overnight. The title is `Bugün Arkhe'de`, the body has up to 4 lines and then `+{n} bildirim daha`, and it links to `/`.
- With exactly one item, the person gets that item's own notification.
- Why:
  - A choir member wants one buzz with breakfast, not five.
  - The home page already shows today's rehearsal, homework, the review queue and the board summary, so `/` is the right landing page.

**D71. Quiet hours: an on/off switch, fixed at 22:00–08:00 Istanbul, on by default.** *(A change: the user said "by default 22:00–08:00", which suggests editable times.)*
- Why: under option A, the only delivery after the window is the 08:00–08:59 cron. A personal window ending at 10:00 would hold notifications until the next day's run, almost 24 hours later. Editable times make sense only once an external, more frequent trigger exists (backlog).

**D72. The groups and defaults are the §4 table in the spec.**
- Defaults differ inside the user's four areas, so the switches are finer than four.
- Each person sees only the switches that can apply to their role or appointment.
- No row means the default, so adding a group later needs no data migration.
- Why:
  - A member shouldn't see `Yönetim işleri`.
  - The two "off by default" items (6, 12) need their own switch. Otherwise turning on `Repertuvar` would mean turning on something else as well.

## Triggers

**D73. "Cancelled" is the existing `rehearsals.cancelled_at`** (`setCancelled`, with undo).
- Undoing a cancellation notifies too (`Çalışma yeniden programda`).
- `endSeries`, which deletes future occurrences, notifies once per affected person.
- A rehearsal whose start has passed never notifies.
- Why: the schema already has cancel and undo. A person told "iptal" must also be told "yapılacak" if it comes back, and deleting the rest of a series is a cancellation in the singer's eyes.

**D74. What counts as a rehearsal change (4b):**
- Notify only when the start day/time, the end time or the location changes. Recipients are the union of the people expected before and after the edit. All notifications for one rehearsal share the tag `calisma-<id>`, so a second edit replaces the first on the phone.
- A new weekly series sends one notification, not one per week.
- Title and note edits, and sectional-part changes alone, notify nobody.
- Why: people need to know when and where; nobody needs a buzz for a typo fix. The union catches a soprano dropped from a sectional, who would otherwise turn up.

**D75. Trigger 6 says to tell the person who took attendance.** *(A change: the user's text was "so you can add an excuse".)*
- The new copy: `Mazeretin varsa yoklamayı alana ilet.`
- `submitExcuse` refuses once the rehearsal has started: `Çalışma başladı; mazeret artık yoklamayı alan kişiye iletilmeli.` A late-excuse feature is out of scope.
- The trigger stays off by default.
- Why: a notification must not promise an action the portal refuses.

**D76. Trigger 9 fires only on the first comment** (`saveFeedback` outcome `sent`), never on an edit, and never with the text.
- Why:
  - The conductor fixing a typo must not buzz the singer twice. The `Yeni not` dot still marks the edit in the portal (Phase 4 D10).
  - Feedback is private, and a locked screen is not.

**D77. Trigger 12 (repertoire) is a morning line only.** *(A timing change.)*
- The line covers what changed since the previous morning run: new pieces, links and MIDI files.
- Why:
  - A bulk paste adds 20 links in one action, and a librarian edits a piece many times in an evening. A digest is the only form that doesn't train people to turn it off.
  - It is off by default anyway.

**D78. Board tickets.**
- **13 and 18 are the same event**, a new ticket. Urgency `Acil` makes it 18:
  - title `Acil iş`;
  - never held by quiet hours;
  - Web Push `Urgency: high`.
- **Raising an existing ticket to `Acil` also counts as 18.** *(An addition.)*
- **Urgent still follows the person's `Yönetim işleri` switch.** The user's off switch wins over our idea of urgency.
- **The actor is always excluded.**
- **Precedence, one notification per person per action:** 18 > 14 > 16 > 15 > 13.
- **The payload has the ticket number, the title (cut to 60 characters) and the actor's name. It never has a comment body or the description.**
- Why:
  - A ticket made urgent at night is exactly the case the user meant.
  - The precedence rule avoids "new ticket" and "assigned to you" arriving together.
  - The title is what makes the notification worth opening; comments can be long and personal.

**D79. Trigger 20 fires on three events: a new draft, an approval, and a revision of an approved budget.** *(A change: budgets have no "submitted for approval" state; any manager approves a draft.)*
- It goes to the conductor and the board, minus the actor.
- No amounts and no reason in the payload.
- Plan edits on a draft notify nobody.
- Why:
  - A new draft is in practice "please look and approve".
  - Approval and revision are the moments the other managers must know.
  - Drafts are edited many times.
  - Budgets happen about once a year, so this is never noisy.

**D80. Trigger 19 (dues).**
- **A choir-wide switch on `/finans/ayarlar`,** `Aidat bildirimleri`, off by default and changeable by any manager, decides whether dues notifications exist at all. It lives outside `app_settings`: adding a key there means rebuilding a live table because of its key CHECK (Phase 7 already did that once). @dba picks the table.
- **When it is on,** members see `Aidat hatırlatmaları` (default on) and can turn it off for themselves.
- **"Period opened"** = the morning of `starts_on`, not when the row is created. Periods are bulk-created a year ahead (`bulkCreateDuesPeriods`).
- **"Overdue"** = what `Aidatım` already shows as late. One reminder per person at most every 30 days.
- **Never an amount.**
- **Waived members and the conductor** get no "period opened".
- Why:
  - The user said the board decides.
  - Dues reminders are socially sensitive in a volunteer choir, so they are off until the board actively wants them.
  - "Once a month" read as a calendar month would allow the 31st and then the 1st; 30 days is what the user meant.

**D81. System alerts.**
- **21:** only when the cron backup run returns `failed`. A manual `Şimdi gönder` failure already shows on the page. If the cron keeps failing, the alert repeats daily (the cron retries daily while the month is uncovered). That is wanted, because it's an alarm.
- **22:** notify at ≥ 80%, and again at ≥ 95%, which stops uploads. *(The 95% alert is an addition.)* Each alert fires once per crossing. It re-arms after a run below the level. It is checked in the cron run only.
- Why:
  - Each alert should mean "act now".
  - 95% is the moment singers start getting refusals, which the conductor must hear about before they complain.
  - A daily check is enough for storage that grows by about 30 MB a week.

**D82. What a payload may contain.**
- **Allowed:**
  - rehearsal titles, times and places;
  - piece titles;
  - the dues period name;
  - the budget name;
  - ticket numbers and titles;
  - the names of the actors in board and budget notifications;
  - counts.
- **Never:**
  - assistant notes, conductor comments, ticket comments, descriptions or excuse notes;
  - money amounts or budget reasons;
  - emails or phones;
  - names of singers in any homework or review notification.
- Why:
  - Payloads are encrypted in transit, but they are shown on locked screens and in notification history.
  - The Phase 9 rule (assistant notes reach only the conductor) and Phase 5's dues privacy must hold outside the portal too.

## Opt-in, devices and the worker

**D83. Turning notifications on.**
- **On `Profilim`,** a `Bildirimler` section under `Telefonuna ekle`. Permission is requested only from the `Bildirimleri aç` tap. An iPhone in Safari is sent to `Ana ekrana ekle` first.
- **On the home page,** a dismissible nudge card for browsers that can subscribe but haven't. `Şimdi değil` hides it for 30 days on that browser. On an iPhone outside the app, the card links to the profile instructions instead of a button.
- Why:
  - Browsers punish permission prompts that aren't tied to a gesture.
  - iOS only delivers to installed PWAs, so asking in Safari would be a dead end.
  - Without a nudge, few singers find the profile setting.

**D84. Devices.**
- At most 10 per person: an 11th replaces the least recently successful.
- An endpoint has one owner, the last user who subscribed it.
- Logging out deletes this browser's subscription.
- Deactivating a person deletes all of theirs.
- A 404/410 answer deletes the row at once.
- 10 consecutive failures over ≥ 14 days delete the row.
- Recipients are re-checked at send time: still active, still in the role or scope.
- Why:
  - A shared family tablet or a borrowed phone must not keep getting someone else's notifications.
  - Dead rows waste the 60 s budget.

**D85. The test button.**
- It sends to all the person's devices, ignoring switches and quiet hours.
- It reports the device count and removes dead devices.
- Limit: 5 per 10 minutes.
- Why: "bildirim gelmiyor" is the support question we will get most. One tap that tests every device, and cleans up the dead ones, answers it without a manager.

**D86. No inbox.** Every trigger's fact is already visible in the portal, and the deep links land there:

| Triggers | Where the fact is visible |
|---|---|
| 1 | `/yoklama` |
| 2–5 | `/calismalar` and the home page |
| 6 | The member's attendance history |
| 7, 8 | `/odevler` and its badge |
| 9 | The `Yeni not` dot |
| 10, 11 | The queues and `data-review-badge` |
| 12 | `/repertuvar` |
| 13–17 | `/yonetim` with the `Yeni` markers and its badge |
| 19 | `Aidatım` |
| 20 | `/finans/butce` |
| 21 | `/yedek` and its home banners |
| 22 | The storage banner |

- Why: push is best effort (constraint 2). An inbox would be a second place to keep "read" state, and the existing badges already do that job.

**D87. Service worker.**
- **On push:** always call `showNotification`, falling back to `Arkhe` / `Portalda yeni bir şey var.` when the payload can't be read. Use the 192 px icon and a new monochrome 96 px `badge` icon.
- **On click:** navigate only to same-origin paths (a single leading `/`). Focus an existing window before opening a new one.
- **Version:** bump `VERSION`.
- **The KILL switch** stays, and the README warns that it also ends every subscription.
- Why:
  - Chrome and Safari require a visible notification for every push (`userVisibleOnly`). iOS revokes the subscription of a site that pushes silently.
  - The click rule stops a crafted payload from becoming an open redirect.

**D88. How e2e verifies sending without push services.**
- **Server side:** the D66 outbox, plus hooks honoured only outside production with a `file:` DB:
  - the clock (`arkhe_e2e_clock`, `?simdi=`);
  - push faults (`arkhe_e2e_push_fault`);
  - fake latency.
- **Client side in dev:** an init script stubs `PushManager` and `Notification`, because dev doesn't register the worker (`pwa-boot.tsx`).
- **The worker itself:** tested in `e2e:prod` with CDP `ServiceWorker.deliverPushMessage` and `registration.getNotifications()`.
- Real devices are a manual go-live list (spec §10).
- Why:
  - It reuses the Phase 7 and Phase 8b/9 patterns.
  - It covers both halves (who gets what; what the phone shows) without network access to Google or Apple.

**D89. No delivery statistics or admin screens in this phase.** Logs record counts per kind and run (sent, held, dropped, failed, removed devices). They never record endpoints, payloads or names.
- Why:
  - No admin burden.
  - An endpoint is a capability URL and must not sit in logs.
  - "How many have it on" is asked once, a month after go-live (risk 1), and a SQL count answers it.

**D90. VAPID keys.**
- Production reads `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:`).
- When they are missing, the feature is off and the app still boots: there is no fail-fast, the same as the Phase 9 Blob rule.
- Dev and e2e use fixed dev keys and the outbox.
- The README says: generate once, store Production-only, keep a copy next to the backup passphrase, and never rotate unless the keys leak.
- Why:
  - The rest of the portal must not go down because push isn't configured.
  - Rotating the keys silently invalidates every subscription.

## Questions handed to the team

They are listed in `po-spec.md` §8 for @backend, @dba, @ux and @ui. I'll answer their replies here from D91 onward.
