# Phase 10 review fixes

Author: backend. Date: 2026-10-22. Reply to `review.md` (0 P1, 5 P2, 9 P3). Every P2 is fixed; P3s are fixed where cheap, the rest have a one-line reason.

## P2

- **P2-1 The digest outlives its day.** The combined `Bugün Arkhe'de` row now expires at the end of the Istanbul day it was built (`min(max(member expiries), end of day)`, `dispatch.ts` `releaseHeld`). A failed digest is retried that day and then dropped, never shown tomorrow.
- **P2-2 One morning section loses the run.**
  - `morningItems` uses `Promise.allSettled`: a failing section is logged by name (`push morning sections failed`) and the rest are enqueued.
  - `repertuvar-since` is advanced by a commit callback that runs only after the rows are written, and not at all if the repertoire section failed.
  - If writing the rows fails, the `sabah-<day>` claim is given back (`unclaim`), so the next run builds the morning again.
  - The morning block is wrapped in try/catch, so `releaseHeld` and `deliver` always run.
- **P2-3 `Kaldır` doesn't stick.**
  - Additive migration `drizzle/0013_phase10_review.sql` adds `push_removed` (SHA-256 of the endpoint, user, time). `removePushDevice` writes a tombstone there.
  - `subscribePush(sub, { resync: true })`, the daily re-sync in `push-client.ts`, refuses a tombstoned endpoint with `removed: true`. The browser then calls `unsubscribe()` and clears its stamp, so the device really stops.
  - A tap on `Bildirimleri aç` (no `resync` flag) clears the tombstone, so AC 12 holds and the device can be turned on again on purpose.
  - Tombstones older than 180 days are pruned by housekeeping.
- **P2-4 A password change drops the current device.** I chose **keeping the current session's subscription**.
  - `changePassword` creates the new session, moves this session's subscriptions to it, and only then deletes the other sessions (and with them their devices).
  - Why this one and not a "true state" flag: the person who changed the password is on this browser and still wants its notifications. Other sessions are logged out on purpose, so dropping their devices is right. This is a server-only fix, with no client timing to get wrong.
  - Kept as is: the invite/reset link (`davet`) still drops every device. A reset is the "someone may have my account" path, and that user has to log in again anyway; the re-sync then restores the device on the next visit after 24 h, or at once with `Bildirimleri aç`.
- **P2-5 No budget check before the push step.**
  - `runDispatcher` does housekeeping, then returns with a log line when less than 10 s of its deadline is left. It doesn't claim the morning, release held rows or claim pending rows.
  - `releaseHeld` stops at the deadline (the remaining rows stay `held`).
  - `runPushStep` skips `storageAlert`'s `usage()` when less than 10 s is left.
  - Result: on a slow backup day the sweep keeps its time, and the morning is built by the next run.

## P3

- **P3-1 fixed.** Each delivered device is appended to `delivered_to` at once (`json_insert`), so a run killed mid-pool never re-sends to it. `/api/cron/bildirimler` now uses `started + 40 s`.
- **P3-2 fixed.** `sendOne` has a hard 10 s cap (`Promise.race`), and `Socket timeout`/`ETIMEDOUT` map to `slow`.
- **P3-3 fixed.** The 95% level comes only from the `storage` and `uploads` meters, the ones that stop uploads. Transfer and reads alert at 80% only.
- **P3-4 fixed.** The home nudge shows only while `Notification.permission === "default"`.
- **P3-5 fixed.** `endSeries` counts and notifies only occurrences that weren't already cancelled. The delete is unchanged.
- **P3-6 fixed.** The digest lines use a water-filling width (`fitLines`): short lines keep their length, and long ones share what's left of the 140 characters.
- **P3-7 fixed.** A new mode, `inert`: `next dev` against a remote DB writes no rows, claims nothing and sends nothing, and the profile shows `Bildirimler henüz açılmadı.`. The outbox is used only with a local `file:` DB.
- **P3-8 fixed.** The edited Phase 1–9 checks are listed below.
- **P3-9 skipped.** It's a PO decision: §4's "To" column says "Expected" for 4a/4b/5. Adding the conductor is a one-line change in `triggers.ts` if the PO wants it.

## Changed Phase 1–9 e2e checks (AC 55)

- `e2e/phase6-a-brand.mjs` (section order on `/profil`): the `Bildirimler` section now sits under `Telefonuna ekle`, as this phase's spec requires (D83).
- `e2e/phase8-a-board.mjs` AC 3 (home card directly below the hero): skips the `push-nudge` card when it sits between the hero and the board card. The new home order is this phase's D83 nudge and was accepted by the tech lead.

- `e2e/phase5-finance.mjs` AC 22 (Aidatım is the first content section on `/profil`): skips `#bildirimler`, which D83 places under `Telefonuna ekle`, above `Aidatım`. Found by the full run.

## New tests

- `phase10-b`: trigger 20c, a revision of an approved budget with a reason, reaches the other managers as `Bütçe değişti`. The amount and reason markers are added to the AC 7 privacy grep.
- `phase10-a`:
  - deactivating a member (`setMemberActive(id, false)`) removes all their devices (AC 15);
  - `Kaldır` plus a re-sync stays removed, and an explicit subscribe brings the device back (AC 12, P2-3);
  - a password change keeps this browser's device and drops the other sessions' devices (P2-4).
