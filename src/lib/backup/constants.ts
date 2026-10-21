// Pure constants shared by the run, the page and the scripts.

// A `running` row older than this is treated as dead. Must stay well above the 60 s maxDuration
// exported (as a literal) by the cron route and by src/app/(portal)/yedek/page.tsx.
export const STALE_SECONDS = 600;
// No manual send within this long after a `sent` run.
export const COOLDOWN_SECONDS = 600;
// Base64 grows attachments by 4/3; Gmail's 25 MB limit applies to the encoded message.
export const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;
export const MAX_RECIPIENTS = 5;
export const RUN_LOG_LIMIT = 12;

export const RECIPIENT_CHANGES_PER_DAY = 10;
export const MANUAL_SENDS_PER_HOUR = 6;

export const DEV_CRON_SECRET = "dev-only-cron-secret";
export const DEV_PASSPHRASE = "dev-only-backup-passphrase";
export const MIN_CRON_SECRET_PROD = 32;
export const MIN_PASSPHRASE = 16;

export const OUTBOX_FROM = '"Arkhe Portal" <outbox@arkhe.local>';
export const README_SECTION = "Aylık yedek e-postası";
