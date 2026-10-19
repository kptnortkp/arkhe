# Phase 6: backend and security plan (arkhe-backend)

Author: arkhe-backend. Date: 2026-10-19. Inputs: `po-spec.md`, `db.md`, `ui.md`, `phase-5/review-backend.md`, `next.config.ts`, `src/proxy.ts`, `src/lib/{flash,validation}.ts`, `src/lib/auth/{session,rate-limit,dal}.ts`, `src/app/giris/actions.ts`, `src/lib/finance/{schemas,ledger,queries}.ts`, `finans/actions.ts`, `finans/aidat/actions.ts`, `scripts/*`. Next.js docs read: `02-guides/content-security-policy.md`, `02-guides/instrumentation.md`, `03-file-conventions/{proxy,instrumentation,route}.md`, plus the startup path in `node_modules/next/dist/server/{next-server,lib/start-server,lib/render-server}.js`. Base UI's `docs/react/utils/csp-provider.md`.

Replies are by AC number, plus @dba and @ui where we overlap. `src/` is untouched. This is a plan only.

---

## 0. Decisions in one table

| Topic | Decision |
|---|---|
| CSP | Built per request in `src/proxy.ts`, with a 128-bit nonce. Policy in §1.1. No `'unsafe-inline'` in `script-src`. Prod and dev differ only by `'unsafe-eval'`. No `upgrade-insecure-requests` (it would break prod-e2e on `http://127.0.0.1:3101`). |
| Static routes | `await connection()` in `RootLayout`, which makes every HTML route dynamic (agree with @ui). Gate: the `next build` route table shows no `○` HTML route. |
| Other headers | Stay in `next.config.ts`. Add `Cross-Origin-Opener-Policy: same-origin`. Tighten `Permissions-Policy` to `camera=()`, because nothing uses the camera. |
| Env check | `src/instrumentation.ts` → `src/lib/env.ts`, production only. It throws one `Error` listing every problem. `next start` turns that into `console.error` + exit 1 (verified in the source, §3.3). |
| Demo accounts | Refused in production in `login()` **and** in `getSessionUser()`, folded into the existing generic failure path so that timing and rate limiting are unchanged. |
| Flash | The cookie carries a key from a fixed map. The value is looked up with `Object.hasOwn`. `Secure` is set in production. |
| Text hygiene | One `cleanText`/`cleanLine` pair in `src/lib/text.ts`, applied via zod `.overwrite()` **before** `.trim()`/`.min()`, in `optionalText`, `nameSchema` and every required free-text field (list in §7). |
| `/api/saglik` | `GET` only, `select 1` with a 3 s timeout, `{"ok":true}`/`{"ok":false}` with `no-store`. No auth, no details. |
| Dues fixes | #2 freeze cleanup on void, #3 member in derived ids and the group id, #4 `guarded` + `writeTx` everywhere in dues (§9). |
| Son değişiklik | A separate manager-only query, `duesAuditOf(userId)`, used only by the server-rendered member sheet (§10). @dba: same columns as yours, different place. |
| Fallback host | **Render free web service**, running plain `next start` (§12). |

---

## 1. AC 19, 20: nonce CSP in `src/proxy.ts`

### 1.1 Exact policy

```
default-src 'self';
script-src 'self' 'nonce-{N}' 'strict-dynamic'{dev: 'unsafe-eval'};
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self';
media-src 'self';
frame-src https://drive.google.com https://www.youtube-nocookie.com;
worker-src 'self';
manifest-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none'
```

- `{N}`: `btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))`, a fresh value per request. The docs' `Buffer.from(crypto.randomUUID()).toString("base64")` (@ui) is also fine at 122 bits. Pick one; don't use `Math.random`.
- `dev` means `process.env.NODE_ENV === "development"`, the docs' check. `NODE_ENV=test` or an unset value therefore gets the strict policy.
- **No `upgrade-insecure-requests`.** HSTS covers the real host, and every subresource is same-origin anyway. On prod-e2e (`http://127.0.0.1:3101`) the directive would rewrite `/_next/static/*` to `https://127.0.0.1:3101`, which fails. The UI plan doesn't list the directive either; I'm noting it so nobody copies it from the docs' example.
- **No nonce in `style-src`.** When a nonce (or hash) is present, CSP3 browsers **ignore `'unsafe-inline'`**. That would block every React `style={…}` attribute (base-ui positioning, sonner) and sonner's injected `<style>`. Next will still put the nonce on its own inline styles, which is harmless.
- `worker-src 'self'` is required, not optional. Under `'strict-dynamic'`, `'self'` in `script-src` is ignored, so without `worker-src`, `navigator.serviceWorker.register("/sw.js")` falls back to `script-src` and is blocked.
- `connect-src 'self'` also covers the dev HMR websocket (CSP3 `'self'` matches `ws:` on the same host). That works today with the same directive.
- `media-src 'self'` is the default-src value made explicit. No current page plays media from our origin. I'm listing it so a future `<audio>` with a Drive URL fails loudly in e2e rather than silently.

### 1.2 Proxy shape

```ts
export function proxy(request: NextRequest) {
  // 1. auth redirect first (unchanged), using the env-specific cookie name (§5.2)
  // 2. nonce + policy
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);                    // always overwrite
  requestHeaders.set("content-security-policy", policy);   // always overwrite
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}
```

- **Always overwrite both request headers, unconditionally.** Next extracts the nonce from the *request* `content-security-policy` header during SSR. If a code path ever forwarded the client's own header, an attacker could choose the nonce and inline-script their way past the policy. Don't write "set if missing".
- Matcher: per @ui, plus `sw\.js$` and `offline\.html$`. Keep `/api/` matched (it is public in `PUBLIC_PREFIXES`). JSON with a CSP header is harmless, and it keeps the redirect logic in one place. Don't add the docs' `missing: next-router-prefetch` filter. Prefetches would then skip the auth redirect too, which is harmless, but it is one more behaviour difference for no gain.
- Redirect responses get no CSP. They have no body.

### 1.3 What breaks, and what doesn't (checked)

| Item | Status |
|---|---|
| Static HTML (`/_not-found`, any page without a request-time API) | Built without a nonce, so every script on it would be blocked in prod. **Fix:** `await connection()` in `src/app/layout.tsx`. `not-found.tsx` renders inside the root layout, so it becomes dynamic too. |
| Built-in global error page (only shown when the root layout itself throws) | Prerendered, no nonce, so no JS. It is a static message; reloading works. Accepted. |
| `next-themes` inline script | Not mounted (only `useTheme` is called). No issue. Never add `ThemeProvider` without its `nonce` prop. |
| Base UI `PrehydrationScript` (`Tabs.Indicator`, `Slider.Thumb` with `renderBeforeHydration`) | We use neither. If someone adds one, wrap the app in `<CSPProvider nonce={(await headers()).get("x-nonce")}>` from `@base-ui/react/csp-provider`. I'm noting it in the implementation notes, not doing it now (agree with @ui). |
| Base UI `<style>` (ScrollArea, Select `alignItemWithTrigger`), sonner `<style>`, `next/font` `<style>` | Covered by `style-src 'unsafe-inline'`. |
| `qrcode.react` | SVG only. |
| zod v4 JIT (`new Function` probe, which fires a `securitypolicyviolation` event even though it is caught) | Zod isn't in any client bundle today; every client import of `@/lib/validation` is `import type`. **Rule:** if a client component ever imports zod at runtime, call `z.config({ jitless: true })` in that module, or AC 20's zero-violation check fails in prod. |
| Drive / YouTube iframes | `frame-src`. Their inner CSP is Google's. |
| Server actions, RSC fetches, `/api/calismalar/*` polling | Same-origin `fetch`, so `connect-src 'self'`. |
| Wake lock | Not governed by CSP. `screen-wake-lock` defaults to `self` in Permissions-Policy, so don't list it as `()`. |
| `sw.js` | Excluded from the proxy, so no page CSP is applied to the worker itself. A CSP on a worker script response would apply to the worker. |
| Dev overlay / Turbopack HMR | Its scripts are nonced by Next, and its `eval` is covered by `'unsafe-eval'` in dev only. |

AC 20 harness: the @ui init script is right. Add one assertion that `script-src` in the header contains neither `unsafe-inline` nor (in prod) `unsafe-eval`.

---

## 2. AC 21: other headers (`next.config.ts`)

```ts
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];
```

- `camera=(self)` → `camera=()`. `grep getUserMedia|BarcodeDetector|camera src/` finds nothing; check-in is by code, and the QR is only displayed.
- COOP `same-origin` severs `window.opener` for any page that links to us. Our `target=_blank` links to Drive still open normally. No COEP or CORP: COEP would break the Drive and YouTube iframes.
- No `preload` in HSTS. A `*.vercel.app` or `*.onrender.com` host can't be preloaded, and preload is hard to undo.
- `poweredByHeader: false` stays. `isProd = NODE_ENV === "production"`.
- `/sw.js` and `/offline.html` header blocks as in `ui.md` (the offline page gets its own static CSP there).

---

## 3. AC 27: environment check at startup

### 3.1 Files

- `src/lib/env.ts`: a pure function `envProblems(env: NodeJS.ProcessEnv): string[]`. No `server-only` import, so `scripts/db-check.ts` can reuse it later.
- `src/instrumentation.ts`:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { envProblems, bootWarnings } = await import("./lib/env");
  const problems = envProblems(process.env);
  if (problems.length) throw new Error(`Invalid environment:\n- ${problems.join("\n- ")}`);
  for (const w of bootWarnings(process.env)) console.warn(w);
}
```

### 3.2 Rules (production only)

| Variable | Fails when | Message (English, names the variable; never echoes a secret) |
|---|---|---|
| `APP_URL` | missing or empty | `APP_URL is required (e.g. https://arkhe.example.org).` |
| `APP_URL` | `new URL()` throws, or the protocol isn't `https:` and the host isn't `127.0.0.1`/`localhost`/`[::1]` | `APP_URL must be an https:// URL (got "<value>").` |
| `APP_URL` | has a path other than `/`, a query, a hash or credentials | `APP_URL must be an origin only, without path, query or credentials.` |
| `DATABASE_URL` | missing. In production the `file:data/arkhe.db` default must not be used silently. prod-e2e sets it explicitly (@dba §2). | `DATABASE_URL is required in production.` |
| `DATABASE_URL` | scheme not in `file:`, `libsql:`, `https:`, `wss:` | `DATABASE_URL must start with file:, libsql:, https: or wss:.` |
| `DATABASE_AUTH_TOKEN` | URL is `libsql:`/`https:`/`wss:` and the token is empty | `DATABASE_AUTH_TOKEN is required for a remote DATABASE_URL.` |
| `DATABASE_URL` | `file:` and `VERCEL` is set | `DATABASE_URL cannot be a file: database on Vercel (read-only filesystem).` |
| `DATABASE_URL` | `file:` and `RENDER` is set (fallback host, §12) | `DATABASE_URL cannot be a file: database on Render (ephemeral disk).` |
| `TRUST_PROXY_HEADERS` | set to anything other than `""` or `"1"` (for example `true`, which a deployer would think means on) | `TRUST_PROXY_HEADERS must be "1" or unset.` |

Boot warning, exactly as in AC 26, when production and `TRUST_PROXY_HEADERS !== "1"`: `TRUST_PROXY_HEADERS is not set; per-IP login limits are off.`

All problems are collected and reported together, so the deployer fixes them in one round.

### 3.3 How it fails (verified, not assumed)

- **`next start`:** `start-server.js` calls `initialize()` → `render-server.initializeImpl` → `server.prepare()` → `NextNodeServer.prepareImpl` → `runInstrumentationHookIfAvailable()` from inside the listen callback, before any request. A throw lands in `start-server.js`'s `catch (err) { handlersError(); console.error(err); process.exit(1) }`. **A plain `throw` is enough. No `process.exit` in our code** (@ui: that answers your question). prod-e2e: `APP_URL=http://example.org`, so expect exit ≠ 0 and `APP_URL` in stderr.
- **Vercel:** every cold start runs `register()`, so the function fails with 500, and the message is in the function logs. That is the desired fail-fast.
- **Build:** skipped via `NEXT_PHASE`, so `next build` without prod secrets (local or prod-e2e) still works.
- **Dev:** skipped entirely. `npm run dev` is unaffected.

### 3.4 AC 37 `.env.example`

`APP_URL`, `DATABASE_URL`, `DATABASE_AUTH_TOKEN` and `TRUST_PROXY_HEADERS` are the variables the code reads. `NODE_ENV`, `VERCEL`, `RENDER`, `NEXT_RUNTIME` and `NEXT_PHASE` are platform-set; mention them in a comment, not as entries. `E2E_BASE_URL` and `E2E_SHOTS` are test-only; add them under a `# e2e only` comment so the AC 37 grep gate passes.

---

## 4. AC 26: `TRUST_PROXY_HEADERS`

| Value | Behaviour |
|---|---|
| unset / `""` | `X-Forwarded-For` and `X-Real-IP` are ignored. Only the `email|?` pair (5) and `email` (30) buckets apply. That is the current code. |
| `1` | `x-real-ip`, else the first `x-forwarded-for` hop. Then **validate**: `/^[0-9a-fA-F:.]{2,45}$/`. On failure → `null` (per-email only). This keeps the `login_attempts.key` length bounded even on a misconfigured proxy. |
| anything else | refused at boot (§3.2) |

- Set `1` **only on Vercel**. Vercel overwrites both headers with the client IP. Proxies that *append* to `X-Forwarded-For` (Render among them) leave the first hop attacker-controlled, so leave the flag unset there. The README says this in one sentence.
- AC 26 e2e on dev (flag unset): six wrong passwords for one email under six different spoofed `X-Forwarded-For` values give five `E-posta ya da şifre hatalı.` and then `Çok fazla hatalı deneme…`. The current code already passes it. The test locks that in.
- Cleanup: the test must delete its `login_attempts` rows (`key like 'e2e…%'`). Use an `E2E…@arkhe.local`-style email that no account has.

---

## 5. AC 22, 24: cookies and demo accounts

### 5.1 Cookie flags (production)

| Cookie | Name | Flags |
|---|---|---|
| session | `__Host-arkhe_session` | `HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain`, `Expires` +90 d. Already the case (`session.ts:12-25`). |
| flash | `arkhe_flash` | `Secure` (new), `SameSite=Lax; Path=/; Max-Age=30`. Not `HttpOnly`, because the client clears it. |
| ledger account | `arkhe_fin_hesap` | add `secure: isProduction` (`finans/actions.ts:46`). |

Put `export const secureCookies = process.env.NODE_ENV === "production"` in a tiny `src/lib/auth/cookie-names.ts`, together with `SESSION_COOKIE`. Make it a plain module, not `server-only`, so `proxy.ts` can import it (§5.2).

### 5.2 `__Host-` on `127.0.0.1`: risks

1. **Storage.** Chromium's `net::IsLocalhost` covers `localhost`, `*.localhost`, `127.0.0.0/8` and `::1`. `Secure` cookies and `__Host-` prefixes set over `http://127.0.0.1` are therefore accepted. The PO's `localhost:3101` fallback stays documented. If it is needed, `APP_URL` must match (`http://localhost:3101`), or the invite link points at the other host and the cookie jar splits.
2. **Port sharing.** Cookies ignore ports, so in one browser profile the dev server (`arkhe_session` on :3100) and prod-e2e (`__Host-arkhe_session` on :3101) see each other's cookies. Today `proxy.ts:43-44` accepts **either** name. In prod, a leftover dev cookie passes the optimistic check, and the DAL then redirects. That is harmless but confusing. **Fix:** the proxy checks only `SESSION_COOKIE` from `cookie-names.ts`. prod-e2e uses a fresh context, so it isn't affected either way.
3. **Clearing a `Secure` flash cookie from JS** (`flash-toast.tsx:10`). Overwriting a `Secure` cookie from `document.cookie` works only in a secure context, which `https:` and loopback both are. Write it as `"arkhe_flash=; Max-Age=0; Path=/; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "")`.
4. **Asserting AC 22.** Login is a server action POST answered with a redirect, and there are two `Set-Cookie` lines when a flash is present. Use `response.headersArray()` on the POST response (`page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/giris"))`), not `headers()`, which joins them.

### 5.3 Demo-account refusal (AC 24)

`src/app/giris/actions.ts`:

```ts
const DEMO_DOMAIN = "@arkhe.local";
const demoBlocked = process.env.NODE_ENV === "production" && email.endsWith(DEMO_DOMAIN);
// …registerLoginAttempt, user lookup, verifyPassword exactly as today…
if (!user || !user.passwordHash || !user.isActive || !ok || demoBlocked) return { error: INVALID, values: { email } };
```

- Fold the check into the existing failure branch. Don't return early: an early return would skip `verifyPassword`, and the faster response is a timing oracle for "this is a demo account in prod". It also keeps the attempt counted.
- `email` is already trimmed and lowercased by the schema, so `@ARKHE.LOCAL` is covered.
- **Defence in depth:** in `getSessionUser()` (`session.ts:41`), return `null` when production and `row.email.endsWith("@arkhe.local")`. A dev DB copied to production with live session rows would otherwise keep those sessions working. `email` is already selected, so the cost is zero.
- `scripts/create-admin.ts`: refuse an `@arkhe.local` email when `DATABASE_URL` isn't `file:`.
- `db:check`: fails on `@arkhe.local` users for non-`file:` URLs (@dba §7.2, agree).

---

## 6. AC 23: flash cookie carries a key

`src/lib/flash.ts`:

```ts
const FLASH_MESSAGES = { "kayit-duzeltildi": "Kayıt düzeltildi." } as const;
export type FlashKey = keyof typeof FLASH_MESSAGES;
export async function setFlash(key: FlashKey) { /* value = key, flags §5.1 */ }
export async function readFlash() {
  const raw = (await cookies()).get(FLASH_COOKIE)?.value;
  return raw && Object.hasOwn(FLASH_MESSAGES, raw) ? FLASH_MESSAGES[raw as FlashKey] : null;
}
```

- Use `Object.hasOwn`, not `FLASH_MESSAGES[raw] ?? null`: a cookie of `constructor` or `toString` would otherwise return a function and crash the toast.
- The value is ASCII, so `encodeURIComponent`/`decodeURIComponent` and their `URIError` path go away.
- Only one call site exists today: `finans/actions.ts:244`, `setFlash(state.success)` → `setFlash("kayit-duzeltildi")`. The type makes a free-text call a compile error.
- An old cookie with free text left in a browser is ignored silently, as AC 23 asks.
- e2e: set `arkhe_flash=%3Cb%3EHacked%3C%2Fb%3E` and also `arkhe_flash=constructor`, then load `/finans` as yk@. Expect no toast and no error boundary.

---

## 7. AC 28: control and bidi characters, dates, zero amounts

### 7.1 Helper: `src/lib/text.ts` (pure, used on client and server)

```ts
// C0 except \n, DEL, C1, ALM, LRM/RLM, bidi embeddings/overrides/isolates, BOM.
const INVISIBLE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩﻿]/g;
export const cleanText = (v: string) => v.toWellFormed().replace(/\t/g, " ").replace(INVISIBLE, "");
export const cleanLine = (v: string) => cleanText(v).replace(/\n+/g, " ");
```

- `\r` is in the stripped range, so a CRLF from a textarea becomes `\n`. That makes the homework description's own `\r\n?` replace redundant (harmless).
- ZWJ/ZWNJ (U+200C/D) are **kept**: emoji sequences and some scripts need them. U+2028/2029 are left to `cleanLine` users via mail's own `clean` (unchanged).
- `toWellFormed()` replaces lone surrogates. Node ≥ 20 and every target browser have it.

### 7.2 Where it applies (server-side zod, before trim/min)

Use zod v4 `.overwrite()`, which keeps the string type so checks can chain after it: `z.string().overwrite(cleanText).trim().min(3)`. **The order matters.** `"‮‮‮"` passes `.min(3)` before cleaning and is empty after, so cleaning must come first.

| Schema | Change |
|---|---|
| `optionalText` (`validation.ts:50`) | `.overwrite(cleanText)` before `.trim()`. This covers repertoire composer/arranger/language/voicing/notes/link label, rehearsal title/location/note/excuse reason, homework description/feedback, and finance `text()`. |
| `nameSchema` (`validation.ts:17`) | `.overwrite(cleanLine)` first. Names reach CSVs, toasts and the `mailto:` subject. |
| finance `text()` and the local `clean` (`finance/schemas.ts:17-19`) | `text = optionalText`, then delete `clean`. |
| `voidReason` (`finance/schemas.ts:136`) | `.overwrite(cleanText)` first; drop the trailing transform. |
| **waiver reason** (`aidat/actions.ts:459-464`) | `z.string().overwrite(cleanText).trim().min(3,…).max(200,…)`. This is AC 28's e2e: U+202E is gone in `dues_overrides.reason`. |
| period name (`aidat/actions.ts:158`), sponsor/event name (`finans/actions.ts:432`), piece title (`repertuvar/actions.ts:57`), sectional name (`calismalar/actions.ts:483`) | `.overwrite(cleanLine)` first. |
| payment info (`finans/actions.ts:410`) | `.overwrite(cleanText)` first. |
| Never | passwords, emails (`z.email` already rejects these characters), ids, URLs (`parseLink` has its own charset check). |

There is no backfill of existing rows: production starts from an empty DB.

### 7.3 Date bounds

- New `boundedDayField` in `finance/schemas.ts`: `dayField.refine(v => !isRealDay(v) || (v >= "2000-01-01" && v <= addDays(istanbulDateOf(now()), 730)), "Tarih 2000 ile gelecek iki yıl arasında olmalı.")`. `today` is computed **inside** the refine (per request, Istanbul), never at module load.
- Use it for period `startsOn`/`endsOn`/`dueOn`, and for the bulk form (`fromMonth + "-01"`, `toMonth + "-01"`, with the same message on the month field).
- **Opening date** (`setOpeningBalances`): `boundedDayField` **and** the existing `entryDayField` cap (today + 31). @po: an opening one or two years ahead would refuse every entry until then (Phase 5 P3-6), so the cap stays. The 1999-12-31 case still shows the AC 28 message, because the refines run in order and the bounded one comes first.

### 7.4 Zero opening

`optionalAmount` (`finans/actions.ts:334`): `if (!v) return 0; const p = parseAmount(v); if (!p.ok) { if (p.error === AMOUNT_ZERO) return 0; throw new FieldError(…) }`. This covers `0`, `0,00`, `0.00` and `₺0` if the parser accepts the symbol.

---

## 8. AC 29: `GET /api/saglik`

`src/app/api/saglik/route.ts`:

```ts
export async function GET() {
  await connection();
  const headers = { "Cache-Control": "no-store" };
  try {
    await Promise.race([db.run(sql`select 1`), timeout(3000)]);
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    console.error("health check failed", error);
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
```

- No auth. It is public via `/api/` in `PUBLIC_PREFIXES`. Only `GET` is exported, so other methods get 405 from Next.
- Nothing else in the body or headers: no version, no counts, no error text. The detail goes to server logs only.
- `connection()` makes the handler dynamic explicitly. GET handlers have been dynamic by default since v15 (`route.md`), but this guards against a later config change.
- Abuse: each call is one trivial read against Turso's free quota. Bot traffic at that scale would hit Vercel's own platform protection first. No rate limit; noted as accepted.
- prod-e2e uses it as the readiness probe (`ui.md` prod-e2e step 4, agree).

---

## 9. AC 31–33: dues fixes (Phase 5 carry-forward #2, #3, #4)

### 9.1 #2 / AC 31: freeze cleanup on void

Agree with @dba §4 completely: `voidEntry` moves into `writeTx`, and the `UPDATE … RETURNING category, memberId, duesPeriodId` is followed by `delete … where kind='freeze' and not exists (live dues entry for member+period)`, in the same transaction.
- The fallback lookup for the error message (`NOT_FOUND`/`ALREADY_VOID`/`OPENING_ONLY_IN_SETTINGS`) also uses `tx`.
- `correctEntry` must not clean up (the replacement is inserted in the same transaction).
- Concurrency: `BEGIN IMMEDIATE` serialises it with `recordDuesPayment`, so a payment can't slip in between the void and the `not exists`.
- Also in `setWaiver`: the upsert's `set` must include `createdAt: now()` (@dba §5, agree). A waiver may still overwrite a legacy orphan freeze only when `paid === 0`, which is already enforced (`aidat/actions.ts:476`).

### 9.2 #3 / AC 32: replay id includes the member

- `derivedId(d.clientId, d.memberId, p)` at both `aidat/actions.ts:70` and `:113`.
- Group id: `derivedId(d.clientId, d.memberId, "group")` (@dba §6, agree).
- **The replay branch must also verify ownership** (Phase 5 finding 3, second half). Select `memberId`, `createdBy` and `amountKurus`. If any row has `memberId !== d.memberId` or `createdBy !== actor.id`, return `{ error: STALE }`; otherwise return the old success. With the member in the hash, a collision on another member is computationally impossible. The `createdBy` check is what stops a second manager replaying a captured `clientId` to read back "Ödeme alındı: …" for someone else's payment.
- e2e helper updates at `phase5-finance.mjs:729/739/747/752` (@dba list).

### 9.3 #4 / AC 33: constraint errors and `writeTx`

- Move `FieldError` and `guarded()` from `finans/actions.ts:52-117` into `src/lib/finance/guard.ts`, a plain module. A `"use server"` file may only export async functions.
- Wrap these in `guarded(formData, …)`: `recordDuesPayment`, `createDuesPeriod`, `updateDuesPeriod`, `bulkCreateDuesPeriods`, `setDuesRate`, `setWaiver`. A CHECK/UNIQUE failure → `Kaydedilemedi. Alanları kontrol et.`; an FK failure → `Kayıt bulunamadı.`
- `bulkCreateDuesPeriods` changes `db.transaction` → `writeTx` (busy retry). `BulkError` stays and is caught outside `writeTx`, so it isn't treated as BUSY.
- `deleteDuesPeriod:299`: replace the `String(cause).includes("FOREIGN KEY")` sniff with `constraintKind(error) === "fk"`.
- `updateEntryMeta`: move the `current` read, the event existence check and the guarded `UPDATE` into one `writeTx` inside `guarded`, so an event deleted in between becomes `NOT_FOUND`, not a 500.
- `voidEntry`: §9.1.
- Gate (my review): `grep -n "db.transaction\|await db\.\(insert\|update\|delete\)" src/app/(portal)/finans` shows writes only inside `writeTx`, except the cookie and the single-row sponsor/event upserts, which already map `constraintKind`.

---

## 10. AC 30: "Son değişiklik", data path and authorization

@dba: same columns and display rules as your §5 (agree on "no line without a row", `silinmiş üye` for `updated_by IS NULL` on an existing row, no line on freezes). I disagree only on **where**: I'd keep `duesMatrix` unchanged and add one query for the open sheet.

```ts
// src/lib/finance/queries.ts
export async function duesAuditOf(userId: string) {
  await requireManager();
  if (!z.uuid().safeParse(userId).success) return null;
  const editor = alias(users, "editor");
  const [[rate], waivers] = await Promise.all([
    db.select({ at: memberDues.updatedAt, name: editor.name })
      .from(memberDues).leftJoin(editor, eq(editor.id, memberDues.updatedBy))
      .where(eq(memberDues.userId, userId)),
    db.select({ periodId: duesOverrides.duesPeriodId, at: duesOverrides.createdAt, name: editor.name })
      .from(duesOverrides).leftJoin(editor, eq(editor.id, duesOverrides.createdBy))
      .where(and(eq(duesOverrides.userId, userId), eq(duesOverrides.kind, "waiver"))),
  ]);
  const line = (r: { at: Date; name: string | null }) =>
    `Son değişiklik: ${r.name ?? "silinmiş üye"} · ${formatAuditDate(r.at)}`;
  return { rate: rate ? line(rate) : null, waivers: new Map(waivers.map((w) => [w.periodId, line(w)])) };
}
```

Why not inside `duesMatrix`:
- `duesMatrix` also feeds `/finans` home cards, `kasaSummary` and the dues CSV, and its rows go into the client component `DuesList`. Putting manager names into those objects widens what gets serialised to the browser and invites a later CSV column by accident.
- The sheet is for one member at a time. Two PK/index lookups for the open sheet are cheaper than joining editors for all ~60 rows on every page.

Authorization and exposure:
- `requireManager()` **inside** the query, not only in the page. `finans/aidat/page.tsx` already calls it, so this is a second, independent check.
- `MemberSheetBody` is a server component. Only the finished **string** goes into JSX, so no ids or `Date`s are serialised to the client.
- `myDues()` is not touched. korist@'s views (home `MyDuesCard`, `/profil` `MyDuesSection`; `/finans` redirects members) can't reach the data. Gate: `grep -n "updatedBy\|createdBy\|editor" src/lib/finance/queries.ts` shows no hit inside `myDues`.

Timezone: `formatAuditDate = formatter({ day: "numeric", month: "short", year: "numeric" })` in `src/lib/time.ts` (Europe/Istanbul via the existing `formatter`), giving `19 Eki 2026`. **e2e:** compute `<today>` with the same `Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", … })` in the test, never from `new Date().toISOString()`. A run between 00:00 and 03:00 Istanbul would otherwise expect yesterday.

Idempotency: none needed (read-only). Its freshness follows the existing `revalidatePath("/", "layout")` after `setDuesRate`/`setWaiver`.

---

## 11. AC 25: fixture safety (agree with @dba §1)

- @dba's `scripts/fixture-guard.mjs` with `client.protocol` + env + `NODE_ENV` is better than my env-only draft. Adopt it.
- Agree on hardening `assert-local-db.mjs` (`NODE_ENV=production` and the URL must be exactly `file:data/arkhe.db`). The order "guards first, test second" is a hard rule, or the AC 25 test deletes the dev DB.
- `e2e/lib.mjs`: refuse a non-`file:` URL and a non-loopback `E2E_BASE_URL`.

---

## 12. PO risk 1: free fallback host if Vercel Hobby is a concern

**Named fallback: Render, free "Web Service" instance (Node), with Turso unchanged.**

- **Why it fits:** it runs exactly what prod-e2e runs: `next build` + `next start`. `proxy.ts` (Node runtime), server actions, `instrumentation.ts` and route handlers behave the same, and there is no adapter layer. Render's free tier doesn't prohibit non-profit or commercial use the way Vercel Hobby's terms do.
- **Settings:**
  - Build command: `npm ci && npm run build`
  - Start command: `npx next start -H 0.0.0.0 -p $PORT`. `npm start` binds `127.0.0.1:3100` and would be unreachable there.
  - Node: add `"engines": { "node": ">=20.9" }` to `package.json` (Next 16's minimum). Render reads it.
  - Env: `APP_URL=https://<name>.onrender.com`, `DATABASE_URL=libsql://…`, `DATABASE_AUTH_TOKEN=…`. Leave **`TRUST_PROXY_HEADERS` unset** (§4).
  - `RENDER` is set by the platform, so the env check refuses a `file:` DB (ephemeral disk).
- **Trade-offs to state in the README:**
  - A free instance sleeps after ~15 minutes idle, and the first request then takes up to about a minute. That is a real annoyance for the first check-in of a rehearsal.
  - Workaround: open the portal a few minutes earlier. An external free uptime pinger on `/api/saglik` also works, and one always-on instance fits the monthly free instance-hours.
  - 512 MB RAM is enough for ~60 users.
- **Server Actions behind Render's proxy:** Next compares `Origin` with `x-forwarded-host`/`Host`. Render forwards the public host, so no `serverActions.allowedOrigins` is needed. If a custom domain is fronted by another proxy, add the domain there.
- **Verify at deploy time:** free-tier terms change. The README tells the user to re-read Vercel's and Render's current free-plan terms before go-live. No option here needs a card or a paid plan.
- **Considered and not chosen:**
  - Netlify and Cloudflare (OpenNext): they run through an adapter, and Node-runtime `proxy.ts` support has to be re-verified per release.
  - Fly.io: no longer free for new organisations.
  - Cloud Run and Oracle Always Free: free, but they require a billing card, which conflicts with the zero-budget spirit.

---

## 13. Threats and mitigations (new surface this phase)

| Threat | Mitigation |
|---|---|
| XSS via inline script injection | Nonce + `strict-dynamic`, no `unsafe-inline` in `script-src`, request CSP headers always overwritten (§1.2). |
| Nonce reuse through caching | Every HTML route is dynamic, so Next sends `private, no-cache, no-store`. The SW never caches navigations (`ui.md`). No CDN caching of HTML on Vercel or Render for dynamic responses. |
| Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY`. |
| Demo login in prod | Refused in `login()` and `getSessionUser()`. Same message, same timing (§5.3). |
| Flash text spoofing from a sibling port or subdomain | Key map with `Object.hasOwn` (§6). |
| Per-IP limit bypass via a spoofed `X-Forwarded-For` | Ignored unless `TRUST_PROXY_HEADERS=1`. The value is validated. `1` only on Vercel (§4). |
| Misconfigured deploy (http APP_URL, file DB on serverless, missing token) | Fail-fast in `register()` (§3). |
| Trojan-source / bidi spoofing in names, reasons or CSVs | `cleanText`/`cleanLine` before trim and min (§7). |
| Board self-dealing on rates and waivers | `Son değişiklik` line, managers only (§10). `setWaiver` refreshes `created_at`. |
| IDOR on audit data | `requireManager()` inside `duesAuditOf`, uuid check, and the string is rendered server-side only. |
| Replay of a payment `clientId` across members or actors | Member in derived and group ids; the replay branch checks `memberId` + `createdBy` (§9.2). |
| Info leak from the health endpoint | Fixed bodies only, errors in logs (§8). |
| Fixtures against prod | Shared guard checking the client protocol, env and `NODE_ENV`; the e2e lib refuses non-loopback targets (§11). |
| CSRF | Unchanged: Next's Origin/Host check on server actions, plus `SameSite=Lax` session. `/api/saglik` is a read-only GET. |
| Input size | Flash key ≤ 32 chars (map lookup); IP ≤ 45 chars; free text keeps its existing `.max()`; server actions keep Next's 1 MB body limit. |

---

## 14. Replies

- **@po AC 19–21:** agree, with the exact policy in §1.1. Drop `upgrade-insecure-requests` (prod-e2e). Add COOP and `camera=()`.
- **@po AC 22:** agree. Plus `Secure` on `arkhe_fin_hesap`, and the proxy checks the env-specific session cookie name only.
- **@po AC 23:** agree (§6).
- **@po AC 24:** agree, plus the `getSessionUser()` check and the `create-admin` refusal.
- **@po AC 25:** agree; @dba's guard (§11).
- **@po AC 26:** agree; plus IP validation and a boot failure for values other than `"1"`.
- **@po AC 27:** agree; plus `DATABASE_URL` required in production, a scheme allow-list, `RENDER` + `file:`, and `TRUST_PROXY_HEADERS` shape. A throw is enough under `next start` (§3.3).
- **@po AC 28:** agree, with one narrowing: the opening date also keeps the today + 31 cap (§7.3). The AC's e2e case is unaffected.
- **@po AC 29:** agree (§8).
- **@po AC 30:** agree. The data comes from a separate manager-only query (§10).
- **@po AC 31–33:** agree (§9), plus the replay ownership check from Phase 5 finding 3.
- **@po risk 1:** Render free web service (§12).
- **@po risk 4:** fontkit (MIT, which @ui chose over opentype.js for the variable font) and Jost (SIL OFL 1.1) are both free, both dev-only (`devDependencies`), and both used only by `scripts/brand-assets.*`. Keep the font file out of `public/` (for example `brand/fonts/`) so it isn't served.
- **@po risk 6:** see §5.2.1. The loopback is a secure context for cookies in Chromium, so I expect 127.0.0.1 to work.
- **@dba:** agree with §1, §2, §4, §5 rules and §6. One counter-proposal: the AC 30 query location (§10). Your migration's freeze cleanup is the same predicate as the runtime one, which is good.
- **@ui:** agree on the nonce, matcher, `connection()`, `sw.js` and offline headers, and the prod-e2e order. Answers: a throw in `register()` exits 1 under `next start` (§3.3), and the build skip via `NEXT_PHASE` is in §3.1. Additions: no nonce in `style-src` and no `upgrade-insecure-requests` (§1.1); `worker-src 'self'` is required, not cosmetic; and the zod `jitless` rule if zod ever ships to the client.
