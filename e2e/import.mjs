// Shared helpers for the Phase 8b import tests: fixtures built in code, UI flow, crafted calls, DB snapshots.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { actionIds, BASE, db } from "./lib.mjs";

export const DOCS = new URL("../docs/ice-aktarma/", import.meta.url);
export const SLUGS = ["uyeler", "donemler", "yoklama", "hareketler", "aidat-donemleri", "aidat-odemeleri"];
export const fileBase = (slug) => `${SLUGS.indexOf(slug) + 1}-${slug}`;
export const docFile = (slug, ext) => readFileSync(new URL(`${fileBase(slug)}.${ext}`, DOCS));
export const ACTIONS = "src/app/(portal)/ice-aktar/actions.ts";
export const PASTE_NAME = "yapistirilan-metin.csv";

export const H = {
  uyeler: "eposta;ad;katilim_tarihi;ayrilis_tarihi;partisyon;aidat_orani",
  donemler: "ad;baslangic;bitis",
  yoklama: "tarih;baslangic;bitis;tur;partiler;baslik;yer;eposta;durum;not",
  hareketler: "kayit_no;tarih;tur;kategori;tutar;hesap;hedef_hesap;aciklama;karsi_taraf;sponsor;etkinlik;belge_linki",
  "aidat-donemleri": "ad;baslangic;bitis;son_odeme;tutar;indirimli_tutar",
  "aidat-odemeleri": "kayit_no;islem;eposta;donem;tutar;tarih;hesap;aciklama",
};

/** Lines joined with `eol`, optional BOM: the byte variants AC 9 compares. */
export function csv(lines, { bom = false, eol = "\n" } = {}) {
  return Buffer.from((bom ? "﻿" : "") + lines.join(eol) + eol, "utf8");
}

const CP1254 = { ç: 0xe7, Ç: 0xc7, ğ: 0xf0, Ğ: 0xd0, ı: 0xfd, İ: 0xdd, ö: 0xf6, Ö: 0xd6, ş: 0xfe, Ş: 0xde, ü: 0xfc, Ü: 0xdc };
/** What Excel TR's plain "CSV" writes. */
export function win1254(text) {
  return Buffer.from([...text].map((ch) => CP1254[ch] ?? ch.charCodeAt(0)));
}

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Istanbul date `days` from today. */
export const dayFrom = (days) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(Date.now() + days * 86_400_000));
const epoch = (date) => Math.floor(Date.parse(`${date}T00:00:00+03:00`) / 1000);

/** ux §8.2's fictional cast; a demo password hash so the deactivation test can log one in. */
export const CAST = [
  ["ayse.demir@ornek.com", "Ayşe Demir", "member", "alto"],
  ["mehmet.kaya@ornek.com", "Mehmet Kaya", "member", "tenor"],
  ["elif.sahin@ornek.com", "Elif Şahin", "member", "soprano"],
  ["can.yildiz@ornek.com", "Can Yıldız", "board", "bass"],
  ["selin.cakir@ornek.com", "Selin Çakır", "member", "soprano"],
  ["selin.aydin@ornek.com", "Selin Aydın", "member", "alto"],
  ["deniz.sef@ornek.com", "Deniz Arslan", "conductor", null],
];

export async function arrangeCast({ joined = "2026-10-19" } = {}) {
  const pw = (await db.execute("select password_hash from users where email = 'korist@arkhe.local'")).rows[0][0];
  for (const [email, name, role, part] of CAST) {
    await db.execute({
      sql: "insert into users (id, name, email, role, voice_part, password_hash, joined_at) values (?, ?, ?, ?, ?, ?, ?)",
      args: [crypto.randomUUID(), name, email, role, part, pw, epoch(joined)],
    });
  }
}

export async function setJoined(emailLike, date) {
  await db.execute({ sql: "update users set joined_at = ? where email like ?", args: [epoch(date), emailLike] });
}

/** Moves the fixture's opening balance date (cleanup's seedFinance puts it back). */
export async function setOpening(date) {
  await db.execute({
    sql: "update finance_entries set occurred_on = ? where kind = 'opening' and voided_at is null",
    args: [date],
  });
}

export async function count(sql, args = []) {
  return Number((await db.execute({ sql, args })).rows[0][0]);
}

const VOLATILE = new Set(["__drizzle_migrations", "login_attempts"]);
/** Row count plus a hash of the sorted rows per table; sessions by id only (last_seen moves). */
export async function snapshot(exclude = []) {
  const tables = (
    await db.execute("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
  ).rows.map((r) => String(r[0]));
  const out = {};
  for (const t of tables) {
    if (VOLATILE.has(t) || exclude.includes(t)) continue;
    const sql = t === "sessions" ? "select id from sessions" : `select * from "${t}"`;
    const rows = (await db.execute(sql)).rows.map((r) => JSON.stringify(Object.values(r))).sort();
    out[t] = `${rows.length}:${createHash("sha256").update(rows.join("\n")).digest("hex").slice(0, 12)}`;
  }
  return out;
}

export function diff(a, b) {
  return Object.keys({ ...a, ...b })
    .filter((k) => a[k] !== b[k])
    .map((k) => `${k}: ${a[k]} → ${b[k]}`);
}

/** The visible outcome of the last check or commit. */
export async function readResult(page) {
  return page.evaluate(() => {
    const area = document.querySelector("[data-testid=import-result]");
    const all = (sel) => [...area.querySelectorAll(sel)].map((e) => e.textContent.trim());
    return {
      kind: area.dataset.kind,
      summary: document.querySelector("[data-testid=import-summary]").textContent.trim(),
      text: area.innerText,
      errors: [...area.querySelectorAll("[data-testid=import-error]")].map((e) => e.dataset.text),
      more: area.querySelector("[data-testid=import-errors-more]")?.textContent.trim() ?? null,
      warnings: [...area.querySelectorAll("[data-testid=import-warnings] > ul > li")].map((li) => ({
        kind: li.dataset.kind,
        text: li.firstChild?.textContent.trim() ?? "",
      })),
      effects: all("[data-testid=import-effects] > li"),
      commit: [...area.querySelectorAll("button")].some((b) => b.textContent.startsWith("İçe aktar")),
      // [cash before, cash after, bank before, bank after] in kuruş.
      balances: [...area.querySelectorAll("[data-testid=import-balances] [data-testid=money]")].map((m) => Number(m.dataset.kurus)),
    };
  });
}

/** Opens the type page (unless `stay`), loads the file or text, runs Kontrol et and reads the result. */
export async function checkUI(page, slug, { text, buffer, name = "test.csv", paste = false, stay = false } = {}) {
  if (!stay) await page.goto(`${BASE}/ice-aktar/${slug}`);
  await page.locator("[data-testid=import-result][data-ready]").waitFor({ state: "attached" });
  if (paste) {
    await page.getByRole("tab", { name: "Metni yapıştır" }).click();
    await page.getByLabel("CSV metni").fill(text);
  } else {
    await page.setInputFiles("#import-file", {
      name,
      mimeType: "text/csv",
      buffer: buffer ?? Buffer.from(text, "utf8"),
    });
    await page.locator("[data-testid=picked-name]").filter({ hasText: name }).waitFor();
  }
  await page.getByRole("button", { name: "Kontrol et" }).click();
  await page.locator("[data-testid=import-result]:not([data-kind=idle])").waitFor({ timeout: 60_000 });
  return readResult(page);
}

/** İçe aktar → confirm → the outcome. */
export async function commitUI(page) {
  await page.getByRole("button", { name: /^İçe aktar \(/ }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "İçe aktar" }).click();
  await page.locator("[data-testid=import-result]:not([data-kind=clean])").waitFor({ timeout: 60_000 });
  return readResult(page);
}

/** Check + commit in one go; returns both results. */
export async function importUI(page, slug, opts) {
  const check = await checkUI(page, slug, opts);
  if (check.kind !== "clean") return { check, done: null };
  return { check, done: await commitUI(page) };
}

let ids = null;
export async function importActions(page) {
  if (!ids) {
    // The manifest lists the actions once a page that uses them has compiled.
    await page.goto(`${BASE}/ice-aktar/donemler`);
    await page.goto(`${BASE}/ice-aktar/gecmis`);
    ids = await actionIds(ACTIONS, "x");
  }
  return ids;
}

/** A crafted (slug, formData) call, encoded the way the bound client call is (field 0 + _1_ prefix). */
export async function crafted(page, name, slug, { text, base64, fileName = "t.csv", sha } = {}) {
  const action = (await importActions(page))[name];
  return page.evaluate(
    async ({ id, slug, text, base64, fileName, sha }) => {
      const fd = new FormData();
      const body = base64 !== undefined ? Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)) : text;
      if (body !== undefined) fd.append("_1_file", new File([body], fileName, { type: "text/csv" }));
      if (sha) fd.append("_1_sha256", sha);
      fd.append("0", JSON.stringify([slug, "$K1"]));
      const res = await fetch(`/ice-aktar/${slug}`, {
        method: "POST",
        headers: { "Next-Action": id, Accept: "text/x-component" },
        body: fd,
      });
      return { status: res.status, body: await res.text() };
    },
    { id: action.id, slug, text, base64, fileName, sha },
  );
}

/** undoImport(batchId) as the page's user. */
export async function craftedUndo(page, batchId) {
  const action = (await importActions(page)).undoImport;
  return page.evaluate(
    async ({ id, batchId }) => {
      const res = await fetch("/ice-aktar/gecmis", {
        method: "POST",
        headers: {
          "Next-Action": id,
          Accept: "text/x-component",
          "Content-Type": "text/plain;charset=UTF-8",
        },
        body: JSON.stringify([batchId]),
      });
      return res.text();
    },
    { id: action.id, batchId },
  );
}

/** Undoes every live batch, newest first, as the conductor would (direct crafted calls). */
export async function undoAll(page) {
  const { rows } = await db.execute("select id from import_batches where status = 'imported' order by id desc");
  const out = [];
  for (const r of rows) out.push(await craftedUndo(page, Number(r.id)));
  return out;
}

export async function latestBatch() {
  return (await db.execute("select * from import_batches order by id desc limit 1")).rows[0] ?? null;
}

export async function grantClipboard(page) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
}

export const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());
