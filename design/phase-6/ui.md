# Phase 6 UI engineering plan

Author: UI engineer. Date: 2026-10-19. Reads: `po-spec.md` (no `ux.md`/`db.md`/`backend.md` yet), Next 16 docs (`02-guides/content-security-policy.md`, `02-guides/progressive-web-apps.md`, `02-guides/building.md`, `03-file-conventions/01-metadata/{manifest,app-icons}.md`, `03-file-conventions/{proxy,instrumentation}.md`), and the current `src/proxy.ts`, `next.config.ts`, `src/app/layout.tsx`, `src/components/arkhe-logo.tsx`, `scripts/brand-assets.mjs`, `e2e/lib.mjs`.

Facts I checked before planning:
- `sharp` is already in `node_modules` (pulled in by `next`, with `@img/sharp-darwin-arm64`) and `scripts/brand-assets.mjs` already uses it. Plan: add it explicitly as a devDependency (Apache-2.0) so the script doesn't depend on a transitive install. sharp can't write `.ico`, so we write the ICO container ourselves (PNG-in-ICO, about 15 lines). No new dependency for that.
- `next build` deletes `.next` **except** `dev`, `cache`, `diagnostics`, `lock`, `trace` (`node_modules/next/dist/build/index.js`, the clean step), and `next dev` writes to `.next/dev` (`building.md`). So `npm run e2e:prod` can build while the dev server on 3100 keeps running. No separate `distDir` is needed. If the tech lead still wants isolation, use `distDir: process.env.NEXT_DIST_DIR ?? ".next"`.
- No inline `<script>` comes from our libraries. We don't mount `next-themes`' `ThemeProvider`, which is the only inline-script source in the tree (`sonner.tsx` only calls `useTheme`, which falls back to a no-op context). `sonner` injects a `<style>` from JS, and `next/font` emits inline `<style>`. Both are covered by `style-src 'unsafe-inline'`. `qrcode.react` renders SVG. Base UI has a `CSPProvider` for its own `<style>` elements, and we don't need it while `style-src 'unsafe-inline'` stays.
- Token hex values, measured in real Chrome (canvas fill of the `globals.css` oklch values): light `--background` `#f9f6f1`, dark `--background` `#0d0b19`, light `--stage` `#26214e`, dark `--stage` `#1a1436`, `--stage-foreground` `#f9f5ec`. The current `viewport.themeColor` (`#f8f5ef` / `#120f24`) has drifted from the tokens. The dark value is visibly lighter than the page.

---

## Replies to the PO, by AC

### AC 1–3, 5: logo components and files
- **Single geometry source:** `src/lib/brand/logo-geometry.ts`, pure data and functions with no React and no colours.
  - It exports path strings for the closed-outline strokes (drawn with `fill-rule="evenodd"`: outer outline minus the gaps, which gives the hairlines as filled shapes).
  - It exports `monogram(hairlines: 5 | 3 | 1)` and the subtitle glyph paths (generated, see below).
  - Filled paths replace today's mask and `useId` approach. That means no `<mask>` ids to collide when the logo renders twice (sidebar and mobile header), and crisper rasterisation at small sizes.
- **`src/components/arkhe-logo.tsx`:** we keep the export names `ArkheLockup` and `ArkheWordmark` so the call sites don't churn, and add `ArkheMonogram`.
  - All three are server-safe `<svg role="img" aria-label=… fill="currentColor">`.
  - The lockup is **one SVG**, wordmark plus subtitle as paths. The subtitle tracking is baked into the geometry, so it spans the wordmark width exactly at any size, the e2e finds one `svg[role=img][aria-label="Arkhe Mülkiye Çoksesli Korosu"]`, and no font loading is involved.
  - The two `aria-label` values are exactly as in AC 2.
- **Call sites (AC 3):**
  - Mobile header: `src/app/(portal)/layout.tsx:47` `ArkheWordmark className="h-5"` gives 20 px. At about 4.3:1 aspect that's about 86 px wide, under 50 % of 375. Keep it.
  - Sidebar: `src/app/(portal)/layout.tsx:29` `ArkheLockup className="w-36"` is **144 px, below the 160 px subtitle floor**. Change it to `w-44` (176 px; the aside has about 200 px usable).
  - Login: `src/components/auth-layout.tsx:20` `w-56` is fine. `:46` `w-40` is exactly 160 px, which is allowed. Keep it or bump to `w-44`.
- **Subtitle to paths (risk 4):**
  - Font tool: `fontkit` (MIT, devDependency, used only by `scripts/brand-assets.ts`). It reads TTF/WOFF2 and supports variable instances via `font.getVariation({ wght: 500 })`.
  - Font file: Jost variable TTF from `github.com/google/fonts/ofl/jost` (SIL OFL 1.1), stored once at `brand/fonts/Jost[wght].ttf` with `brand/fonts/OFL.txt`.
  - `opentype.js` doesn't instance variable fonts, so we would need a static Medium TTF. That's why fontkit.
  - The script writes the subtitle glyph outlines into `src/lib/brand/logo-geometry.generated.ts`, so the runtime has no font dependency.
  - `İ` (U+0130) and `Ç`/`Ü` are in the TTF, so there are no subset gaps.
- **Standalone files (AC 5):** the same script writes `public/brand/arkhe-lockup.svg`, `arkhe-wordmark.svg` and `arkhe-monogram.svg`. Each is `fill="#000"` on a transparent background, with `<title>` and no `<text>`.
  - These are asset files, not components, so the no-hex rule doesn't apply.
  - `proxy.ts` already skips `brand/` and `*.svg`, so the files are public. `next start` serves `.svg` as `image/svg+xml`.

### AC 4, 6: no UI-engineering objection
- `.staff-lines` lives in `src/app/globals.css:215`.
- A 5-line group with a 1:1 ratio is a `repeating-linear-gradient` with the period equal to 2 × the line thickness, inside a block 9 × that thickness tall.
- I'll check it at 1× and 2× DPR in the review, because sub-pixel hairlines (<1 px) shimmer on 1× screens. Floor the hairline at 1 px.

### AC 7–8: icons
**Script:** rename `scripts/brand-assets.mjs` to `scripts/brand-assets.ts` and run it with `tsx` (already a devDependency), so it can import `src/lib/brand/logo-geometry.ts`. New npm script `"brand:assets": "tsx scripts/brand-assets.ts"`. It's dev-only, and the outputs are committed.

**Outputs:**

| File | Size | Source variant | Background |
|---|---|---|---|
| `src/app/favicon.ico` | 16 + 32 (two PNG entries) | 16 solid, 32 three hairlines | stage tile |
| `src/app/icon.svg` | vector | 3-hairline monogram | tile with an internal `@media (prefers-color-scheme: dark)` swap: light = `#26214e` tile / `#f9f5ec` mark; dark = `#f9f5ec` tile / `#26214e` mark, so the tab icon doesn't vanish on a dark tab strip (@ux: confirm or choose) |
| `public/icons/icon-192.png`, `icon-512.png` | 192, 512 | 5 hairlines | `#26214e` rounded tile (rx 22 %) on transparent |
| `public/icons/icon-maskable-512.png` | 512 | 5 hairlines | full-bleed `#26214e`. The mark is about 56 % of canvas height, so its bounding-box half-diagonal stays under 0.4 × 512 = 204.8 px (central 80 % circle). The script asserts this numerically. |
| `src/app/apple-icon.png` | 180 | 5 hairlines | `#26214e` full-bleed. sharp `.flatten({ background }).removeAlpha()`, so IHDR colour type is 2 (RGB) |

- `favicon.ico`, `icon.svg` and `apple-icon.png` use the `src/app` file conventions, so Next emits the `<link>` tags with `sizes`/`type`.
- Note that `icon` and `apple-icon` URLs get a `?<hash>` query. AC 8 tests must resolve the `href`s from the HTML, not hard-code them.
- Chrome prefers `icon.svg` over `favicon.ico` in tabs. That's why the SVG uses the 3-hairline variant: on a 1× screen at 16 px it's acceptable, and on 2× it's 32 device px. The ICO 16 px solid variant serves legacy and Safari.
- The current `src/app/icon.svg` is replaced. Its raw hex lives in an asset, which is fine.

### AC 9: manifest
- File: `src/app/manifest.ts` returning `MetadataRoute.Manifest`. It's static (no request-time API), so it's prerendered and served as `/manifest.webmanifest`, and Next adds `<link rel="manifest">` automatically.
- Fields are exactly as in AC 9:
  - `background_color: "#0d0b19"` (dark `--background`)
  - `theme_color: "#26214e"` (light `--stage`)
  - icons: 192 `any`, 512 `any`, maskable 512 `purpose: "maskable"`, all under `/icons/`
  - `shortcuts`, each with the 192 icon (Chrome warns without one)
- Hex lives in **one** place, `src/lib/brand/colors.ts`, with a one-line comment "mirrors oklch tokens in globals.css; measured in Chrome". It's imported by `manifest.ts`, `layout.tsx` (`viewport.themeColor`) and `scripts/brand-assets.ts`.
- **Theme colour per theme:** `viewport.themeColor` becomes light `#f9f6f1` / dark `#0d0b19` (exact `--background`), replacing the drifted pair. The status bar then matches the `bg-background/85` sticky header in both themes.

### AC 10: public paths
- `src/proxy.ts` matcher already excludes `.webmanifest`, `.png`, `.svg` and `.ico`, so the manifest and icons never hit the proxy.
- Add `sw\\.js` and `offline\\.html` to the exclusion, because these two must never get an auth redirect or the page CSP:
  ```
  "/((?!_next/static|_next/image|brand/|icons/|sw\\.js$|offline\\.html$|.*\\.(?:svg|png|ico|webp|jpg|jpeg|webmanifest)$).*)"
  ```
- `/api/saglik` is already public via the `/api/` prefix.

### AC 11: installability, and an infeasibility to flag
- **Playwright's `browser.newContext()` is an off-the-record (incognito) profile.** In incognito, Chrome's `Page.getInstallabilityErrors` returns `in-incognito`, and `beforeinstallprompt` never fires.
- `e2e/prod.mjs` must therefore use `chromium.launchPersistentContext(<tmp profile dir>, { channel: "chrome" })`, with the directory under `os.tmpdir()` and deleted at the end. This is a small addition to `e2e/lib.mjs` (`launchPersistent()`); everything else in the harness stays the same.
- With that, the criteria we need to meet are a manifest with `name`, `short_name`, `start_url`, `display`, 192 + 512 PNG and `id`, served from a potentially trustworthy origin (`127.0.0.1` qualifies).
- We don't rely on the old "SW with fetch handler" requirement, but we meet it anyway.

### AC 12: install card
Files:
- `src/lib/pwa-store.ts`, a tiny external store: deferred `BeforeInstallPromptEvent`, `subscribe`, `getSnapshot`.
- `src/components/pwa-boot.tsx` (client, rendered once in the root layout, renders `null`):
  1. On mount it adds `beforeinstallprompt` (`preventDefault()` and store the event) and `appinstalled` (clear) listeners **on every page**. The event usually fires on the first page load, typically `/`, not on `/profil`, so a listener mounted only in the card would miss it after client-side navigation.
  2. It registers the SW, production only (see AC 13).
- `src/components/install-card.tsx` (client), placed at the bottom of `src/app/(portal)/profil/page.tsx`:
  - It reads the store and the platform through `useSyncExternalStore` with a server snapshot of `"unknown"`, which renders nothing on the server. That way there's no hydration mismatch, and nothing flashes in standalone.
  - It shows nothing when `matchMedia("(display-mode: standalone)")` matches or `navigator.standalone === true` (iOS).
  - It's a `Card` titled `Telefonuna ekle`.
  - When a stored prompt exists: `Button` `Ana ekrana ekle` (44 px, `min-h-11`), which calls `prompt()`, awaits `userChoice` and then clears the store.
- **@po/@ux, counter-proposal on the "otherwise" branch:** AC 12 shows the iOS Safari text to everyone without a prompt, which would include desktop Chrome, Firefox Android and Samsung Internet. That's wrong advice for them. Proposal:
  - iOS/iPadOS (UA `iPhone|iPad`, or `Macintosh` with `maxTouchPoints > 1`): `Safari'de Paylaş simgesine, sonra "Ana Ekrana Ekle"ye dokun.`
  - Any other browser without a prompt: `Tarayıcı menüsünden "Ana ekrana ekle" ya da "Uygulamayı yükle"yi seç.`
  - The card is still always visible in a normal tab, so the e2e is unchanged: in dev headless Chrome no prompt fires, the generic text shows, and the test asserts the title only.
- Gate (hidden in standalone): `page.emulateMedia` can't emulate `display-mode`. Use CDP `Emulation.setEmulatedMedia({ features: [{ name: "display-mode", value: "standalone" }] })`, which Chrome supports, in the prod suite.

### AC 13: SW registration
- In `pwa-boot.tsx`: `if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })`.
- `NODE_ENV` is inlined at build, so the dev bundle doesn't contain the call. Dev (3100) and prod-e2e (3101) are different origins, so a prod SW can never leak into dev.
- `sw.js` headers in `next.config.ts` (`source: "/sw.js"`):
  - `Cache-Control: no-cache, no-store, must-revalidate`
  - `Content-Type: application/javascript; charset=utf-8`
  - `Content-Security-Policy: default-src 'self'; script-src 'self'` (PWA guide)
- `/offline.html` gets its own CSP: `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.

### AC 14–15: `public/sw.js` rules
It's hand-written with no imports. Structure, for the tech lead:
```js
const VERSION = "arkhe-v1";            // bump on every sw.js change
const KILL = false;                     // kill switch, see below
const PRECACHE = ["/offline.html", "/icons/icon-192.png", "/manifest.webmanifest"];
const STATIC = /^\/(_next\/static\/|brand\/|icons\/|favicon\.ico$|icon\.svg$|apple-icon\.png$)/;
```
- **install:** fetch each `PRECACHE` URL with `{ cache: "reload", redirect: "error", credentials: "omit" }`. Reject unless `res.ok`. `redirect: "error"` makes it impossible to precache `/giris` if a proxy change ever redirects `/offline.html`. Then `skipWaiting()`.
- **activate:** delete every cache whose key isn't `VERSION`, then `clients.claim()`.
- **fetch**, in this order. The first match wins, and everything that isn't explicitly handled falls through to the network untouched (no `respondWith`):
  1. `req.method !== "GET"` → return (server actions are POST).
  2. Cross-origin → return.
  3. `req.mode === "navigate"` → `respondWith(fetch(req).catch(() => caches.match("/offline.html")))`. The response is **never** put in a cache.
  4. `/api/`, `_rsc=` in the search, or an `RSC`/`Next-Router-State-Tree`/`Next-Router-Prefetch` header → return.
  5. Pathname matches `STATIC`, plus `/manifest.webmanifest` and `/offline.html`:
     - `/_next/static/` (content-hashed): cache-first.
     - Un-hashed files (`/brand/`, icons, manifest): stale-while-revalidate (counter-proposal, below).
  6. Anything else → return.
- **Put guard:** cache only if `res.ok && res.type === "basic" && !res.headers.has("set-cookie") && !/private|no-store/i.test(res.headers.get("cache-control") ?? "")`.
  - Next serves `/_next/static` as `public, max-age=31536000, immutable`, so it passes.
  - SW `fetch` responses never expose `Set-Cookie`, so that check is belt-and-braces. The `Cache-Control` check is the real guard.
- **Cap:** after each put, if the cache holds more than 200 entries, delete the oldest. `keys()` is in insertion order. Without a cap, every deploy's hashed chunks pile up as long as `VERSION` isn't bumped.
- **@po, counter-proposal for AC 14b:** use stale-while-revalidate instead of cache-first for the **un-hashed** allow-listed files. With pure cache-first, a redrawn icon or brand image would be stuck on phones until someone bumps `VERSION`. SWR still stores only allow-listed URLs, so the AC 15 audit is unaffected. Hashed `/_next/static/` stays cache-first.
- **Kill switch (risk 5):** setting `KILL = true` and deploying makes the worker do this:
  - on install: `skipWaiting()`
  - on activate: delete **all** caches, `self.registration.unregister()`, then `client.navigate(client.url)` for each window client
  - no fetch handler

  Because `sw.js` is `no-store` and registered with `updateViaCache: "none"`, every client picks it up on its next navigation. The README "Deploy" section documents this as a three-line procedure, and the same branch is in the file, so nobody has to write it under pressure.

### AC 16–17: offline page
- `public/offline.html` is a static file, not a Next route. A route would need nonce'd scripts, the session and the layout. This page needs no JS by spec and must be precacheable as a single, cookie-free response.
- **One file:**
  - CSS inline in `<style>`. That satisfies "its own CSS" in AC 14a without a second precache entry. It's allowed by its own CSP and by the page CSP's `'unsafe-inline'`.
  - The monogram inline as `<svg role="img" aria-label="Arkhe" fill="currentColor">`, pasted by `scripts/brand-assets.ts` from the geometry. No image request.
  - `<html lang="tr">`, `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`, `<meta name="color-scheme" content="light dark">`, and the two `theme-color` metas.
  - Colours: the hex from `colors.ts` written in by the generator, light by default and dark under `@media (prefers-color-scheme: dark)`. The generator templates this file from `scripts/offline.template.html`, so the hex never drifts from the tokens.
  - Fonts: a system stack (`ui-sans-serif, system-ui`; heading `ui-serif, Georgia`). Jost and Geist are hashed `/_next/static/media` files we can't name stably.
- Copy exactly as AC 16. `Tekrar dene` is an `<a href="/">` styled as the primary button (min-height 44 px, visible `:focus-visible` ring). In light theme the button is `--stage` with `--stage-foreground`; in dark it's the gold primary with dark text. Both pairs are above 4.5:1.
- The SW serves this page under the **original** URL (for example `/repertuvar`), so `Tekrar dene` → `/` is right.
- **AC 17:**
  - Navigations are never cached, and dynamic pages are sent `no-store`, so the HTTP cache doesn't have them either.
  - After logout, an offline `goto` of a visited page can only produce the offline page.
  - Known caveat, not covered by the AC: the browser **back** button can restore a page from bfcache. Chrome evicts `no-store` pages from bfcache when cookies change, and logout changes the cookie.

### AC 18: update path
1. The browser byte-compares `sw.js` on every navigation, because of `no-store` + `updateViaCache: "none"`.
2. A changed file installs and calls `skipWaiting()`.
3. On activate it calls `clients.claim()` and deletes caches whose key isn't the new `VERSION`.

Open tabs keep their already-loaded JS. Their next navigation is HTML from the network that references new hashed chunks, and those are fetched and cached on demand. This is safe only because no HTML is cached. A reviewer must reject any future change that caches navigations.

### AC 19: nonce CSP and rendering
- **`src/proxy.ts`:**
  - Nonce: `Buffer.from(crypto.randomUUID()).toString("base64")`. Proxy runs on Node by default in 16.
  - Build the CSP string. Set it on the **request** headers (`content-security-policy`, plus `x-nonce`) so Next can extract the nonce during SSR, and on the response.
  - The auth redirect branch stays first. A redirect needs no CSP.
- **Directives:**
  - `default-src 'self'`
  - `script-src 'self' 'nonce-…' 'strict-dynamic'`, plus `'unsafe-eval'` when `NODE_ENV === "development"` (the docs' check, not `!== "production"`)
  - `style-src 'self' 'unsafe-inline'`
  - `img-src 'self' data: blob:`
  - `font-src 'self'`
  - `connect-src 'self'`
  - `frame-src https://drive.google.com https://www.youtube-nocookie.com`
  - `worker-src 'self'`
  - `manifest-src 'self'`
  - `frame-ancestors 'none'`
  - `base-uri 'self'`
  - `form-action 'self'`
  - `object-src 'none'`
- **Do not add `upgrade-insecure-requests`.** prod-e2e runs on `http://127.0.0.1:3101`, and HSTS covers this on Vercel anyway.
- Under `'strict-dynamic'`, Next's chunk loader (dynamically inserted `<script src>`) is trusted transitively, and `'self'` is ignored by CSP3 browsers, which is expected.
- **Dynamic rendering (risk 2):**
  - Today `/giris` (it calls `getSessionUser()`, which reads cookies), `/davet/[token]` and every portal page are already dynamic.
  - The static leftovers are `/_not-found` and anything without a request-time API.
  - Fix in one place: `await connection()` at the top of `RootLayout` in `src/app/layout.tsx`, which makes it `async`. That makes every page dynamic, so every page gets the nonce. For about 60 users this costs nothing measurable.
  - Metadata routes (`manifest.webmanifest`, icons) are separate route handlers and stay static, which is correct because they carry no scripts.
- **Moves:** the CSP comes out of `next.config.ts`. `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS (production) and `poweredByHeader: false` stay there.
- **e2e:** take the nonce from the response header and compare it with every `<script nonce=…>` in `await response.text()`. Use the raw HTML because `getAttribute("nonce")` is blanked after parse, as the PO notes. RSC flight `<script>`s (`self.__next_f.push`) are inline and must carry the nonce too, which is a good canary.

### AC 20: violations listener
- Add to `newPage()` in `e2e/lib.mjs`: `context.addInitScript(() => { window.__csp = []; addEventListener("securitypolicyviolation", e => window.__csp.push(e.violatedDirective + " " + e.blockedURI)); })`.
- Also count console messages starting with `Refused to`. That catches violations in the SW, which has no `window` listener.
- Add a helper `cspViolations(page)`.
- Expected trouble spot: the Drive preview iframe. It's covered by `frame-src`; its inner CSP is Google's, not ours.

### AC 21–22
No UI work. In `next.config.ts`, change `isDev` to `process.env.NODE_ENV === "development"` so `NODE_ENV=test` can't drop HSTS.

### AC 36: UI carry-overs
- `src/app/(portal)/finans/hareketler/page.tsx:103/111` (`aria-label` on the disabled `Sonraki ay`): the disabled variant must be a `<span aria-disabled="true" role="link">` or a disabled `<button>` with its own label. A bare `span` with `aria-label` is what triggers `aria-prohibited-attr`.
- `text-white` on `bg-absent`: `src/components/finance/dues-chip.tsx:25` and `src/components/homework/deadline-chip.tsx:29`. Replace with `text-absent-foreground`, a new token pair in `globals.css` (light `oklch(0.99 0 0)`, dark `var(--background)`), so it's not a hard-coded colour. The `labels.ts:69/81/87` `solid` variants get matching `*-foreground` tokens in the same pass.

---

## `npm run e2e:prod`: how it runs (`e2e/prod.mjs`)
1. `package.json`: `"e2e:prod": "node --env-file-if-exists=.env e2e/prod.mjs"`.
2. **Build:** run `next build` with `NODE_ENV=production`, `APP_URL=http://127.0.0.1:3101` and `DATABASE_URL=file:data/e2e-prod.db`.
   - This is safe next to the running dev server (see the facts above).
   - Fail-fast in `instrumentation.ts` must skip `process.env.NEXT_PHASE === "phase-production-build"`. Otherwise a build without prod env would refuse to build (@backend).
3. **DB and admin:** delete `data/e2e-prod.db*`, migrate it (`drizzle-kit migrate` with `DATABASE_URL` overridden), and create one admin with a non-`.local` email (`e2e-admin@example.org`).
   - **AC 15 vs AC 24 conflict:** AC 15 says "log in as yk@", but AC 24 refuses every `@arkhe.local` login in production. So prod-e2e can't use the demo board account.
   - Plan: run `seed.ts` **before** the server starts, without `NODE_ENV=production`. It's allowed because the DB is `file:` and the seed process isn't production.
   - Then rename the board user in SQL to `e2e-yk@example.org`, which keeps their role, finance data and member links. The walk logs in as that user.
   - Leave one `@arkhe.local` user in place for the AC 24 refusal check.
4. **Server:** `spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", "3101"], { env: { …, NODE_ENV: "production" } })`. Wait for `GET /api/saglik` → 200.
5. **Browser:** `launchPersistentContext(tmpdir)` with `channel: "chrome"`. The persistent profile is required for AC 11; SW and CacheStorage work on `http://127.0.0.1`.
   - Login via `127.0.0.1:3101`. Chrome treats loopback as potentially trustworthy, so `__Host-` + `Secure` cookies are stored. If not, use the PO's `localhost` fallback.
6. **Checks, in order:**
   1. headers and CSP (AC 19, 21)
   2. cookies from the raw `Set-Cookie` (AC 22)
   3. demo-domain login refused (AC 24)
   4. installability on `/giris` and `/` (AC 11)
   5. wait for SW control: `await page.evaluate(() => navigator.serviceWorker.ready)`, then reload so the page is controlled
   6. AC 15 walk plus the cache audit
   7. violations (AC 20)
7. **Offline (AC 16–17), deterministic:** prepare two contexts' pages, one logged in and one after logout, each having loaded `/` once while controlled. Then:
   1. Try `context.setOffline(true)` and navigate to `/repertuvar`.
   2. If the title isn't `Çevrimdışı · Arkhe` (Playwright's offline emulation has historically not covered service-worker fetches), **kill the server** (`SIGTERM`, wait for exit) and navigate again. `ERR_CONNECTION_REFUSED` makes the SW's `fetch` reject, so the fallback must serve.
   3. Log which path was used.
   4. Check at 375×812 with `emulateMedia({ colorScheme: "light" | "dark" })`: `scrollWidth <= clientWidth`, `Bağlantı yok` and `Tekrar dene` are visible, and no portal heading text is present.
   
   Run this group last because the server may be gone.
8. **AC 27:** in a separate step, spawn `next start` on 3102 with `APP_URL=ftp://x`. Expect exit code ≠ 0 within 15 s and `APP_URL` in stderr.
   - @backend: if a throw in `register()` only logs and doesn't exit under `next start`, use `console.error(...)` + `process.exit(1)` guarded by `NEXT_RUNTIME === "nodejs"`.
9. **Teardown in `finally`:** kill servers, close the context, remove the temp profile and `data/e2e-prod.db*`. Leave `.next/` in place; it's the prod build and harmless.

## File list (implementation)
New:
- `src/lib/brand/logo-geometry.ts`
- `src/lib/brand/logo-geometry.generated.ts`
- `src/lib/brand/colors.ts`
- `src/app/manifest.ts`
- `src/app/favicon.ico`
- `src/app/apple-icon.png`
- `public/icons/icon-{192,512}.png`
- `public/icons/icon-maskable-512.png`
- `public/brand/arkhe-{lockup,wordmark,monogram}.svg`
- `public/sw.js`
- `public/offline.html`
- `scripts/offline.template.html`
- `scripts/brand-assets.ts` (replaces `.mjs`)
- `brand/fonts/Jost[wght].ttf`
- `brand/fonts/OFL.txt`
- `src/lib/pwa-store.ts`
- `src/components/pwa-boot.tsx`
- `src/components/install-card.tsx`
- `e2e/prod.mjs`
- `e2e/phase6-*.mjs`

Changed:
- `src/app/icon.svg` (regenerated)
- `src/app/layout.tsx` (`connection()`, `PwaBoot`, themeColor from `colors.ts`)
- `src/proxy.ts`
- `next.config.ts`
- `src/components/arkhe-logo.tsx`
- `src/app/(portal)/layout.tsx` (sidebar `w-44`)
- `src/app/(portal)/profil/page.tsx` (`InstallCard`)
- `e2e/lib.mjs` (CSP listener, `launchPersistent`)
- `package.json` (`brand:assets`, `e2e:prod`; devDeps `sharp`, `fontkit`)

## Infeasible or needs a decision
1. **AC 11 in a default Playwright context is infeasible** (`in-incognito`). It needs `launchPersistentContext`, as planned above.
2. **AC 12 "otherwise iOS text"** gives wrong advice off iOS. Counter-proposal above, with no e2e impact.
3. **AC 14b cache-first for un-hashed icons and brand images** pins stale art. Counter-proposal: SWR for those, cache-first for hashed static.
4. **AC 12 standalone gate:** `page.emulateMedia` can't emulate `display-mode`. Use CDP `Emulation.setEmulatedMedia` with the `display-mode` feature.
5. **AC 15 "log in as yk@" contradicts AC 24** (demo logins refused in production), and AC 25 forbids fixtures under `NODE_ENV=production`. Plan: seed before starting the server (the DB is `file:`), then rename the board user to a non-`.local` email for the walk.
6. **Sidebar lockup at 144 px** breaks the AC 3 160 px floor today. Fixed by `w-44`.
