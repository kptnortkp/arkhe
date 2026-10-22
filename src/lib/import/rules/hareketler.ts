import "server-only";
import { and, between, isNull, ne, notInArray, sql } from "drizzle-orm";
import { events, financeEntries, importItems, sponsors } from "@/db/schema";
import type { Account, Category } from "@/lib/finance/categories";
import { kindOfCategory } from "@/lib/finance/categories";
import { beforeOpening } from "@/lib/finance/dues";
import { entryRow } from "@/lib/finance/entries";
import { entrySchema } from "@/lib/finance/schemas";
import { sponsorSchema } from "@/lib/finance/sponsors";
import { searchKey } from "@/lib/format";
import { ACCOUNT_LABELS, CATEGORY_LABELS, ENTRY_KIND_LABELS } from "@/lib/labels";
import { EXPENSE_CODES, INCOME_CODES, unknownCode } from "../codes";
import type { ImportRow } from "../engine";
import { normaliseCode } from "../normalise";
import { insertChunks, type BatchDb } from "../tx";
import type { Warning } from "../types";
import {
  BEFORE_OPENING_IMPORT,
  day,
  Errors,
  json,
  Keys,
  money,
  RECORD_EDITED,
  RECORD_TAKEN,
  str,
  type Rules,
  withoutKayit,
} from "./common";
import { balancePreview, balanceRead, itemEntriesRead, openingRead } from "./ledger-snapshot";

const FIELD = {
  kind: "tur",
  category: "kategori",
  amount: "tutar",
  occurredOn: "tarih",
  account: "hesap",
  toAccount: "hedef_hesap",
  description: "aciklama",
  counterparty: "karsi_taraf",
  documentUrl: "belge_linki",
  sponsorId: "sponsor",
  eventId: "etkinlik",
} as const;
// Stands in for a sponsor that is created by this file, so the UI schema can run unchanged.
const NEW_SPONSOR = "00000000-0000-4000-8000-000000000000";

/** Hand-made entries (not opening, not imported) in the file's date span: double-count candidates. */
function handEntriesRead(q: BatchDb, rows: ImportRow[]) {
  const dates = rows.map((r) => r.v.tarih).filter((d): d is string => typeof d === "string").sort();
  return q
    .select({
      occurredOn: financeEntries.occurredOn,
      kind: financeEntries.kind,
      category: financeEntries.category,
      amountKurus: financeEntries.amountKurus,
    })
    .from(financeEntries)
    .where(
      and(
        isNull(financeEntries.voidedAt),
        ne(financeEntries.kind, "opening"),
        // No dates parsed: an empty span, so the read stays cheap.
        between(financeEntries.occurredOn, dates[0] ?? "9999-12-31", dates.at(-1) ?? "0000-01-01"),
        notInArray(
          financeEntries.id,
          sql`(select ${importItems.financeEntryId} from ${importItems} where ${importItems.financeEntryId} is not null)`,
        ),
      ),
    );
}

const handKey = (e: { occurredOn: string; kind: string; category?: string | null; amountKurus: number }) =>
  `${e.occurredOn}|${e.kind}|${e.category ?? ""}|${e.amountKurus}`;

const reads = (q: BatchDb, rows: ImportRow[]) => ({
  hand: handEntriesRead(q, rows),
  opening: openingRead(q),
  balance: balanceRead(q),
  sponsors: q.select({ id: sponsors.id, name: sponsors.name, nameKey: sponsors.nameKey }).from(sponsors),
  events: q.select({ id: events.id, name: events.name }).from(events),
  items: itemEntriesRead(q, "entries"),
});

type Kind = "income" | "expense" | "transfer";

export const hareketlerRules: Rules<ReturnType<typeof reads>> = {
  reads,
  plan(rows, snap, ctx) {
    const errors = new Errors();
    const keys = new Keys();
    const opened = snap.opening[0]?.on ?? null;
    const sponsorByKey = new Map(snap.sponsors.map((s) => [s.nameKey, s]));
    const eventsByKey = new Map<string, { id: string }[]>();
    for (const e of snap.events) {
      const k = normaliseCode(e.name);
      eventsByKey.set(k, [...(eventsByKey.get(k) ?? []), e]);
    }
    const itemOf = new Map(snap.items.map((i) => [i.kayitNo!, i]));
    const newSponsors = new Map<string, { id: string; name: string; nameKey: string }>();
    const created: (typeof financeEntries.$inferInsert & { id: string; kayitNo: string })[] = [];
    const effects: string[] = [];
    let unchanged = 0;

    for (const row of rows) {
      errors.absorb(row);
      const no = str(row.v.kayit_no);
      if (no) keys.claim(errors, row, "kayit_no", no);
      const kind = row.v.tur as Kind | null;
      const category = row.v.kategori as Category | null;
      if (category === "dues") errors.add(row, "kategori", "Aidat ödemelerini 6. adımdaki aidat dosyasıyla aktar.");
      if (kind === "transfer") {
        if (category) errors.add(row, "kategori", "Virmanda kategori olmaz.");
        if (row.v.sponsor) errors.add(row, "sponsor", "Virmanda sponsor olmaz.");
        if (row.v.etkinlik) errors.add(row, "etkinlik", "Virmanda etkinlik olmaz.");
        if (row.v.belge_linki) errors.add(row, "belge_linki", "Virmanda belge bağlantısı olmaz.");
      } else if (kind) {
        if (row.v.hedef_hesap) errors.add(row, "hedef_hesap", "Hedef hesap yalnızca virmanda yazılır.");
        if (category && category !== "dues" && kindOfCategory(category) !== kind) {
          errors.add(row, "kategori", unknownCode(row.raw.kategori, kind === "income" ? INCOME_CODES : EXPENSE_CODES));
        }
        if (row.v.sponsor && category !== "sponsorship") {
          errors.add(row, "sponsor", "Sponsor yalnızca sponsorluk kategorisinde yazılır.");
        }
      }
      if (!errors.ok(row)) continue;

      let sponsorId: string | null = null;
      let sponsorName: string | null = null;
      if (row.v.sponsor) {
        const s = sponsorSchema.shape.name.safeParse(row.v.sponsor);
        if (!s.success) {
          errors.add(row, "sponsor", s.error.issues[0].message);
          continue;
        }
        sponsorName = s.data;
        const key = searchKey(s.data);
        const known = sponsorByKey.get(key) ?? newSponsors.get(key);
        sponsorId = known?.id ?? NEW_SPONSOR;
      }
      let eventId: string | null = null;
      if (row.v.etkinlik) {
        const hits = eventsByKey.get(normaliseCode(String(row.v.etkinlik))) ?? [];
        if (hits.length === 0) errors.add(row, "etkinlik", "Bu adla bir etkinlik yok.");
        else if (hits.length > 1) {
          errors.add(row, "etkinlik", "Bu adla birden çok etkinlik var; etkinliği adından ayırt et.");
        } else eventId = hits[0].id;
      }
      if (!errors.ok(row)) continue;

      const amount = row.v.tutar as { text: string };
      const parsed = entrySchema.safeParse({
        kind,
        category: category ?? undefined,
        amount: amount.text,
        occurredOn: row.v.tarih,
        account: row.v.hesap,
        toAccount: row.v.hedef_hesap ?? undefined,
        description: str(row.v.aciklama) ?? undefined,
        counterparty: str(row.v.karsi_taraf) ?? undefined,
        documentUrl: str(row.v.belge_linki) ?? undefined,
        sponsorId: sponsorId ?? undefined,
        eventId: eventId ?? undefined,
      });
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          errors.add(row, FIELD[issue.path[0] as keyof typeof FIELD] ?? null, issue.message);
        }
        continue;
      }
      const entry = entryRow(parsed.data);
      if (beforeOpening(opened, entry.occurredOn)) {
        errors.add(row, "tarih", BEFORE_OPENING_IMPORT(opened!));
        continue;
      }

      const item = itemOf.get(no!);
      if (item) {
        const e = item.entry;
        const untouched = e && !e.voidedAt && e.revision === 0 && !e.updatedAt;
        const same =
          untouched &&
          e.kind === entry.kind &&
          e.category === entry.category &&
          e.amountKurus === entry.amountKurus &&
          e.occurredOn === entry.occurredOn &&
          e.account === entry.account &&
          e.toAccount === entry.toAccount &&
          e.description === entry.description &&
          e.counterparty === entry.counterparty &&
          e.documentUrl === entry.documentUrl &&
          e.sponsorId === entry.sponsorId &&
          e.eventId === entry.eventId;
        if (same) unchanged++;
        else errors.add(row, "kayit_no", untouched ? RECORD_TAKEN(no!, item.batchAt) : RECORD_EDITED(no!));
        continue;
      }

      if (entry.sponsorId === NEW_SPONSOR) {
        const key = searchKey(sponsorName!);
        const fresh = { id: crypto.randomUUID(), name: sponsorName!, nameKey: key };
        newSponsors.set(key, fresh);
        entry.sponsorId = fresh.id;
      }
      created.push({ id: crypto.randomUUID(), kayitNo: no!, ...entry, createdBy: ctx.actor.id, createdAt: ctx.now });
      const where =
        entry.kind === "transfer"
          ? `${ACCOUNT_LABELS[entry.account]} → ${ACCOUNT_LABELS[entry.toAccount as Account]}`
          : `${CATEGORY_LABELS[entry.category!]} · ${money(entry.amountKurus)} · ${ACCOUNT_LABELS[entry.account]}`;
      effects.push(
        entry.kind === "transfer"
          ? `${day(entry.occurredOn)} · ${ENTRY_KIND_LABELS.transfer} · ${where} · ${money(entry.amountKurus)}`
          : `${day(entry.occurredOn)} · ${ENTRY_KIND_LABELS[entry.kind]} · ${where}`,
      );
    }

    const warnings: Warning[] = [];
    const hand = new Set(snap.hand.map(handKey));
    const twins = created.flatMap((e, i) => (hand.has(handKey(e)) ? [effects[i]] : []));
    if (twins.length) {
      const shown = twins.slice(0, 3).join("; ") + (twins.length > 3 ? "; …" : "");
      warnings.push({
        kind: "other",
        text: `${twins.length} satır portalda elle girilmiş bir hareketle aynı gün, kategori ve tutarda (${shown}). Aynı hareket iki kez sayılmasın: tekrar olanları dosyadan çıkar.`,
        items: twins.slice(0, 50),
      });
    }
    if (newSponsors.size) {
      const names = [...newSponsors.values()].map((s) => s.name);
      warnings.push({ kind: "newSponsor", text: `Yeni sponsor oluşturulacak: ${names.join(", ")}`, items: names });
    }
    const sponsorRows = [...newSponsors.values()].map((s) => ({ ...s, createdAt: ctx.now }));
    return {
      errors: errors.sorted(),
      warnings,
      effects,
      notes: [],
      counts: { added: created.length, updated: 0, unchanged },
      links: created.length
        ? [
            {
              label: "Hareketler",
              href: `/finans/hareketler?ay=${created.map((e) => e.occurredOn).sort()[0].slice(0, 7)}`,
            },
            { label: "Finans raporu", href: "/finans/rapor" },
          ]
        : undefined,
      balances: balancePreview(
        snap.balance[0],
        created as { kind: string; account: Account; toAccount: Account | null; amountKurus: number }[],
        "Banka ekstrenle karşılaştır. Aidat ödemeleri 6. adımda eklenince bu rakam artar.",
      ),
      deactivations: 0,
      writes: (q, batchId) => [
        ...insertChunks(q, sponsors, sponsorRows),
        ...insertChunks(q, financeEntries, created.map(withoutKayit)),
        ...insertChunks(q, importItems, [
          ...sponsorRows.map((s) => ({
            batchId,
            target: "sponsor" as const,
            action: "create" as const,
            sponsorId: s.id,
            afterJson: json(sponsorSnapshot(s)),
          })),
          ...created.map((e) => ({
            batchId,
            target: "finance_entry" as const,
            action: "create" as const,
            financeEntryId: e.id,
            kayitScope: "entries" as const,
            kayitNo: e.kayitNo,
          })),
        ]),
      ],
    };
  },
};

export function sponsorSnapshot(s: {
  name: string;
  nameKey: string;
  contactName?: string | null;
  contact?: string | null;
  note?: string | null;
  isActive?: boolean;
}) {
  return {
    name: s.name,
    nameKey: s.nameKey,
    contactName: s.contactName ?? null,
    contact: s.contact ?? null,
    note: s.note ?? null,
    isActive: s.isActive === false ? 0 : 1,
  };
}
