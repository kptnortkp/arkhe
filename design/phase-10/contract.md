# Phase 10 backend ↔ UI contract

Author: backend. Date: 2026-10-22. The UI engineer reads this; changes are announced at the bottom under "Changelog".

## 1. Module paths

| Path | What | Who imports |
|---|---|---|
| `src/app/actions/push.ts` (`"use server"`) | Every server action below | Client components |
| `src/lib/push/settings.ts` (`server-only`) | `getPushSettings()`, `getVapidPublicKey()`, `getDuesPushEnabled()` for server components | Pages (`/profil`, `/`, `/finans/ayarlar`) |
| `src/lib/push/groups.ts` (isomorphic, no `server-only`) | `PUSH_GROUPS`, `QUIET_KEY`, `GROUP_LABELS`, types `PushGroup`, `PushPrefKey` | Anyone |
| `src/lib/push/device.ts` (isomorphic) | `deviceLabel(userAgent: string): string` → `Android · Chrome`, `iPhone · Safari`, `Mac · Chrome`, … | Optional; the server labels devices itself |

## 2. VAPID public key

- Server components call `getVapidPublicKey(): string | null` (base64url, the exact string to pass, converted to a `Uint8Array`, as `applicationServerKey`).
- `null` means push isn't configured (production without the three env vars): render `Bildirimler henüz açılmadı.` with no button, and never show the home nudge card.
- Outside production the server uses fixed dev keys, so the key is never null in dev/e2e.
- The key also comes inside `getPushSettings()` (below). It is never fetched by the client from a route.

## 3. Data for pages

```ts
// src/lib/push/settings.ts
export type PushDevice = {
  id: string;            // subscription row id (uuid); never the endpoint
  label: string;         // "Android · Chrome"
  createdAt: Date;       // "Eklendi {gün}"
  lastSuccessAt: Date | null;
  current: boolean;      // subscribed from this login session ("Bu cihaz")
};
export type PushSettings = {
  publicKey: string | null;
  devices: PushDevice[];                       // newest first, at most 10
  groups: { key: PushGroup; label: string; on: boolean }[]; // only the ones visible to this user, in §4 order
  quiet: boolean;                              // "Gece sessiz (22:00–08:00)"
  manager: boolean;                            // show "Acil yönetim işleri beklemez."
};
export async function getPushSettings(): Promise<PushSettings>; // requires a session (redirects to /giris like requireUser)
export async function getVapidPublicKey(): Promise<string | null>;
export async function getDuesPushEnabled(): Promise<boolean>;   // the choir-wide `Aidat bildirimleri` switch
```

Group keys (`PushGroup`), in display order: `calisma`, `devamsizlik`, `odev`, `dinleme`, `repertuvar`, `yonetim`, `aidat`, `butce`, `sistem`. `aidat` is listed only while the choir switch is on. Labels are in `GROUP_LABELS` (exactly the spec §4 text). The quiet switch key is `gece` (`QUIET_KEY`).

Endpoints never leave the server: the device list carries ids only. "This browser is subscribed" is decided by the client from `pushManager.getSubscription()`; `current` only marks the row of the current login session.

## 4. Server actions (`src/app/actions/push.ts`)

All of them authorize on the server; logged out they return `{ error: "Bu işlem için yetkin yok." }` and write nothing. All return `FormState` from `src/lib/validation.ts` (`{ error?, success?, warning? }`), so they work with `useActionState` and with a direct `await`.

```ts
type SubscriptionJSON = { endpoint: string; keys: { p256dh: string; auth: string } }; // = PushSubscription.toJSON()

export async function subscribePush(sub: SubscriptionJSON): Promise<FormState>;
//   success: "Bu cihazda bildirimler açık."
//   error:   "Bu bildirim adresi kabul edilmedi."  (allowlist / key validation, AC 4)
//   Upsert by endpoint: an endpoint known for another user moves to this user (AC 13);
//   an 11th device removes the oldest (AC 14). Idempotent: use it for the AC 23 re-sync as well.
//   The device label is taken from the request's User-Agent on the server.

export async function unsubscribePush(endpoint: string): Promise<FormState>;
//   "Bu cihazda kapat": call AFTER (or regardless of) the browser's subscription.unsubscribe().
//   Deletes only a row owned by this user. success: "Bu cihazda bildirimler kapandı."

export async function removePushDevice(_prev: FormState, formData: FormData): Promise<FormState>;
//   field `id` (subscription id). success: "Cihaz kaldırıldı."  error: "Cihaz bulunamadı." (not yours / unknown)

export async function savePushPref(_prev: FormState, formData: FormData): Promise<FormState>;
//   fields: `key` = a PushGroup or "gece"; `on` = "1" | "0".
//   success: "Kaydedildi."  error: "Bu ayar sana açık değil." for a group the role doesn't show (AC 5), nothing written.

export async function sendTestPush(): Promise<FormState & { sent?: number; removed?: number }>;
//   Waits for the sends (≤ 10 s). success: "Deneme bildirimi gönderildi ({n} cihaz)."
//   warning (when removed > 0): "{k} cihaz artık bildirim almıyor; listeden kaldırıldı."
//   errors: "Önce bu cihazda bildirimleri aç." (0 devices), "Çok sık denedin. Biraz sonra tekrar dene." (6th in 10 min)

export async function setDuesPush(_prev: FormState, formData: FormData): Promise<FormState>;
//   `/finans/ayarlar` › `Aidat bildirimleri`; field `on` = "1" | "0"; managers only (else "Bu işlem için yetkin yok.").
//   success: "Kaydedildi."
```

After a successful write the actions call `revalidatePath("/profil")` (and `/finans/ayarlar` for `setDuesPush`).

## 5. Push payload (what `public/sw.js` receives)

The encrypted message body is UTF-8 JSON with **exactly** these keys, ≤ 1024 bytes:

```json
{ "title": "Yoklama açıldı", "body": "Koro çalışması · 19:30 · Mülkiye. Yoklamaya katılmak için dokun.", "url": "/yoklama", "tag": "yoklama-<id>" }
```

- `title` ≤ 40 chars, `body` ≤ 140 chars (may contain `\n` in the combined morning notification), `url` a same-origin path starting with exactly one `/` (may carry `#fragment`), `tag` ≤ 64 chars `[a-z0-9-]`.
- The worker should still validate `url` (single leading `/`) and fall back to `Arkhe` / `Portalda yeni bir şey var.` / `/` / `arkhe` on unreadable payloads (D87).
- Urgency `high` (trigger 18) is a transport header only; nothing in the payload. Suggest `renotify: true` only if you want; the server does not ask for it.

## 6. Outbox (`data/push-outbox/`, outside production only)

One file per attempted send to one device: `data/push-outbox/<ISO time with - for : and .>-<4 hex>.json`, mode 0600:

```json
{
  "notificationId": "uuid",
  "userId": "uuid",
  "subscriptionId": "uuid",
  "kind": "attendance_open",
  "ttl": 3600,
  "urgency": "normal",
  "topic": "yoklama-abc",
  "result": "ok",
  "payload": { "title": "…", "body": "…", "url": "/…", "tag": "…" }
}
```

- `result` is `ok`, `gone` (410), `notfound` (404), `fail` (500), `slow` (timed out after 10 s) or `throw` (fault hook). Only `push.invalid` endpoints simulate failures, via their last path segment; any other endpoint outside production is recorded as `ok` and never contacted.
- `kind` values: `attendance_open`, `rehearsal_today`, `concert_tomorrow`, `concert_today`, `rehearsal_new`, `rehearsal_changed`, `rehearsal_cancelled`, `rehearsal_restored`, `series_ended`, `absent`, `homework_new`, `homework_due2`, `homework_due0`, `feedback`, `assistant_queue`, `conductor_queue`, `repertoire`, `ticket_new`, `ticket_urgent`, `ticket_assigned`, `ticket_comment`, `ticket_moved`, `tickets_due`, `dues_open`, `dues_late`, `budget_new`, `budget_approved`, `budget_revised`, `backup_failed`, `storage_80`, `storage_95`, `test`, `morning` (the combined one).

## 7. e2e hooks (honoured only when `NODE_ENV !== "production"` and the DB is `file:`)

- Cookie `arkhe_e2e_clock=<ISO>`: "now" for notification timing in actions (quiet hours, expiry, "future rehearsal").
- Query `?simdi=<ISO>` on `/api/cron/aylik-yedek` and `/api/cron/bildirimler` (plus the existing `?bugun=`).
- Cookie `arkhe_e2e_push_fault=throw|slow` for action-triggered sends; query `?hata=throw|slow` on the cron routes. On the cron route `?hata=dispatcher` makes the dispatcher itself throw (AC 47).
- Fake latency: cookie `arkhe_e2e_push_latency=<ms 1–5000>` / query `?gecikme=<ms>`; each outbox send waits that long.
- Fake subscription endpoints: `https://push.invalid/e2e/<uuid>/<ok|gone|notfound|fail|slow>`. Keys must still be a valid 65-byte P-256 point and 16-byte auth (use `e2e/lib.mjs` helper `fakePushKeys()` that I add; any real `PushSubscription` keys work too).

## 8. Requests to UI

1. **Logout:** before submitting the logout form, best effort `(await navigator.serviceWorker?.getRegistration())?.pushManager.getSubscription().then(s => s?.unsubscribe())`. The server already deletes the subscription of the session being logged out (the subscription row is tied to the login session with `ON DELETE CASCADE`), so this only stops the next login on a shared browser from silently re-syncing it. Do not wait more than ~1 s for it.
2. **Re-sync (AC 23):** when `Notification.permission === "granted"` and `getSubscription()` returns a subscription, call `subscribePush(sub.toJSON())` at most once per 24 h per browser (localStorage stamp). It's an idempotent upsert; no "is it known?" query is needed.
3. **`pushsubscriptionchange`** in `sw.js`: not needed; no route handler is provided (the page-load re-sync covers it, decision in implementation-notes).
4. **`/finans/ayarlar`:** the `Aidat bildirimleri` switch posts `setDuesPush` (field `on`); help text per AC 43.
5. Device rows show `label` and `Eklendi {gün}`; the `Bu cihaz` badge = `current`.

## Requests to backend (from UI)

1. **e2e:prod main server stays without VAPID keys.** `e2e/prod-push.mjs` (called once from `prod.mjs` after the AC13 worker check) asserts AC 2's UI on the main 3101 server: `/profil` shows `Bildirimler henüz açılmadı.` with no button and `/` has no nudge. If you need a keyed production run, please use `withServer` on `BAD_PORT` as Phase 7 does. My prod checks deliver pushes with CDP straight to the worker, so they need no keys.
2. **`getPushSettings()` must work for every role**, including a conductor without a voice part, and return `groups` in §4 order with the switch labels from `GROUP_LABELS`; the UI renders them as-is and appends `QUIET_LABEL` itself.
3. **`subscribePush` from a re-sync** may arrive for a row that was deleted, on any page load (portal layout), at most daily per browser or when the endpoint changed. Please keep it cheap and silent (no toast-worthy side effects, no rate limit shared with the test button).
4. FYI `e2e/push-stub.mjs` exports `stubPush(context, { permission, answer, mode, standalone, endpoint })` (fake `Notification`/`PushManager`/`serviceWorker.ready` for dev), `pushKeys()` and `fakeEndpoint(result)`, if your suites want a browser-side subscribe.
5. FYI my suite `e2e/phase10-c-ui.mjs` deletes, for sef@/yk@/korist@/asistan@ only: their `push_subscriptions`, `notification_prefs`, `notifications`, sessions with id `e2e-push-%`, the `aidat-bildirimleri` state row, and its own outbox files (by `userId`).

## Backend replies to UI requests

1. Agreed: `prod.mjs` main server stays keyless; I add no keyed production run in this phase.
2. Done: `getPushSettings()` works for every role (conductor without a part included), groups in §4 order with `GROUP_LABELS`.
3. Done: `subscribePush` is a cheap idempotent upsert with no rate limit; the test button has its own bucket.

## Further requests to UI

6. **`next.config.ts`: please add `logging: { serverFunctions: false }`.** `next dev` logs every server action's arguments, so `subscribePush`/`unsubscribePush` endpoints land in the dev log (AC 53 greps for them). Production never logs them.
7. **`phase8-a` AC3 now fails**: `the home card sits directly below the hero (push-nudge)`. The nudge card sits between the hero and the existing home card; either place it after that card or update that Phase 8 check with a reason in `review-fixes.md`.
8. FYI `{gün}` in payloads is built as `Çar 29 Eki` (tr-TR alone gives `29 Eki Çar`); the combined morning body uses real `\n` line breaks.

## Changelog
- 2026-10-22: first version.
- 2026-10-22: backend done; replies and requests 6–8 added. `e2e/push.mjs` has backend helpers (`addDevice`, `outboxSince`, `dispatch`, `resetPush`); `resetPush` clears all notification rows/prefs/state and `push.invalid` devices.
- 2026-10-22 (review fixes): `subscribePush(sub, opts?: { resync?: boolean })` returns `removed: true` for an endpoint removed with `Kaldır` when called as a re-sync; `push-client.ts` then unsubscribes the browser. A password change keeps this browser's subscription. Migration `0013` adds `push_removed`. Details in `review-fixes.md`.
