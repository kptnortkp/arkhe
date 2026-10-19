# Phase 6: UI code review

Reviewer: UI engineer (reviewing all Phase 6 frontend code, including my own). Date: 2026-10-19.

Scope: `public/sw.js`, `src/components/pwa-boot.tsx`, `src/components/install-card.tsx`, `src/lib/pwa-store.ts`, `src/app/manifest.ts`, `src/components/arkhe-logo.tsx`, `src/lib/brand/*`, `scripts/brand-assets.ts`, `scripts/offline.template.html`, `next.config.ts` / `src/proxy.ts` (PWA parts), `e2e/phase6-*.mjs`, `e2e/prod.mjs` (SW/offline parts), `e2e/lib.mjs`. No `src/` edits, no builds, no e2e runs.

## Screens checked

Dev server `http://127.0.0.1:3100`, real Chrome via playwright-core, signed in as `korist@arkhe.local`:

| Screen | 390 px (DPR 2) | 1280 px (DPR 1) |
|---|---|---|
| `/offline.html` | light, dark | light, dark |
| `/` (header wordmark) | light, dark | light, dark |
| `/profil` (install card above `Aidatım`) | light, dark | light, dark |

Screenshots: `/private/tmp/claude-501/-Users-merttemiz-Desktop-development-arkhe/dca171a5-e8a3-44ae-a38e-26b2f08eb84b/scratchpad/rev/`.

axe-core (wcag2a, wcag2aa, best-practice):
- `/offline.html`: 0 violations in both themes (run with `bypassCSP`, since the page's own CSP correctly blocks the injected axe script).
- `/profil`: 1 violation in both themes, `color-contrast` on the overdue dues chip (`[data-testid=dues-status][data-state=overdue]`): 3.37:1 light (`#161929` on `#d02b31`), 2.69:1 dark (`#f1eee7` on `#f3625d`). Root cause is the **running dev server serving stale CSS**: the served stylesheet has no `--absent-foreground` / `--present-foreground` / `--excused-foreground` at all, while `src/app/globals.css:108-110,176-178` and the production build CSS (`.next/static/chunks/057qoon_4_epz.css`: `--absent-foreground:#fcfcfc` / `var(--background)`, 5.0:1 and 6.2:1) are correct. See P2-3: the e2e that guards this only checks the class name, so it passed against this stale CSS.
- Install card: heading, 44 px button, focus ring, contrast all pass. No console errors or warnings on any page other than `[HMR] connected`.

**Action for the lead before UX screenshots and the final e2e run:** restart the dev server (Turbopack is not picking up `globals.css` edits; see implementation notes WP6–8). Every dev screenshot of solid status chips (dues, deadline, marking roster) currently shows the old text colour.

## SW cache audit (code reading)

Fetch order in `public/sw.js:80-118` is correct and matches D15/D16: non-GET → cross-origin → navigation (network only, offline page on failure, never stored) → `/api/`, `_rsc`, `RSC`, `next-router-*` → `/_next/static/` cache-first → un-hashed allow-list SWR → else untouched. I found **no path that can store authenticated HTML, RSC or API data**:
- Navigations never reach `store()`; a CSV/route-handler download is a navigation too, so it's network only.
- Server actions are POST; client-side RSC navigations carry `RSC` / `Next-Router-*` and hit non-allow-listed paths anyway.
- Allow-listed prefixes (`/brand/`, `/icons/`, `favicon.ico`, `icon.svg`, `apple-icon.png`, manifest, offline page) are excluded from the proxy matcher (`src/proxy.ts:60`), so they can't be answered by a login redirect; non-`ok` (404 page HTML) is never stored.
- Precache uses `credentials: "omit"`, `redirect: "error"`, `cache: "reload"`.
- Update path: `no-store` + `updateViaCache: "none"`, `skipWaiting`, old `VERSION` caches deleted, `clients.claim()`. Sound because nothing HTML is cached.
- Kill switch: deletes caches, unregisters, reloads controlled windows; the fetch handler is inert. Works by reading; see P3-2/P3-3 for side effects.

CSP: no inline script anywhere in the PWA code; `worker-src 'self'`, `manifest-src 'self'` cover registration and the manifest; the worker's own CSP (`default-src 'self'`) only constrains same-origin fetches it makes; `offline.html` has its own strict policy and stays script-free (confirmed: the browser blocks an injected script there).

Bundle: the lockup's `SUBTITLE_PATH` (9.9 kB) is **not** in any client chunk; only `ArkheMonogram` reaches the client via `install-card.tsx` (install card chunk 26 kB raw / 10 kB gzip, shared with other profile code). `PwaBoot` and `pwa-store` are a few hundred bytes. Acceptable.

Hydration: `InstallCard` uses `useSyncExternalStore` with a `hidden` server snapshot, so there is no mismatch; the card pops in after hydration (accepted CLS per D11). The logo components are server-rendered, no `useId`, no masks.

## Findings

### P1

None.

### P2

**P2-1 A production worker registered on `127.0.0.1:3100` keeps controlling `npm run dev` on the same origin and serves stale dev chunks cache-first.**
`package.json:11` runs `npm start` on the same origin as `npm run dev` (`127.0.0.1:3100`). After one `npm start` visit, the worker stays registered in the user's Chrome profile; `src/components/pwa-boot.tsx:20` only *skips* registration in dev, it never removes an existing one. `/sw.js` in dev returns the same bytes, so the browser never replaces it, and `public/sw.js:97-107` then serves `/_next/static/` **cache-first**. Turbopack's dev chunk names (`[root-of-the-server]__<id>._.css`) are not content hashes, so after an edit a full reload gets the old CSS/JS from the worker: exactly the "CSS looks stale" symptom, but only in the user's own browser, never in e2e (fresh contexts).
Fix in `pwa-boot.tsx`, one branch:
```ts
} else if ("serviceWorker" in navigator) {
  // A worker left behind by `npm start` on this origin must not serve dev chunks.
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
}
```
Optional belt-and-braces: move `start` to `-p 3101` like prod-e2e (README line 107 already explains the Render command).

**P2-2 AC 12 standalone test can pass without proving anything** (`e2e/phase6-a-brand.mjs:262-267`).
It waits for the server-rendered `Aidatım` heading plus a fixed `waitForTimeout(500)`, then asserts the card count is 0. The card only ever appears after hydration, so if hydration takes > 500 ms (Turbopack dev under load, which the implementation notes show happens), the assertion passes even if `isStandalone()` were deleted. Fix: make the stub record that it was consulted and wait for that, e.g. in the init script set `window.__standaloneQueried = true` inside the `display-mode: standalone` branch, then `await standalone.waitForFunction(() => window.__standaloneQueried)` before the count. Also add a second case with `Object.defineProperty(navigator, "standalone", { value: true })` (D12 covers iOS standalone too; implementation notes checked it by hand only).

**P2-3 The overdue-chip contrast test asserts a class name, not a colour** (`e2e/phase6-c-finance.mjs:318-323`).
It passed against a dev server whose CSS has no `--absent-foreground`, rendering 3.37:1 / 2.69:1 (see axe above). A class check can't catch a missing or wrong token. Fix: compute the contrast in the page, e.g. read `getComputedStyle(chip).color` and `backgroundColor`, convert with a 1×1 canvas (`ctx.fillStyle = c; ctx.fillRect; getImageData`) to sRGB, and assert ratio ≥ 4.5 in both themes; or run `axe.run(chip, { runOnly: ["color-contrast"] })` with the already-installed `axe-core` (the same file already injects axe for AC 36). Restart the dev server before the next full run.

### P3

**P3-1 Offline page: point the favicon at a precached icon** (`scripts/offline.template.html:9`).
The offline document has no `<link rel="icon">`, so Chrome asks for `/favicon.ico`; it goes through the worker (the console shows `ERR_FAILED`, i.e. a rejected `respondWith`), misses the SWR cache and fails. `e2e/lib.mjs:84-85` currently filters that error out. Fix: add after `<title>`
```html
<link rel="icon" href="/icons/icon-192.png" sizes="192x192" type="image/png" />
```
(`/icons/icon-192.png` is in `PRECACHE`, `public/sw.js:8`, and `img-src 'self'` allows it), regenerate with `npm run brand:assets`, then delete the `offlineFavicon` exception in `e2e/lib.mjs:84-85` so `e2e:prod` proves it. Alternative if ever needed: add `/favicon.ico` to `PRECACHE` instead.

**P3-2 Kill switch reloads every open tab without warning** (`public/sw.js:44-45`). A board member mid-way through a payment form loses their input. The reload isn't needed for safety (the fetch handler is already inert and pages drop the controller on their next navigation). Fix: delete the `matchAll` + `navigate` lines, or keep them and document the trade-off in the README kill-switch step.

**P3-3 After a kill, every page load re-registers the worker** (`src/components/pwa-boot.tsx:20-24`): install → activate → unregister on every navigation, one extra `sw.js` request and worker boot each time. Fine as an emergency measure; README step 9 should add "for a permanent off, also remove the `register` call in `pwa-boot.tsx` (or ship P2-1's unregister branch for production too)".

**P3-4 Responses wait for the cache write** (`public/sw.js:102-104`, `111-114`). `await store(req, res.clone())` before `return res` holds every cache miss until the clone is fully read, `put` and `cache.keys()` has run (≈30 concurrent misses on a first navigation, each enumerating up to 200 keys). Fix: `event.waitUntil(store(req, res.clone())); return res;` in the hashed branch, and in the SWR branch resolve `network` with `res` and put the store in `event.waitUntil`.

**P3-5 `isCacheable` hardening** (`public/sw.js:54-61`). Today only the allow-list keeps HTML out. Add `!res.redirected` and refuse `content-type` `text/html` (except the offline page, which is precached separately) and `text/x-component`, so a future route under `/brand/` or `/icons/` can never be stored by accident. One line each; no behaviour change today.

**P3-6 Navigation preload** (`public/sw.js:37-52, 88-92`). Every navigation now waits for the worker to boot before the network request starts (tens of ms on mid-range Android). Since the navigation branch is network-only, enable `self.registration.navigationPreload?.enable()` in activate and use `(await event.preloadResponse) ?? fetch(req)` inside the existing `catch` chain.

**P3-7 Install button: double tap and focus loss** (`src/components/install-card.tsx:49-55, 106-111`). A second tap before `userChoice` resolves calls `prompt()` again on a used event → unhandled `InvalidStateError`. After accepting, the button unmounts with focus on it and the `Eklendi.` text isn't announced. Fix: clear the stored prompt before `await prompt.prompt()` (or keep a `pending` flag that disables the button) and wrap in `try/catch` setting `dismissed`; give the state paragraph `role="status"` (or move focus to the `h2` with `tabIndex={-1}`).

**P3-8 Install card tile disappears in dark** (`src/components/install-card.tsx:70-71`). Dark `bg-stage` (`#1a1436`) on dark `bg-card` has no visible edge (`profil-dark-390.png`); the offline page solved the same case with a 9 % white border. Fix: add `dark:ring-1 dark:ring-border` (token, no hex) to the tile span.

**P3-9 Offline monogram hairlines are sub-pixel** (`scripts/brand-assets.ts:196`). `letterA(A_FULL, 0.7)` drawn 42 px tall gives 0.37 CSS px cuts; at DPR 1 they render as grey grain (`offline-light-1280.png`). Fix: use a cut of about one CSS pixel at that size (`79 / 42 ≈ 1.9` units) with `A_FULL`, or `MONOGRAM_PATH_SMALL`-style `A_TWO`; ux to pick. Same arithmetic for UX to judge on the header wordmark (`h-5`, cut 0.8 → 0.2 CSS px).

**P3-10 Header logo link: target and focus ring** (`src/app/(portal)/layout.tsx:46-47`). The link is 90.6 × 20 px with no class: below our 44 px rule (it passes WCAG 2.5.8 only via the spacing exception) and it relies on the UA outline. Fix: `className="-my-3 inline-flex min-h-11 items-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"` (layout height unchanged thanks to the negative margin).

**P3-11 `e2e/phase6-a-brand.mjs:48-51` crashes instead of failing** when the header wordmark isn't found (`box` is `null` → `TypeError`, run aborts). Use `box && box.height >= 18 …`.

**P3-12 Cache audit is URL-only** (`e2e/prod.mjs:354-370`). Also assert no cached response has `content-type` `text/html` other than `/offline.html`, and none is `text/x-component`: `(await caches.open(k)).match(req)` → `headers.get("content-type")`. Makes AC 15 independent of the allow-list regex being a copy of the worker's.

**P3-13 `Tekrar dene` goes to `/`, not the page the user was opening** (`scripts/offline.template.html:136`, spec `ux.md:222`, `ui.md:151`). Offline on `/yoklama?kod=…` or a homework link, "retry" drops them on the home page. `href=""` reloads the current URL with its query and needs no script. Counter-proposal for ux/PO; the e2e at `e2e/phase6-a-brand.mjs:189` would change with it. Not blocking.

**P3-14 Housekeeping.** `scripts/offline.template.html` is still flagged by prettier (implementation notes WP12): run `npx prettier --write` on it or list it in `.prettierignore`. `scripts/brand-assets.ts:78` hard-codes `79.5` where `MONOGRAM_BOX.width` is 80; name the A's ink width as a constant in `logo-geometry.ts`.

## Not findings (checked)

- `manifest.ts`: fields, colours from `brandColors`, maskable + any, shortcuts: correct; installability is covered by AC 11 in a persistent profile.
- `pwa-store.ts`: module state is only written on the client; the server snapshot never reads it.
- `next.config.ts`: later `/sw.js` and `/offline.html` entries override the global keys, only one CSP is sent (verified in the implementation notes and by the CSP block observed on `/offline.html`).
- `arkhe-logo.tsx`: `role="img"` + `aria-label`; inside links the link's `aria-label` wins; inside the install tile the wrapper is `aria-hidden`. No duplicated names.
