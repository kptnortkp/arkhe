# Phase 10 backend implementation notes

Author: backend. Date: 2026-10-22. The user overrode D64 (build now, before Phases 7–9 go live) and asked for speed, so there was no planning round; these are the backend decisions on spec §8 and on anything the spec left open. The contract with the UI is `contract.md`.

## §8 answers (@backend)

1. **`web-push@3.6.7`: confirmed and pinned** (`package.json` `"web-push": "3.6.7"`, `@types/web-push` 3.6.4 dev).
   - Licences checked in `node_modules`: `web-push` MPL-2.0; `asn1.js`, `http_ece`, `https-proxy-agent`, `agent-base`, `debug`, `ms`, `bn.js`, `safer-buffer`, `jws`, `jwa`, `minimist`, `safe-buffer` MIT; `inherits`, `minimalistic-assert` ISC; `buffer-equal-constant-time` BSD-3-Clause; `ecdsa-sig-formatter` Apache-2.0. All free/open source; nothing blocks D65.
   - It supports `TTL`, `urgency`, `topic` and `timeout` options and runs on `node:crypto`/`https` only, so Node 20/22 on Vercel is fine. We never set a proxy, so `https-proxy-agent` stays dormant.
   - No own RFC 8291 implementation: not worth the risk for this phase.
2. **Allowlist** (`src/lib/push/endpoint.ts`): exact hosts `fcm.googleapis.com`, `web.push.apple.com`, `updates.push.services.mozilla.com`; suffixes `*.notify.windows.com` and `*.push.apple.com` (Apple documents regional hosts). Samsung Internet and Opera are Chromium browsers that use FCM, so no extra hosts. `https:` only, no credentials, no explicit port, no IP literal, no `localhost`, normalised URL ≤ 1024 chars. Keys: `p256dh` must decode to a 65-byte uncompressed point that is on P-256 (checked with ECDH), `auth` to 16 bytes. `push.invalid` only where the e2e hooks are enabled.
3. **`after()` with `redirect()`**: the docs (`after.md`, "Good to know") say `after` runs even when the action calls `redirect`. The rows are written *before* `redirect()` (it throws), and `after()` only sends them. If `after()` ever doesn't run (crash, platform), the rows stay `pending` and the next dispatcher run sends them. `after()` is also called from server components (autoCloseStale → trigger 6): request data is read before `after()` as the docs require.
4. **Time budget in the daily cron**: backup → push step (dispatcher deadline `started + 40 s`) → storage sweep (`started + 55 s`, unchanged). The push step never throws (try/catch), and the reply stays `{ status }`. A send in flight at the deadline can still take up to its 10 s timeout, which still ends before the sweep deadline.
5. **`pushsubscriptionchange`: not used.** The page-load re-sync (AC 23) covers it: the UI calls `subscribePush` (an idempotent upsert) at most once a day per browser. One less authenticated route to defend.
6. **Logout and the endpoint**: the server doesn't need the endpoint. Every subscription row stores the hashed id of the login session that created it, with `ON DELETE CASCADE` to `sessions`. Logging out deletes the session, and with it this browser's subscription only. Deactivation deletes all of the person's sessions (existing `deactivateQueries`), so all their subscriptions go too. Requested from UI: unsubscribe in the browser on logout, so a shared browser's next login doesn't silently re-sync it.

## Data (@dba questions, decided here)

Migration `drizzle/0012_phase10_push.sql`, additive only (4 `CREATE TABLE`, indexes; no `ALTER`/`DROP`/`__new_`). Local `db:check`: `migrations=13/13`.

- `push_subscriptions`: id, user_id → users cascade, session_id → sessions cascade, endpoint (unique), p256dh, auth, label, created_at, last_success_at, fail_count, first_fail_at.
- `notification_prefs`: (user_id, key) PK, enabled. Keys = 9 groups + `gece`. No row = default.
- `notifications`: one row per (recipient, event); unique (user_id, dedupe_key); status `pending | held | sent | failed | dropped | merged`; `attempts`; `delivered_to` (JSON array of subscription ids, so a retry skips devices that already got it); `lease_until` (a sender's 2-minute claim, so `after()` and a dispatcher run never send the same row twice); `merged_into` for rows folded into a morning notification; `line` for the morning text.
- `notification_state` (key/value): the dues switch `aidat-bildirimleri`, the morning guard `sabah-<day>`, `repertuvar-since` and `depolama-seviye`. "Last dues reminder per user" is read from `notifications` (kind `dues_late` in the last 30 days), so it needs no state.
- Seed: **no** fake devices in the seed. A `push.invalid` row in a dev DB is harmless, but a seed that writes endpoints would also run against a copied production DB by mistake; e2e arranges its own devices.

## Behaviour decisions

- **Rows only for people with ≥ 1 device** and the switch on. Nobody without a device gets a row, so the table stays small. AC 2's "rows are written and marked dropped" holds for people with devices when VAPID is missing.
- **Recipient re-check at send time**: still active, the group still visible for their role/appointment and still switched on. Otherwise the row is `dropped`.
- **Attempts are counted per row**, not per device; a retry goes only to devices not yet in `delivered_to`. After 3 attempts the row is `failed`. A 404/410 deletes the device and doesn't count as a failure. A device with ≥ 10 consecutive failures whose first failure is ≥ 14 days old is pruned by the dispatcher.
- **Morning release**: held rows of one person become one `Bugün Arkhe'de` row (lines in §4 order, up to 4, then `+{n} bildirim daha`, shortened so the body stays ≤ 140 characters). One held row is sent as itself. Morning lines are always held first and released in the same run, so they combine with the night's held items.
- **Morning lines run on any dispatcher run outside 22:00–08:00**, once per Istanbul day (insert-or-ignore guard). On the cron route, `?bugun=<day>` alone means "08:30 that day" for the push step (dev/e2e only).
- **4a** (new rehearsal) and **5a/5b** (cancel/undo) exclude the actor, as every trigger does. **5c** body's `{gün}` is the day of the occurrence `Seriyi bitir` was used on.
- **Trigger 6** fires from `closeRehearsal`, i.e. for `closeAttendance` and `autoCloseStale`, only for rows the close actually inserted (`method = 'auto'`).
- **Trigger 11** uses `conductorCounts()`: `{n}` = `waiting` (live audio, no comment), `{k}` = `noted`.
- **Trigger 12** reads `created_at` of pieces, links and MIDI files since the previous morning run; no hooks in the repertoire actions.
- **Trigger 14 from `updateTicket`** fires when the assignee changes to someone else; **16** fires from `moveTicket` (the edit form doesn't change status in this codebase).
- **Trigger 20c** fires when `savePlan` wrote a revision (approved budget). No amounts, no reason.
- **Trigger 21** fires for `status === "failed"` in the cron route only (dedupe per day). **22** keeps the last alert level (0/80/95) in `notification_state` and alerts on an upward crossing; a run below a level lowers the stored level, which re-arms it.
- **Test button**: sends synchronously in the action (it must report counts), rate limit via the existing `login_attempts` buckets (`push-test:<user>`, 5 per 10 min), not shared with subscribe/re-sync.
- **TTL** = time to `expires_at`, capped at 24 h; `Topic` = the tag (sanitised, ≤ 32 chars); `Urgency: high` for trigger 18 only.
- **Logs** (`push dispatcher`): counts only (morning, released, sent, failed, dropped, removedDevices, held). Errors log name/code only. Endpoints, payloads and names are never logged.
- **VAPID** (`src/lib/push/config.ts`): production reads `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; missing or malformed → push off, one `bootWarnings` line with the names only. Outside production fixed dev keys and the outbox are used.

## e2e hooks (only `NODE_ENV !== "production"` and a `file:` DB)

Cookies `arkhe_e2e_clock`, `arkhe_e2e_push_fault=throw|slow`, `arkhe_e2e_push_latency=<ms>`; cron query `?simdi=`, `?hata=throw|slow|dispatcher`, `?gecikme=`.

## Deferred / not done

See the report to the tech lead; anything still open is listed in `contract.md` changelog or here.
