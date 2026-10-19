// Creates the first conductor account and prints a one-time link to set its password.
// Usage: npm run create-admin -- "Ad Soyad" email@example.com
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { invites, users } from "../src/db/schema";
import { generateToken, hashToken } from "../src/lib/auth/tokens";
import { cleanLine } from "../src/lib/text";

async function main() {
  const [rawName, rawEmail] = process.argv.slice(2);
  const name = cleanLine(rawName ?? "").trim();
  if (name.length < 2 || name.length > 80 || !rawEmail) {
    console.error('Usage: npm run create-admin -- "Full Name" email@example.com');
    process.exit(1);
  }
  const email = rawEmail.trim().toLowerCase();
  const remote = !(process.env.DATABASE_URL ?? "file:").startsWith("file:");
  if (email.endsWith("@arkhe.local") && (remote || process.env.NODE_ENV === "production")) {
    console.error("Demo @arkhe.local accounts can't be created on a production database.");
    process.exit(1);
  }
  const db = createDb();

  let [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (user) {
    await db.update(users).set({ role: "conductor", isActive: true }).where(eq(users.id, user.id));
    console.log(`Existing user ${email} promoted to conductor.`);
  } else {
    [user] = await db
      .insert(users)
      .values({ name, email, role: "conductor" })
      .returning({ id: users.id });
    console.log(`Created conductor ${email}.`);
  }

  const token = generateToken();
  await db.delete(invites).where(eq(invites.userId, user.id));
  await db.insert(invites).values({
    tokenHash: hashToken(token),
    userId: user.id,
    purpose: "invite",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const base = process.env.APP_URL ?? "http://127.0.0.1:3100";
  console.log(`Set the password within 24 hours: ${new URL(`/davet/${token}`, base)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
