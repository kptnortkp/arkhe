"use server";

import { revalidatePath } from "next/cache";
import { assertUser } from "@/lib/auth/dal";
import { feedUrl, rotateFeedToken } from "@/lib/calendar-feed/tokens";

/** Turns the calendar link on, or replaces it so links shared earlier stop working. */
export async function renewCalendarFeed(): Promise<{ url?: string; error?: string }> {
  const user = await assertUser();
  if (!user) return { error: "Oturumun kapanmış. Tekrar giriş yap." };
  const url = feedUrl(await rotateFeedToken(user.id));
  revalidatePath("/profil");
  return { url };
}
