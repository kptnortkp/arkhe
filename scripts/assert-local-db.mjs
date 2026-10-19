// Guards db:reset, whose rm is hard-coded to data/arkhe.db*: only that file, never in production.
const url = process.env.DATABASE_URL;
if (process.env.NODE_ENV === "production") {
  console.error(
    "Refusing to run with NODE_ENV=production; this script is for the local database only.",
  );
  process.exit(1);
}
if (url !== undefined && url !== "file:data/arkhe.db") {
  console.error(`Refusing to run against ${url}; this script only resets file:data/arkhe.db.`);
  process.exit(1);
}
