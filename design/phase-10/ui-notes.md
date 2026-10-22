# Phase 10 UI notes (frontend)

Author: UI engineer. Date: 2026-10-22. No separate design round (user asked for speed); these are the small UX decisions I made while building S2, S3 and the UI side of S9, following existing portal patterns. Copy in backticks is exact.

## Profilim › Bildirimler (`src/components/notifications/*`)

- **Order on `/profil`:** header → `Telefonuna ekle` (install card) → `Bildirimler` → `Aidatım` → `Bilgilerin` → `Şifre`. Answers @ux §8.3 (first bullet). `id="bildirimler"` with `scroll-mt-20` so `/profil#bildirimler` (home nudge `Nasıl?`, test notification link) lands below the sticky mobile header.
- **Structure, top to bottom:**
  1. A card for *this browser*: icon + state text + one primary action (`Bildirimleri aç` or `Bu cihazda kapat`). States exactly as AC 10. While detecting it shows `Bu cihaz kontrol ediliyor…` with `aria-busy` (detection needs the worker when permission is already granted; capped at 8 s).
  2. `Cihazların`: rows `<cihaz> · <tarayıcı>`, `Bu cihaz` badge (= the row subscribed from this login session, contract §3), `Eklendi {gün}` (`Çar 29 Eki`), and a ghost `Kaldır` (44 px, `aria-label="Kaldır: <cihaz>"`) on every row except the current one while this browser is on (that one uses `Bu cihazda kapat`). Confirm: `{cihaz} kaldırılsın mı?` / `Bu cihaza artık bildirim gitmez.`, Vazgeç focused first (shared `ConfirmDialog`).
  3. `Deneme bildirimi gönder` (outline, full width): shown when this browser can be turned on (not asked yet / on) or the person has any device, so a desktop user can test their phone. With no device it is disabled and described by `Önce bu cihazda bildirimleri aç.` It is hidden in the unsupported, iPhone and denied states when there is no device: a disabled button there is only noise.
  4. `Neler için bildirim gelsin?` (new small sub-heading, muted) then one bordered list of switches: the role's groups in §4 order, then `Gece sessiz (22:00–08:00)` last with its help text (+ `Acil yönetim işleri beklemez.` for managers). The hint `Bildirimleri bir cihazda açınca bu ayarlar geçerli olur.` shows above the list only while the person has no device.
- **Switches:** the shadcn `Switch` (base-ui, `role="switch"`, `aria-checked`, `aria-labelledby` the row label, help text via `aria-describedby`), enlarged to 40×24 px with a darker off track (`muted-foreground/60`) so "off" still reads as a control on the light card; the whole row is the `<label>` (≥ 56 px tall), so the touch target is the row. Saved at once, optimistic; on error the switch flips back and the error toasts. Success toast `Kaydedildi.`
- **iPhone story (@ux §8.3, second bullet):** on iPhone Safari the install card above already shows the Safari steps; the `Bildirimler` card repeats only the one-line step (`Safari'de Paylaş … “Ana Ekrana Ekle”ye dokun.`) under its own sentence, as AC 10 requires, and has no button. I chose a short repeat over "see above" because a singer arriving from the home nudge's `Nasıl?` jumps straight to `#bildirimler` and may never see the card above.
- **Conductor's 6 switches at 375 px (@ux §8.3, third bullet):** one list, single-line labels, no wrapping issue at 375 (longest is `Yedek ve depolama uyarıları`).
- **VAPID missing:** the section shows only `Bildirimler henüz açılmadı.` (no switches, no devices): nothing there would work.
- **Error copy (new, not in the spec):** a failed enable (worker never ready, subscribe threw, server refused) toasts the server's error if it gave one, otherwise `Bildirimler açılamadı. Sayfayı yenileyip tekrar dene.` The browser subscription is dropped again when the server refuses, so browser and server never disagree. Other unexpected failures use the portal's `Bir şeyler ters gitti, tekrar dene.`
- **Focus:** after enable/disable, focus moves to the state sentence (tabIndex -1) so screen readers hear the new state; toasts are sonner's polite region.
- **Permission changed in settings** while the page is open: the state is re-detected on `visibilitychange`.

## Home nudge (`push-nudge.tsx`)

- **Place (@ux §8.3, fourth bullet):** right after the `Sıradaki çalışma` hero and before the board, review and homework cards. It is a one-time ask, so it sits high but never above the hero or the backup/storage banners.
- Style matches the install card: bordered card, 40 px gold-tinted bell tile, title, body, two equal buttons (`Bildirimleri aç` primary, `Şimdi değil` outline). No extra close "X": `Şimdi değil` is the close.
- Shown only when VAPID is configured, the browser can subscribe, permission is `default`, and it wasn't hidden in the last 30 days (`localStorage["arkhe-push-nudge-hidden"]`). On iPhone outside the app: body `iPhone'da önce Arkhe'yi ana ekrana ekle.` and a `Nasıl?` link button to `/profil#bildirimler` instead of `Bildirimleri aç`.
- Dismissing the browser's own permission prompt counts as `Şimdi değil` (hidden 30 days), so we never re-prompt on every home visit; Chrome blocks sites that do.

## Re-sync and logout (AC 15, AC 23; contract §8.1–8.2)

- `PushSync` (portal layout, every page) re-sends a granted subscription with `subscribePush` when the endpoint differs from the last one synced or the last sync is ≥ 24 h old. The stamp `localStorage["arkhe-push-sync"] = { user, endpoint, at }` also records the user id: a subscription stamped for another person on a shared browser is never taken over silently.
- Logout (`LogoutForm`) starts the browser unsubscribe and clears the stamp on submit without holding the form: the action's redirect is a client-side navigation, so the page lives on until it settles. The server deletes the row with the session.

## Service worker (`public/sw.js`, `VERSION = "arkhe-v2"`)

- `push`: always `showNotification`; payload validated (title and body strings), fallback `Arkhe` / `Portalda yeni bir şey var.` / `/` / tag `arkhe`. Icon `/icons/icon-192.png`, badge `/icons/badge-96.png` (new, white A on transparent, generated by `npm run brand:assets`; other assets byte-identical). `renotify: true` so a replaced tag (e.g. a second rehearsal edit) still buzzes.
- `notificationclick`: closes, accepts only `/x` paths (no `//`, no `\`), resolves against the worker origin and re-checks the origin; focuses an existing same-origin window first, then navigates it; opens a new window when none exists or navigate fails (uncontrolled client).
- `pushsubscriptionchange`: re-subscribes with the old key; the next page load re-syncs the new endpoint (no route handler, contract §8.3).
- Offline behaviour and the KILL switch unchanged; KILL comment now says it also ends every subscription.

## Headers

- No CSP or `Permissions-Policy` change: the push service is contacted by the browser, not the page (`connect-src 'self'` stays), and there's no Permissions-Policy feature for notifications to set. `/sw.js` keeps its Phase 6 headers.

## e2e (dev)

- `e2e/push-stub.mjs` (helper, not a phase file): an init script that fakes `Notification.permission/requestPermission`, `PushManager`, `navigator.serviceWorker.ready/getRegistration`, persisting the fake subscription in `localStorage` so reloads see it. It counts calls so AC 11 can prove nothing is requested on load.

## e2e (prod)

- `e2e/prod-push.mjs`, one call in `prod.mjs` after the AC13 worker check: `/sw.js` headers + `arkhe-v2`, page CSP, badge served, AC 2 UI without VAPID keys, CDP `ServiceWorker.deliverPushMessage` (valid, empty, non-JSON, no-title payloads read back via `getNotifications()`), and the click handler. A real OS notification click can't be automated, so the worker dispatches an untrusted `notificationclick` (its `waitUntil` throws, the handler body still runs: close + focus/navigate). `openWindow` with no open window needs a real click: manual go-live check (§10.4).
- Phase 6 `AC12` order check updated: install card → `Bildirimler` → `Aidatım` (the section placement is this phase's spec, not a regression).

## Frontend notes / deferred

- Dev server note: during the build the shared `next dev` got stuck in a Turbopack "HMR hash mismatch" reload loop on every browser load; a restart fixed it (no code cause found).

- `Finans › Ayarlar › Bildirim` hosts the `Aidat bildirimleri` switch (contract §8.4), same row pattern as the profile switches.
