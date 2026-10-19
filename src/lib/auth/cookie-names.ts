// Plain module (no server-only) so the proxy can import it.
export const secureCookies = process.env.NODE_ENV === "production";

// "__Host-" requires Secure, so it is only used in production.
export const SESSION_COOKIE = secureCookies ? "__Host-arkhe_session" : "arkhe_session";

export const DEMO_EMAIL_DOMAIN = "@arkhe.local";

/** Demo accounts from the seed never work against a production build. */
export function isRefusedDemoEmail(email: string) {
  return secureCookies && email.toLowerCase().endsWith(DEMO_EMAIL_DOMAIN);
}
