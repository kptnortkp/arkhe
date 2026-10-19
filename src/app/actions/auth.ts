"use server";

import { redirect } from "next/navigation";
import { deleteCurrentSession } from "@/lib/auth/session";

export async function logout() {
  await deleteCurrentSession();
  redirect("/giris");
}
