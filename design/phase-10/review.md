# Phase 10 review: Web Push (security, backend, UI)

Reviewer: tech review (read-only). Date: 2026-10-22. Scope: every uncommitted change (`git diff HEAD`, untracked `src/lib/push/**`, `src/app/actions/push.ts`, `src/app/api/cron/bildirimler/`, `src/components/notifications/**`, `drizzle/0012_*`, `public/sw.js`, the trigger hooks), checked against `po-spec.md`, `po-decisions.md`, `contract.md`, `implementation-notes.md` and `ui-notes.md`. I did not run e2e. I looked at `/profil` on the dev server at 375 px in both themes, as sef@ and korist@. Every POST was blocked, so nothing was written apart from the login sessions.

**Counts: P1 0 · P2 5 · P3 9**

## What holds (checked, no finding)

- **Authorization.**
  - Every action in `src/app/actions/push.ts` calls `assertUser`/`assertManager` before it reads or writes anything.
  - `removePushDevice` and `unsubscribePush` filter on `user_id` as well, so korist@ can't remove or read sef@'s rows.
  - `savePushPref` re-checks `groupVisible` on the server.
  - `getPushSettings` returns ids only; endpoints and `session_id` never reach a page.
  - Both cron routes use the digest-based `bearerMatches`, answer 503 without `CRON_SECRET` and send `no-store`.
- **SSRF and the allowlist** (`endpoint.ts`): only `https:` is accepted, with no credentials, no port, no IP literal and no `localhost`. Hosts must match exactly or by a dotted suffix (a trailing-dot host fails). The key must be a real P-256 point (ECDH) and `auth` must be 16 bytes. `push.invalid` is accepted only with the hooks on, and real mode answers it with `gone`. `web-push` doesn't follow redirects.
- **Payload privacy.**
  - No trigger reads a note, a comment, an excuse, a reason or an amount.
  - The assistant and conductor lines are counts only.
  - The actor is passed through, but only `actor.name` is used.
  - Logs carry error names, codes and counts only. `logging.serverFunctions: false` keeps action arguments out of the dev log.
- **Service worker.** `showNotification` takes plain text, so there is no XSS sink. `safeTarget` accepts only single-slash paths with no backslash, and it re-checks the origin. A bad payload falls back to the spec's copy.
- **Recipients.** These match §4: the roster's `isExpected` (sectional parts), `isEligible`, the review scope (D9 equals `loadScope`), the manager list, the actor removed in every builder, and the inactive filtered twice (on enqueue and again at send). The 18 > 14 > 16 > 15 > 13 precedence comes from first-offer-wins in that order.
- **Hooks.** Every hook runs behind `guard()`/`enqueue()` try/catch. Sending happens only inside `after()`, and each hook fires only on the call that actually changed the row (`didOpen`, `hit.length`, `fresh`, `revised`, `approved`, `recorded` from `RETURNING`).
- **Idempotency.** There is a unique (user, dedupe) key, a lease so `after()` and the dispatcher never overlap, a `held`-guarded merge, and the `sabah-<day>` claim. The storage and backup alerts dedupe per day.
- **Quiet hours.** `istanbulTimeOf` is h23 in Istanbul (checked: 21:30Z gives `00:30`, which is held). Urgent rows are never held.
- **Migration.** `0012` has only 4 `CREATE TABLE` and 7 `CREATE INDEX` statements, with no `ALTER`, `DROP` or `__new_`. Its CHECKs match the code (key lengths 87/22, the fail-count pairing, the url check).
- **UI.**
  - The `/profil` section has no horizontal scroll at 375 px in either theme.
  - Switches are base-ui `role="switch"` with `aria-checked`, `aria-labelledby` and `aria-describedby`. A click on the row text toggles exactly once, through the hidden input (verified with a MutationObserver).
  - Rows are 56 px tall and the copy matches AC 10, 16, 17, 18 and 43.
  - The permission prompt only ever comes from a click handler, and `requestPermission` is the first await.

---

## P2: should be fixed

### P2-1 The combined morning notification can arrive a day late with yesterday's "Bugün …" lines
`src/lib/push/dispatch.ts:304-307`

The combined row expires at `min(max(member expiries), now + 24h)`. One long-lived member, such as `homework_due2` (due in 2 days) or `feedback` (7 days), sets the expiry for the whole digest to now + 24 h.

**Failure scenario:**
1. Tuesday's cron fires at 08:50. A digest of `Bugün 19:30: Koro çalışması` and `2 gün kaldı: …` gets a 5xx or timeout from FCM, or the pool hits its deadline. The row stays `pending` (attempt 1).
2. The next dispatcher run is Wednesday's cron at 08:05, which is within 24 h.
3. Wednesday's run re-sends Tuesday's `Bugün Arkhe'de` with "Bugün 19:30" about a rehearsal that is over. With `renotify: true` it also buzzes.

The same applies to a `skipped` (deadline) combined row.

**Fix:** cap the combined row at the end of the Istanbul day: `min(max(...), istanbulToUtc(addDays(day, 1)))`. Alternatively, use the earliest expiry of the "today" kinds (2, 3b, 10, 11, 12, 17).

### P2-2 One failing morning section loses the whole day's morning and every retry
`src/lib/push/dispatch.ts:368-377`, `src/lib/push/morning.ts:180-182, 300-310`

`runDispatcher` takes the day's `claim(sabah-<day>)` first and then awaits `morningItems`. That is a `Promise.all` of six builders. If any one of them throws (for example `loadDuesMatrix`, `conductorCounts`, or a Turso hiccup):
- the exception leaves `runDispatcher`;
- `releaseHeld` and `deliver(null)` never run;
- `runPushStep`'s catch swallows it.

**Results:**
- The claim is already spent, so no digest is sent that day.
- Every item held overnight stays `held`. Most expire before the next morning (`Yoklama açıldı`, `Bugün çalışma var`).
- Every pending retry waits another day.
- `repertoireLines` has already advanced `repertuvar-since` (line 182), so that day's repertoire news is lost for good.

**Fix:**
- Build each section in its own try/catch (`Promise.allSettled`) and enqueue what succeeded.
- Wrap the morning block so `releaseHeld` and `deliver` always run.
- Advance `REPERTOIRE_SINCE` only after the enqueue succeeds.

### P2-3 `Kaldır` doesn't stick: the removed device's daily re-sync brings it back
`src/components/notifications/push-client.ts:131-141`, `src/app/actions/push.ts:91-103`

`removePushDevice` deletes only the server row. The removed phone keeps its browser subscription, and `Notification.permission` stays `granted`. The next time that phone opens the portal with a sync stamp at least 24 h old, `PushSync` calls `subscribePush`, an idempotent upsert, and the row returns.

**Failure scenario:** an alto removes her old tablet on `/profil` and sees `Bu cihaza artık bildirim gitmez.` Her child opens Arkhe on the tablet the next day, and from then on it gets every notification again. This breaks AC 12 ("The list then has no such row") and go-live check §10.6 ("confirm it gets nothing more").

**Fix:** keep a tombstone for the removed endpoint: an additive `push_removed (endpoint_hash, user_id, removed_at)` table, or a `removed_at` column on a new table, since the live table must not be altered. `subscribePush` gets a `{ resync: true }` flag that refuses tombstoned endpoints, and an explicit `Bildirimleri aç` clears the tombstone. Alternatively, let the next re-sync of a tombstoned endpoint call `unsubscribe()` in that browser.

### P2-4 A password change (or invite reset) silently drops every device, the current one included, and the UI still says "açık"
`src/app/(portal)/profil/actions.ts:51-52`, `src/app/davet/[token]/actions.ts:57`, `src/components/notifications/push-client.ts:138`, `push-panel.tsx:229-297`

`changePassword` runs `deleteUserSessions` and then `createSession`. The `ON DELETE CASCADE` from `push_subscriptions.session_id` therefore deletes every subscription, including the browser the user is on.

**What the user sees on that browser:**
- The sync stamp is the same user and endpoint and is younger than 24 h, so `resyncPush` returns early and the device stays unregistered for up to 24 h.
- `/profil` shows `Bu cihazda bildirimler açık.` (from `getSubscription()`).
- At the same time `Cihazların` is empty and `Deneme bildirimi gönder` is disabled with `Önce bu cihazda bildirimleri aç.`, which contradicts the line above.

The same "on but unknown" mismatch appears after AC 13 on a shared browser, where the stamp belongs to the other user.

**Fix:**
1. In `changePassword`, move the current session's subscriptions to the new session (`UPDATE push_subscriptions SET session_id = <new> WHERE session_id = <old>` before the delete).
2. Pass the panel and `PushSync` a server flag "this session has a row" (`devices.some(d => d.current)`). When the browser has a subscription but the flag is false, re-sync at once, ignoring the 24 h stamp. The user-mismatch guard stays.

### P2-5 The daily cron's push step has no budget check before it starts
`src/app/api/cron/aylik-yedek/route.ts:62-67`, `src/lib/push/cron.ts:33-48`, `src/lib/push/dispatch.ts:363-377`

The `started + 40 s` deadline only stops new sends inside `pool()`. These parts run regardless of how much time the backup used:
- `housekeeping`;
- `storageAlert` (`usage()`);
- the morning claim;
- `morningItems`, which loops over every active user with sequential `loadScope` and `assistantQueueCount` queries (React `cache` is inert in a route handler);
- `releaseHeld` (one `writeTx` per user);
- `deliver`, whose claim covers every pending row, followed by one `finish` write per row.

**Failure scenario:**
1. On a heavy backup day the backup returns at around 45 s.
2. The push step then still claims the day and builds and merges every digest. With the deadline passed it sends nothing, and through P2-1 the merged rows can surface tomorrow.
3. It keeps writing until the sweep's 55 s deadline has gone, and the call ends near the 60 s kill.

The backup's own row is already final, so the backup isn't lost. But the sweep is starved, and AC 52's "whole daily cron call stays under 55 s" isn't guaranteed.

**Fix:**
- In `runPushStep`, skip everything except a cheap housekeeping step when `Date.now() > deadline - 10 s`, and don't `claim()` the morning when there's no time left. A later trigger, or tomorrow's run, would then do it.
- Pass the deadline into `morningItems` and `releaseHeld`.

---

## P3: nits

### P3-1 Progress isn't saved until the whole pool ends, so a killed run re-sends
`src/lib/push/dispatch.ts:176-251`, `src/app/api/cron/bildirimler/route.ts:19`

`deliveredTo` and `attempts` are written in one loop after `pool()` returns. If the function dies mid-pool, every device already reached gets the notification again on the next run. On the bildirimler route this is plausible: a 50 s deadline plus a 10 s in-flight send equals the 60 s `maxDuration`.

**Fix:** append to `delivered_to` per job, for example with a `json_insert` update. Also lower that route's deadline to `started + 40 s`, as in the daily route.

### P3-2 The 10 s send timeout is a socket idle timeout and is classified as `fail`
`src/lib/push/send.ts:65, 73-74`

`web-push` uses an idle timeout and destroys the socket with `new Error('Socket timeout')`, which has no `code`. So a slow push service returns `fail`, not `slow`, and a slow-drip response can exceed 10 s in total.

**Fix:** wrap the call in an `AbortSignal.timeout`/`Promise.race` for a hard 10 s, and map the timeout to `slow`. Retry behaviour stays the same.

### P3-3 The 95% storage alert says uploads stopped when only the transfer or reads meter is at 95%
`src/lib/push/system.ts:48-64`

`level` is the maximum over all four meters. `PLAYBACK_STOP_RATIO` is 1, so a transfer meter at 96% stops nothing. Yet the conductor gets `Kayıt alanı dolu` / `Yeni kayıt yüklenemiyor.`, which is false.

**Fix:** compute the 95 level only from the meters that stop at 95 (`storage`, `uploads`). Alternatively, use the meter's own `state === "full"`.

### P3-4 The home nudge also appears when permission is already `granted`
`src/components/notifications/push-nudge.tsx:30-31`

`detectState` returns `default` for "granted but no subscription", for example after `Bu cihazda kapat`. AC 19 shows the card only while permission is `default`, so someone who just turned this device off is asked again on the home page.

**Fix:** check `Notification.permission === "default"` explicitly in the nudge.

### P3-5 `Seriyi bitir` counts and notifies about occurrences that were already cancelled
`src/lib/push/triggers.ts:158-180`, `src/lib/attendance/rehearsals.ts` (`listSeriesAfter`)

`listSeriesAfter` doesn't filter `cancelled_at`. So `{n}` in `… sonrasındaki {n} çalışma yapılmayacak.` includes occurrences that were already off, and their expected people are added to the recipients.

**Fix:** filter `isNull(cancelledAt)` for the notification list only. The delete stays as it is.

### P3-6 The combined morning body cuts every line to an equal share, even when the others are short
`src/lib/push/dispatch.ts:301-303`

With 4 lines each gets about 33 characters. A line like `Bugün 19:30: Soprano + Alto partisyon çalışması (Mülkiye)` becomes `Bugün 19:30: Soprano + Alto p…`, even when the other three lines are 20 characters each.

**Fix:** give the unused characters of short lines to the longer ones (a water-filling cut) before falling back to equal shares.

### P3-7 Outbox mode is chosen from `NODE_ENV` alone, not from the database
`src/lib/push/config.ts:43-44`

If `npm run dev` runs against the production Turso URL (for example while debugging a restore), the dev server's `after()` and the cron route pick up real `pending` rows and the `sabah-<day>` claim. They write the rows to the local outbox and mark them `sent`, so the real phones never get them.

**Fix:** use `outbox` only when `isLocalDb(env)`. A non-production server against a remote database should behave like `off`: leave the rows untouched and don't claim.

### P3-8 The Phase 6 and Phase 8 e2e assertions were edited, but `review-fixes.md` is missing
`e2e/phase6-a-brand.mjs:218-228`, `e2e/phase8-a-board.mjs:243-249`

AC 55 requires each changed Phase 1–9 check to be listed with a reason in `design/phase-10/review-fixes.md`. Both edits are justified (the section order and the nudge are this phase's spec), but the file doesn't exist.

**Fix:** add the two entries.

### P3-9 `Çalışma değişti` and `İptal` never reach the conductor
`src/lib/push/triggers.ts:76-155`

`isExpected` is false for the conductor, so 4a, 4b and 5 skip them. §2 says the Şef gets "Rehearsal announcements". When a board member moves or cancels a rehearsal, the conductor hears nothing, unlike with 2 and 3, which add the conductor explicitly. This is a spec ambiguity (the §4 "To" column says "Expected"), not a code bug.

**Fix:** the PO should decide. If the conductor should get them, add `role === "conductor"` as in `morning.ts:44-46`, minus the actor.
