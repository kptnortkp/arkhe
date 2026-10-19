// Refuses to let demo/e2e fixtures touch anything but a local file database outside production.
export function assertFixtureTarget(client) {
  const url = process.env.DATABASE_URL ?? "file:";
  const remote = !url.startsWith("file:") || (client?.protocol && client.protocol !== "file");
  if (process.env.NODE_ENV === "production" || remote) {
    throw new Error("Fixtures only run against a local file database outside production.");
  }
}
