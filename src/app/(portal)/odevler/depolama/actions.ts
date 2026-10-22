"use server";

import { revalidatePath } from "next/cache";
import { assertUser } from "@/lib/auth/dal";
import { canEarlyClean } from "@/lib/review/access";
import { earlyCleanDone, MSG } from "@/lib/storage/messages";
import { runStorageSweep } from "@/lib/storage/sweep";
import { istanbulDateOf, now } from "@/lib/time";
import type { FormState } from "@/lib/validation";

/** The conductor's emergency lever (D19): audio of takes commented 30+ days ago; words stay. */
export async function earlyClean(): Promise<FormState> {
  const actor = await assertUser();
  if (!actor || !canEarlyClean(actor.role)) return { error: MSG.forbidden };
  const result = await runStorageSweep({
    today: istanbulDateOf(now()),
    reason: "early",
    deadline: Date.now() + 20_000,
  });
  if (result.status === "failed") return { error: MSG.generic };
  revalidatePath("/", "layout");
  return { success: earlyCleanDone(result.expired) };
}
