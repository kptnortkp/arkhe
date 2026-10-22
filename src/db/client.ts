import { drizzle } from "drizzle-orm/libsql";
import { createLibsqlClient } from "./local-client.mjs";
import * as schema from "./schema";

// Shared by the app (via ./index) and CLI scripts, which can't import "server-only".
export function createDb() {
  const client = createLibsqlClient({
    url: process.env.DATABASE_URL ?? "file:data/arkhe.db",
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });
  return drizzle(client, { schema });
}
