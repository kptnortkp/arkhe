import "server-only";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { isManager } from "@/lib/permissions";

const NO_STORE = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Route handlers aren't covered by layouts, so each one checks the session itself. */
export async function managerOrError() {
  const user = await getSessionUser();
  if (!user) return { error: json({ error: "Giriş yapmalısın." }, 401) };
  if (!isManager(user.role)) return { error: json({ error: "Bu işlem için yetkin yok." }, 403) };
  return { user };
}

/** Server actions get an Origin check from Next; mutating route handlers need their own. */
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
