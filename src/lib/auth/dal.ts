import "server-only";
import { redirect } from "next/navigation";
import { isManager } from "@/lib/permissions";
import { getSessionUser } from "./session";

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/giris");
  return user;
}

export async function requireManager() {
  const user = await requireUser();
  if (!isManager(user.role)) redirect("/");
  return user;
}

/** For server actions: returns null instead of redirecting, so callers can answer with an error. */
export async function assertUser() {
  return getSessionUser();
}

export async function assertManager() {
  const user = await getSessionUser();
  return user && isManager(user.role) ? user : null;
}
