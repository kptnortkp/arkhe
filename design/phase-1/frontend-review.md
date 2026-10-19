# Frontend review — Phase 0 → Phase 1

Author: frontend. Scope: code review of the Phase 0 frontend, Phase 1 architecture, PWA plan, brand image pipeline.
Checked against the bundled Next 16.4.2 docs (`node_modules/next/dist/docs/`). `npm run lint` and `npm run typecheck` are clean today.
Screenshots (390px light/dark, desktop) were taken against http://127.0.0.1:3100.

Priority legend: **P0** fix before/with Phase 1 · **P1** fix in Phase 1 · **P2** polish, do when touching the file.

---

## 1. Code review

### 1.1 Bugs / correctness

| # | Pri | Where | Issue | Fix |
|---|---|---|---|---|
| B1 | P0 | `src/app/(portal)/page.tsx:16-24` | `Intl.DateTimeFormat("tr-TR", …)` has no `timeZone`. Server renders in the host TZ: on Vercel (UTC) the 19:30 rehearsal shows **16:30**. Also violates the CLAUDE.md rule. | Create `src/lib/format.ts` with shared formatters, all with `timeZone: "Europe/Istanbul"` (`formatDate`, `formatTime`, `formatDateTime`). Use everywhere; never `new Intl.DateTimeFormat` inline. |
| B2 | P0 | `src/app/(portal)/page.tsx:37` | Greeting "İyi akşamlar" is hard-coded. | `greeting(now)` in `src/lib/format.ts` using the Istanbul hour (`Intl…{hour:"numeric", hourCycle:"h23", timeZone}`): 05–11 "Günaydın", 12–17 "İyi günler", 18–04 "İyi akşamlar". Computed on the server per request (page is dynamic once auth lands, so no hydration mismatch). |
| B3 | P1 | `src/components/shell/app-nav.tsx:8-10` | `pathname.startsWith(href)` also matches `/uyeler-arsiv` etc. | `pathname === href \|\| pathname.startsWith(href + "/")`. |
| B4 | P1 | `src/app/(portal)/layout.tsx:8-15` | `initials()` is local to the layout; `"Ali  Veli"` (double space) and `"Mert Ali Temiz"` → "MA" (Turkish users usually expect first+last). It will be needed in members list/user menu too. | Move to `src/lib/format.ts`: `name.trim().split(/\s+/)`, take first and last word, `toLocaleUpperCase("tr")`. |
| B5 | P1 | `src/components/ui/sonner.tsx:8` + `src/app/layout.tsx:38` | Toaster calls `useTheme()` from `next-themes` but there is no `ThemeProvider`; it silently falls back to `"system"`. Works by accident; dark mode is driven only by `@media (prefers-color-scheme)` (`globals.css:5`), so next-themes can never toggle anything. | Either pass `theme="system"` from the root layout and drop the hook (no hand-edit needed: `<Toaster theme="system" />` overrides via `{...props}`), or — if we want a manual theme switch (product decision, §6) — add `ThemeProvider attribute="class"` and change the custom variant to `.dark`. Recommend: keep system-only, remove `next-themes` usage. |
| B6 | P1 | `src/app/layout.tsx:23-28` | `themeColor` hexes don't match the tokens: dark `#14152a` vs actual `--background` ≈ `#0c0e1a`; light `#f7f3ec` vs ≈ `#f9f6f1`. Visible as a coloured band above the sticky header in Android Chrome / installed PWA. | Use `#f9f6f1` / `#0c0e1a` (hex is required by the meta tag; keep a one-line comment pointing at the token). Same values go into `manifest.ts`. |
| B7 | P1 | `src/app/(portal)/page.tsx:64` | Raw colour `text-[oklch(0.22_0.03_275)]` on the gold button breaks the "no raw colours" rule. | Add `--gold-foreground` token (both themes `oklch(0.22 0.03 275)`, contrast 8.0 / 9.2) + `--color-gold-foreground` in `@theme`; use `text-gold-foreground`. Better: a `gold` variant in our own wrapper, not by editing `ui/button.tsx`. |
| B8 | P2 | `src/app/giris/page.tsx:30-52` | Preview form: no `name` attributes, no `required`, `type="button"`. Expected for Phase 0; listed so Phase 1 doesn't miss it. | See §2.4. |

### 1.2 Accessibility

| # | Pri | Where | Issue | Fix |
|---|---|---|---|---|
| A1 | P0 | `src/lib/labels.ts:21-24` (`VoicePartBadge`) | Badge text contrast on its tinted pill (12px text, needs 4.5:1). Light: **alto 2.53**, soprano 3.36, tenor 3.46, bass 5.15. Dark: 4.10–4.37 (all just under). Voice part is shown on every list row, so this matters. | Add per-part *text* tokens separate from the fill tokens: `--soprano-ink`, `--alto-ink`, … Light ≈ L 0.45–0.48 at same hue/chroma (e.g. alto `oklch(0.47 0.11 60)`), dark ≈ L 0.80. Keep `--soprano` etc. for dots/bars. `VOICE_PART_STYLES.text` → `text-alto-ink`. Use the designer's values in `review-phase0.md` §3 (they also shift bass hue to 250, §9). |
| A2 | P0 | `src/app/globals.css:144`, `app-nav.tsx:21,53`, `page.tsx:139-155` | Nav links, "Tümü" link and piece cards have no `focus-visible` style; they fall back to the UA outline tinted `ring/50`, which in light is **1.65:1** against the background (WCAG 2.2 needs 3:1 for focus indicators). | Global: `@apply outline-ring` (full opacity, 4+:1 light, 5.6 dark) and add `:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }` in `@layer base`. shadcn controls already have their own ring. |
| A3 | P1 | `app-nav.tsx:18-28, 50-67` | Active link has no `aria-current="page"`; two `<nav>`s without labels. | `aria-current={active ? "page" : undefined}`; `aria-label="Ana menü"` on both navs (only one is rendered visibly; `display:none` removes the other from the a11y tree). |
| A4 | P1 | `src/app/(portal)/layout.tsx:23` | Sidebar is an `<aside>` (complementary landmark) wrapping primary nav + user block. | Use a plain `<div>` (or `<header>` on desktop) and keep the `<nav>` inside; `aside` is for tangential content. |
| A5 | P1 | `src/app/(portal)/layout.tsx:55` | No skip link. Keyboard users on desktop tab through 4 nav items on every page. | First child of body in the portal layout: `<a href="#main" className="sr-only focus:not-sr-only …">İçeriğe geç</a>`, `id="main"` on `<main>`. |
| A6 | P1 | `page.tsx:140-144` | "Tümü" link is ~20px tall — under the 44px touch target. | `inline-flex min-h-11 items-center px-2 -mr-2`. Same rule for any text link in lists. |
| A7 | P1 | `layout.tsx:48-52` | Mobile avatar is 32px. Fine while decorative, but it will become the profile/menu trigger in Phase 1. | When interactive, wrap in a 44px button (`size-11 grid place-items-center`) with `aria-label="Profil menüsü"`; avatar itself can stay 32px. |
| A8 | P1 | `page.tsx:94-104, 121-126` | Attendance dots and turnout bars are visual only; screen readers hear nothing for the 16 spans. Turnout has text, dots don't. | Dots container: `role="img" aria-label="16 çalışmadan 14'üne geldin"`; individual spans `aria-hidden`. Turnout bars: `aria-hidden` on the bar (the `11/13` text carries the info). |
| A9 | P2 | `ui/input.tsx` / `globals.css:76` | Light `--input` border vs background is **1.34:1**; WCAG 1.4.11 asks 3:1 for the field boundary. Common shadcn trade-off. | For Phase 1 forms use `border-foreground/25` on our form wrapper (≈3:1) or darken `--input` to ~`oklch(0.72 0.02 85)`. Designer call. |
| A10 | P2 | `globals.css:153-155` | Only h1–h3 get the display font; CardTitle (a `div`) also uses `font-heading`, fine. But card titles that act as section headings ("Bu dönem devamın") aren't headings for SR navigation. | Use `CardTitle render={<h2/>}`-style or put an `<h2>` inside; low priority. |
| A11 | P2 | `success` dots (light) | Filled vs empty dot 3.43:1 — OK for non-text (3:1). No action; noting it's at the edge if the designer lightens `--success`. | — |

Contrast values computed from the OKLCH tokens (script in scratchpad, not the repo).

### 1.3 Mobile

| # | Pri | Where | Issue | Fix |
|---|---|---|---|---|
| M1 | P0 | `src/app/layout.tsx:23` | `env(safe-area-inset-bottom)` in the bottom nav (`app-nav.tsx:41`) is **always 0** because the viewport has no `viewport-fit=cover`. In the installed iOS PWA the tab bar sits under the home indicator. | `viewport: { viewportFit: "cover", … }`. Then pad the sticky header with `pt-[env(safe-area-inset-top)]` (needed once we use `black-translucent`, §3) and add `pl/pr-[env(safe-area-inset-left/right)]` on header/nav for landscape. Add utilities in globals.css: `.pt-safe`, `.pb-safe`, `.px-safe`. |
| M2 | P1 | `src/app/(portal)/layout.tsx:55` | `pb-28` is fixed; with a real inset (34px) the nav is ~92px, still covered, but toasts/sticky action bars (Phase 1 forms) need the real height. | Define `--bottom-nav-h: 3.75rem` in CSS; main gets `pb-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+1.5rem)]`. Any page-level sticky footer (e.g. "Kaydet" on member edit) uses `bottom-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom))]`. |
| M3 | P1 | `src/app/layout.tsx:23` | On Android Chrome the fixed bottom nav rides up on top of the keyboard on login/profile forms and covers the submit button. | `interactiveWidget: "resizes-visual"` in `viewport` (supported in Next's `Viewport` type). Also hide the bottom nav on full-focus form routes if needed. |
| M4 | P1 | dev only | The Next dev indicator (bottom-left) sits on top of the "Ana sayfa" tab at 390px (see screenshot); every corner collides with something in the shell. | `next.config.ts`: `devIndicators: false` (docs: compile/runtime errors still surface). |
| M5 | P2 | `src/app/layout.tsx:38` | `<Toaster position="top-center" />` will render under the iOS status bar in standalone mode. | `<Toaster position="top-center" offset={{ top: "calc(env(safe-area-inset-top) + 12px)" }} mobileOffset={…} />` (props passed in, no hand-edit of `ui/sonner.tsx`). |
| M6 | P2 | `globals.css:151` | `-webkit-tap-highlight-color: transparent` removes tap feedback; nav links have no `active:` state, so taps feel dead on iOS. | Add `active:bg-muted` / `active:scale-[0.98]` on nav items and cards. |
| M7 | P2 | `page.tsx:61-76` | At 320px the two hero buttons (`Geldim` + `Gelemeyeceğim`, ~250px) barely fit the ~240px content box and will likely overflow (`flex gap-2`, no wrap). | `flex flex-wrap gap-2` or make `Geldim` full-width on `<sm`. |

### 1.4 Next 16 correctness

- `LayoutProps<"/">` / global route types: correct for both the root and the `(portal)` layout (route groups don't add a segment). ✅
- `middleware.ts` → `proxy.ts`, Node runtime by default, `runtime` export is not allowed in proxy (docs `03-file-conventions/proxy.md:253`). With `src/` it lives at `src/proxy.ts`.
- `cookies()` / `headers()` / `params` / `searchParams` are async — always `await`.
- `next/image`: `priority` is **deprecated** in 16 → use `preload`; `images.qualities` defaults to `[75]` (anything else must be allow-listed); `dangerouslyAllowLocalIP` defaults to false.
- `refresh()` (from `next/cache`) exists for Server Actions to refresh the client router without `revalidatePath`; useful after member edits on the same page.
- `forbidden()` / `unauthorized()` need `experimental.authInterrupts` — avoid experimental flags; use `notFound()` or `redirect()` (§2.2).
- `cacheComponents` is off, so any page that reads cookies is dynamic per request; no `"use cache"` concerns in Phase 1.
- `next-env.d.ts` and `tsconfig.tsbuildinfo` are git-ignored ✅. `data/` ignored ✅.

### 1.5 What will hurt when real auth lands

1. **Layout as the only gate.** The `(portal)` layout will read the user for the shell, but layouts don't re-run on client navigation and don't stop child segments/actions from executing (docs `authentication.md:1358-1364`). Every page and every server action must call the DAL itself. The layout's call is for *display*, not authorization.
2. **Awaiting the user in the layout blocks streaming** of `{children}` (docs `authentication.md:1370`). For us the shell *is* user-dependent (role filters the nav, avatar, voice part), and the query is a single indexed SQLite/Turso lookup, so I accept the await in the layout — but add `(portal)/loading.tsx` so navigations show a skeleton immediately (also prerequisite for any future `useOffline`).
3. **`previewUser` imported in 2 places** (`layout.tsx:6,18`, `page.tsx:12,27,159`). Replace with `getCurrentUser()`; keep `preview-data.ts` only for not-yet-built widgets (attendance stats, pieces) and delete it in Phase 2/3.
4. **Client nav gets `canManage` as a prop** — fine, keep it a prop (no context needed for one boolean). Never pass the full user row (password hash) to client components; DAL returns a DTO.
5. **Login ↔ portal redirect loop**: if the proxy bounces "has cookie" users away from `/giris`, a stale/revoked cookie loops `/` → `/giris` → `/`. Server Components cannot delete cookies. See §2.2 for the fix.
6. **React 19 form reset**: forms using `<form action={…}>` are reset after every submission, including failed validation, so the user loses what they typed. Return the submitted (non-secret) values in the action state and use them as `defaultValue` (§2.4).
7. **Testing on a phone**: dev binds `127.0.0.1`, and `navigator.clipboard` / service workers / `navigator.share` need a secure context. Plan: a free Cloudflare quick tunnel (`cloudflared tunnel --url http://127.0.0.1:3100`, no account) + `allowedDevOrigins` and `experimental.serverActions.allowedOrigins` for that host. Decision for the user (§6).

---

## 2. Phase 1 frontend architecture

### 2.1 Routes

```
src/app/
  layout.tsx                    root: <html lang="tr">, fonts, Toaster, viewport/metadata
  manifest.ts  icon.png  apple-icon.png          (PWA, §3)
  not-found.tsx  global-error.tsx                Turkish fallbacks
  (auth)/
    layout.tsx                  split layout: brand panel (desktop) / brand header (mobile) + centered form column
    giris/page.tsx              login
    davet/[token]/page.tsx      set password — used for both first invite and password reset
  (portal)/
    layout.tsx                  shell; await getCurrentUser() for display
    loading.tsx                 shell-preserving skeleton
    error.tsx                   "Bir şeyler ters gitti" + retry
    page.tsx                    home
    profil/page.tsx             name, phone, change password, Çıkış
    uyeler/page.tsx             list + filters (managers)
    uyeler/yeni/page.tsx        add member → shows invite link (managers)
    uyeler/[id]/page.tsx        edit role/part/active, regenerate invite/reset link (managers)
    yoklama/… repertuvar/…      unchanged placeholders
  cikis/route.ts                POST: delete session + cookie, redirect /giris (also GET target for the stale-cookie case)
src/proxy.ts
```

Notes:
- `/giris` moves from `src/app/giris` into `(auth)` — URL unchanged.
- Add vs. edit as full pages (not sheets) — counter-proposal to the designer's sheet, see Frontend notes in `phase1-screens.md`: deep-linkable, back button works, no focus-trap issues on iOS. A `Sheet` can be layered later via intercepting routes if the designer wants it on desktop — I'd rather not in Phase 1 (cost).
- `davet/[token]` serves both invite and reset; the page reads `users.passwordHash` to switch copy ("Aramıza hoş geldin" vs "Yeni şifre belirle"). Expiry differs per row (`invites.expiresAt`), so no schema change is needed.

### 2.2 Where session checks live

```
src/lib/auth/
  password.ts   server-only; scrypt hash/verify (node:crypto), timingSafeEqual
  session.ts    server-only; createSession(userId, remember), deleteSession(), token = 32 random bytes base64url,
                DB id = sha256(token); cookie "arkhe_session": httpOnly, secure in prod, sameSite "lax", path "/"
  dal.ts        server-only;
                getCurrentUser = cache(async () => UserDTO | null)   // reads cookie, joins sessions+users, checks expiry + isActive
                requireUser()    → UserDTO or redirect("/cikis?expired=1")
                requireManager() → requireUser() + role check, else notFound()
```

- **Proxy (`src/proxy.ts`) — optimistic only, no DB.** Matcher excludes `_next`, `brand`, `manifest.webmanifest`, `icon*`, `apple-icon*`, `sw.js`, `favicon.ico`. Rule: protected path + no `arkhe_session` cookie → redirect `/giris?next=<path>`. It does **not** redirect cookie-holders away from `/giris` (avoids the loop); instead `giris/page.tsx` calls `getCurrentUser()` and redirects to `/` if the session is actually valid.
- **Stale cookie**: `requireUser()` redirects to `/cikis?expired=1`, a route handler that *can* delete the cookie, then redirects to `/giris?expired=1` ("Oturumun sona erdi, tekrar giriş yap").
- **Sliding expiry** ("beni hatırla"): remember = 30 days, otherwise 12 hours (product decision §6). DAL extends `sessions.expiresAt` when less than half remains (one UPDATE, in render is fine). Cookie `maxAge` can only be re-set in a Server Action, Route Handler or Proxy — proxy re-issues the same cookie value with a fresh `maxAge` when present (no DB), DB stays authoritative.
- **`next` param**: only accept values that start with `/` and not `//` (open redirect).
- **Every server action** starts with `const me = await requireManager()` (or `requireUser()`), then re-validates the target (e.g. a board member can't demote the conductor — product rule to confirm).

### 2.3 Sharing the current user with the shell

- `(portal)/layout.tsx` is a Server Component: `const me = await getCurrentUser(); if (!me) redirect("/cikis?expired=1")`. Passes `canManage` to `SidebarNav`/`BottomNav` and `{ name, role, voicePart }` to a small client `UserMenu` (dropdown: Profil, Çıkış).
- `UserDTO = { id, name, email, phone, role, voicePart, isManager }` — never the hash. Pages call `getCurrentUser()` again; `cache()` dedupes within the request.
- No React context for now: nothing deep in the client tree needs the user. Revisit if Phase 2 live attendance needs it.

### 2.4 Server actions + forms

- One `actions.ts` per route folder (`uyeler/actions.ts`, `profil/actions.ts`, `(auth)/actions.ts`), `"use server"` at top.
- Shared state shape:
  ```ts
  type FormState<V> = { status: "idle" | "ok" | "error"; message?: string; fieldErrors?: Partial<Record<keyof V, string>>; values?: Partial<V> };
  ```
- Client form component: `const [state, action, pending] = useActionState(saveMember, initial)`. Inputs use `defaultValue={state.values?.name ?? member.name}` so React's post-submit reset doesn't wipe input. Password fields are never echoed back.
- Components to add in `src/components/form/`: `Field` (Label + Input + error `<p id>` wired via `aria-describedby` + `aria-invalid`), `SubmitButton` (uses `pending`, shows spinner, `disabled` + `aria-busy`), `FormAlert` (top-level `role="alert"` message).
- Validation: **no zod in Phase 1.** Six small forms, server-only validation, and the schemas aren't shared with the client. A ~40-line `src/lib/validation.ts` (`requiredString`, `email`, `phoneTR` normalising to `+90…`, `password` min 8, `oneOf(ROLES)`) is enough and adds no dependency. Client side we use native constraints (`required`, `type="email"`, `minLength`, `autoComplete`, `inputMode="tel"`) for instant feedback. If Phase 2/3 forms get complex (recurrence rules, file lists), adopt `zod/mini` then.
- Login error is always generic: "E-posta veya şifre hatalı." (no user enumeration). Deactivated user gets the same message.

### 2.5 Toasts and errors

- **Field/validation errors → inline**, never toasts (toasts vanish, aren't tied to the field, and are missed by SR users).
- **Success of an in-place action → toast** (`toast.success("Kaydedildi")`), fired from a `useEffect` on `state` change in the client form. Sonner's container is an ARIA live region.
- **Success that navigates** (login after invite, password reset, logout): the action sets a short-lived (`maxAge: 10`), non-httpOnly `flash` cookie with the message; a tiny client `FlashToast` in the root layout reads it on mount, calls `toast.success`, and deletes it. ~20 lines, no dependency.
- **Create member → invite link**: no navigation. The action returns `{ status: "ok", invite: { url, message } }` in the `useActionState` state and the page swaps to `InviteLinkPanel`. The raw token never goes into a URL or history; "Bitti" navigates to `/uyeler/[id]`.
- **Unexpected errors** → `(portal)/error.tsx` (client, `reset()` button "Tekrar dene"), `global-error.tsx` for root failures, `not-found.tsx` for unknown ids and for members hitting manager pages.
- **Invite link UX**: show the link in a read-only input (selectable), plus "Kopyala" (`navigator.clipboard`, falls back to selecting the input when unavailable) and "WhatsApp'ta gönder" (`https://wa.me/?text=<encoded message + link>` — free, works everywhere) and `navigator.share` when present. Invite expiry shown ("7 gün geçerli").

---

## 3. PWA plan (all free)

Based on `02-guides/progressive-web-apps.md` and `offline-support.md`.

1. **Manifest** — `src/app/manifest.ts`:
   `name "Arkhe Portal"`, `short_name "Arkhe"`, `id "/"`, `start_url "/"`, `scope "/"`, `display "standalone"`, `lang "tr"`, `orientation "portrait"`, `background_color` = light background hex, `theme_color` = stage indigo (manifest has no per-scheme colour; the `<meta theme-color>` with media queries still wins in-browser). Icons: 192, 512 (`purpose: "any"`), 512 maskable (logo inside the 80% safe zone on a stage-indigo square).
2. **Icons** — generated from the brand logo by the pipeline in §4: `src/app/icon.png` (512, used as favicon by the file convention), `src/app/apple-icon.png` (180×180, **opaque** — iOS paints transparency black), `public/brand/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`. Prefer an SVG logo from the user; if only raster, we render at 1024 and downscale.
3. **iOS meta** — in root `metadata`: `appleWebApp: { capable: true, title: "Arkhe", statusBarStyle: "black-translucent" }`, plus `viewportFit: "cover"` (M1) and safe-area padding on the sticky header. Startup (splash) images: skip — iOS needs ~10 device-specific sizes for little gain; background colour + icon is acceptable.
4. **Service worker** — hand-written `public/sw.js` (~60 lines, no dependency), registered from a tiny client component in the root layout, production only:
   - `/_next/static/*`, `/brand/*`, fonts: cache-first (hashed/immutable).
   - Navigations: network-first; on failure serve a precached `/cevrimdisi` page ("İnternet bağlantın yok. Bağlanınca kaldığın yerden devam eder.").
   - **Never cache** authenticated HTML/RSC or server-action responses (stale role/privacy on a shared phone).
   - Headers for `/sw.js` per the guide: `Cache-Control: no-cache, no-store, must-revalidate`, `Content-Type: application/javascript; charset=utf-8`, `Content-Security-Policy: default-src 'self'; script-src 'self'`.
   - Serwist is the free alternative if we later want precaching of the whole app shell; not worth the build complexity now.
5. **`experimental.useOffline`** — skip for now (experimental flag). If we want it later, the `(portal)/loading.tsx` from §1.5 is the prerequisite in non-cacheComponents mode.
6. **Install prompt** — a dismissible "Ana ekrana ekle" card on Home: Android uses `beforeinstallprompt`; iOS shows instructions (Paylaş → Ana Ekrana Ekle). Hidden when `display-mode: standalone`. Dismissal stored in `localStorage`.
7. **Web Push ("Yoklama başladı")** — feasible for free: VAPID keys + `web-push` (MIT) + a `push_subscriptions` table; triggered from the start-attendance action. iOS only delivers to **installed** PWAs (16.4+). Belongs in Phase 2 or later, not Phase 1.
8. **Not feasible / not worth it**: background sync and periodic sync on iOS, offline check-in (the QR rotates every 30s and must be validated server-side anyway), app-store presence.
9. **Testing** needs HTTPS on a real phone → free Cloudflare quick tunnel (see §1.5 item 7).

---

## 4. Brand image pipeline

**Layout**
```
brand/                         originals from the user, untouched (large; keep out of git later or use LFS-free approach: just don't commit >5 MB files)
public/brand/                  processed, committed
  photos/<slug>.jpg            max 2400px long edge, q≈82, sRGB, EXIF stripped (GPS!), progressive
  logo.svg / logo-light.png / logo-dark.png
  icons/icon-192.png icon-512.png icon-maskable-512.png
src/app/icon.png  src/app/apple-icon.png
scripts/brand.ts               `npm run brand` → reads brand/, writes the above (idempotent)
```

- Tooling: `sharp` (Apache-2.0, already installed transitively by Next; add it as an explicit `devDependency` so the script doesn't depend on a transitive install) run via `tsx` (already a devDependency). Script: `rotate()` (apply EXIF orientation) → `resize({ width: 2400, withoutEnlargement: true })` → `jpeg({ quality: 82, mozjpeg: true })` with metadata stripped (sharp's default). Icons: logo composited on a `stage`-indigo square, 80% safe zone for maskable.
- **Usage**: static imports so Next gets width/height and a blur placeholder automatically:
  ```tsx
  import hero from "../../../public/brand/photos/konser.jpg";
  <Image src={hero} alt="" fill sizes="(min-width: 768px) 50vw, 100vw" placeholder="blur" preload className="object-cover" />
  ```
  `preload` (not the deprecated `priority`) only on the one LCP image (login hero / home hero). Decorative photos get `alt=""`; photos with meaning get Turkish alt text. Default quality 75 is fine, so no `images.qualities` change.
- Vercel Hobby image optimisation has a free monthly transformation quota; with ~5 static brand images × a few widths we stay far below it. If it ever becomes a concern, `unoptimized` + the pre-sized files from the script still work.

**Assets received so far (`brand/`, checked 2026-10-17)**

| File | Content | Size | Usable for |
|---|---|---|---|
| `images.jpeg` | Official logo: "ARKHE" in a multi-line inline/striped geometric sans + "MÜLKİYE ÇOKSESLİ KOROSU", white on black | 447×447 | Reference only. Too small for 512px icons or a crisp header logo. |
| `images (1).jpeg` | Concert photo, Çanakkale festival stage, full choir + conductor | 547×365 | Only small or heavily treated (duotone + scrim) uses. A desktop half-panel needs ≥1440px wide for 2× screens; this is ~3× too small. Contains a festival QR code and members' faces. |
| `images (2).jpeg` | Instagram "DUYURU" template (piano, teal→yellow gradient text) | 387×516 | Not as a photo (text baked in). Useful as a palette hint for announcements (Phase 4). |

Consequences:
- **Ask the user for a vector logo (SVG/PDF/AI) and full-resolution photos** (originals from the photographer/phone, ≥2000px). The pipeline will upscale nothing (`withoutEnlargement`).
- The real logo is an uppercase striped sans, while the current `Logo` component is a lowercase Fraunces "arkhe" with a gold dot. That is a brand decision for the designer (`brand-integration.md`): use the real wordmark as an SVG `<Logo />` (inline SVG with `fill="currentColor"` so it works on stage, light and dark), and keep Fraunces for headings.
- Until an SVG exists, icons use the placeholder from `review-phase0.md` P3-14 (gold dot on indigo).

**Overlays and duotone in CSS (token-driven, both themes)**

Hero surfaces are stage indigo in both themes, so the photo treatment can be theme-independent with small `dark:` tweaks:

```css
/* globals.css */
.photo-duotone { position: relative; isolation: isolate; background: var(--stage); }
.photo-duotone img { filter: grayscale(1) contrast(1.1) brightness(0.95); mix-blend-mode: luminosity; opacity: 0.55; }
.photo-duotone::after {            /* gold highlight wash */
  content: ""; position: absolute; inset: 0; z-index: 1;
  background: linear-gradient(160deg, color-mix(in oklch, var(--gold) 35%, transparent), transparent 60%);
  mix-blend-mode: soft-light;
}
.photo-scrim::before {             /* legibility for text over photos */
  content: ""; position: absolute; inset: 0; z-index: 2;
  background: linear-gradient(to top, var(--stage) 0%, color-mix(in oklch, var(--stage) 70%, transparent) 45%, transparent 100%);
}
@media (prefers-color-scheme: dark) { .photo-duotone img { opacity: 0.4; } }
@media (prefers-contrast: more) { .photo-duotone img { opacity: 0.25; } }
```

- Text on top of photos always sits on the scrim and uses `text-stage-foreground` (≥8:1 against stage).
- Optional `.staff-lines` on top keeps the existing motif.
- True two-colour duotone via an SVG `feColorMatrix` filter is possible, but it needs literal colour values (no CSS variables), so it would duplicate tokens; the blend approach above stays on tokens. Pre-baking a duotone in `scripts/brand.ts` is the fallback if Safari blending looks off.
- For light surfaces (non-hero cards), use photos un-tinted with `rounded-2xl` + a 1px `ring-foreground/5`, no blend modes.

---

## 5. Suggested order of work for Phase 1 (frontend)

1. P0 fixes: B1/B2 (`lib/format.ts`), A1 tokens, A2 focus, M1 viewport, M4 dev indicator, B7 token.
2. `(auth)` group + login/davet pages with form components (§2.4).
3. DAL + proxy + `/cikis`; swap `previewUser` for `getCurrentUser()` in the shell; `UserMenu`.
4. Members list / new / detail + invite link UX.
5. Profile page.
6. Manifest + icons once brand assets arrive (SW in the PWA phase).

## 6. Needs a product decision

1. Session lengths: "beni hatırla" checkbox (30 days / 12 hours) or always-long sessions (designer suggests 90 days, no checkbox)? I agree with always-long + sliding expiry; it removes a control and the checkbox component.
2. Manual light/dark toggle, or system only? (Affects B5; system-only is simpler.)
3. Can board members edit/deactivate the conductor or other board members, or only the conductor can change roles?
4. Invite/reset link lifetime (proposal 7 days, single use) and whether managers can see "davet bekliyor" status.
5. Phone testing: OK to use a free Cloudflare quick tunnel (temporary public URL) for testing on phones?
6. Brand photos with members' faces on the public login page: do we have consent? Otherwise use them only inside the portal.
7. Do brand originals go into git once git exists (size), or stay local with only `public/brand/` committed?
8. Can we get the logo as SVG and the concert photos at full resolution? The current files are 387–547px.
