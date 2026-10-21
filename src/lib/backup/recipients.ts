import "server-only";
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db } from "@/db";
import { appSettings, users } from "@/db/schema";
import { RECORDING_EMAIL_RE } from "@/lib/homework/mail";
import { MAX_RECIPIENTS } from "./constants";

export const RECIPIENTS_KEY = "backup_recipients";

/** Canonical "a@x.org,b@y.org" → addresses; anything malformed is dropped defensively. */
export function splitRecipients(value: string | null | undefined) {
  if (!value) return [];
  return value
    .split(",")
    .filter((a) => RECORDING_EMAIL_RE.test(a))
    .slice(0, MAX_RECIPIENTS);
}

const editor = alias(users, "editor");

/** Unguarded: callers authorize first. The saved list plus its audit fields, or null. */
export async function loadRecipients() {
  const [row] = await db
    .select({
      value: appSettings.value,
      createdAt: appSettings.createdAt,
      updatedAt: appSettings.updatedAt,
      editorName: editor.name,
    })
    .from(appSettings)
    .leftJoin(editor, eq(editor.id, appSettings.updatedBy))
    .where(eq(appSettings.key, RECIPIENTS_KEY));
  if (!row) return null;
  const list = splitRecipients(row.value);
  return list.length ? { ...row, list } : null;
}
