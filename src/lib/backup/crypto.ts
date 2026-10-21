// Pure (node:crypto + node:zlib): the .sql.gz.enc format, shared by the run and db:decrypt.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

export const MAGIC = "ARKHE-BK1";
const KDF_SCRYPT = 1;
const LOG2_N = 17;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const HEADER_BYTES = MAGIC.length + 4 + SALT_BYTES + IV_BYTES;

export class BadBackup extends Error {}

function deriveKey(passphrase: string, salt: Buffer, log2n: number, r: number, p: number) {
  const N = 2 ** log2n;
  // Node's default maxmem (32 MiB) is below what N = 2^17, r = 8 needs (128 MiB).
  return scryptSync(Buffer.from(passphrase.normalize("NFC"), "utf8"), salt, 32, {
    N,
    r,
    p,
    maxmem: 128 * N * r * p + 64 * 1024 * 1024,
  });
}

/** gzip, then AES-256-GCM with the whole header as AAD. */
export function encryptBackup(plain: Buffer, passphrase: string) {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const header = Buffer.concat([
    Buffer.from(MAGIC, "ascii"),
    Buffer.from([KDF_SCRYPT, LOG2_N, R, P]),
    salt,
    iv,
  ]);
  const key = deriveKey(passphrase, salt, LOG2_N, R, P);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);
  const body = Buffer.concat([cipher.update(gzipSync(plain, { level: 9 })), cipher.final()]);
  return Buffer.concat([header, body, cipher.getAuthTag()]);
}

export function isEncryptedBackup(head: Buffer) {
  return head.subarray(0, MAGIC.length).toString("latin1") === MAGIC;
}

export function decryptBackup(file: Buffer, passphrase: string) {
  if (file.length < HEADER_BYTES + TAG_BYTES + 1 || !isEncryptedBackup(file)) {
    throw new BadBackup("Not an Arkhe backup file.");
  }
  let o = MAGIC.length;
  const [kdf, log2n, r, p] = file.subarray(o, o + 4);
  o += 4;
  // Only parameters this format ever writes (at most 256 MiB): a crafted header can't ask for more.
  if (kdf !== KDF_SCRYPT || log2n < 14 || log2n > 18 || r !== R || p !== P) {
    throw new BadBackup("Wrong passphrase or damaged file.");
  }
  const salt = file.subarray(o, o + SALT_BYTES);
  o += SALT_BYTES;
  const iv = file.subarray(o, o + IV_BYTES);
  const header = file.subarray(0, HEADER_BYTES);
  const body = file.subarray(HEADER_BYTES, file.length - TAG_BYTES);
  const tag = file.subarray(file.length - TAG_BYTES);
  let gz: Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(passphrase, salt, log2n, r, p), iv);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    gz = Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new BadBackup("Wrong passphrase or damaged file.");
  }
  try {
    return gunzipSync(gz, { maxOutputLength: 1024 * 1024 * 1024 });
  } catch {
    throw new BadBackup("Wrong passphrase or damaged file.");
  }
}
