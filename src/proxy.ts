import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/cookie-names";

// API routes answer 401 themselves instead of redirecting.
const PUBLIC_PREFIXES = ["/giris", "/davet/", "/api/"];

const isDev = process.env.NODE_ENV === "development";

function contentSecurityPolicy(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // No nonce here: with one present, browsers ignore 'unsafe-inline' and React style attributes break.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self'",
    "frame-src https://drive.google.com https://www.youtube-nocookie.com",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function createNonce() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

// Optimistic redirect only; real authorization happens on the server (see lib/auth/dal.ts).
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);
  const isPublic = PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (!hasSession && !isPublic) {
    const url = new URL("/giris", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  const nonce = createNonce();
  const policy = contentSecurityPolicy(nonce);
  // Always overwrite: Next reads the nonce from the request header, so a client value must never pass through.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", policy);
  requestHeaders.delete("content-security-policy-report-only");
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

// Static assets, the service worker and the offline page never reach the proxy. Extensions are
// only skipped at the root (favicon, icon, manifest), so a page like "/davet/x.png" keeps the CSP.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|brand/|icons/|sw\\.js$|offline\\.html$|[^/]+\\.(?:svg|png|ico|webmanifest)$).*)",
  ],
};
