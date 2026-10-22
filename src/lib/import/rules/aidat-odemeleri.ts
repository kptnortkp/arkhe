import "server-only";
import { duesOverrides, financeEntries, importItems } from "@/db/schema";
import type { Account } from "@/lib/finance/categories";
import {
  beforeOpening,
  isDuesPayer,
  NOT_RESPONSIBLE,
  overpaymentError,
  waiverReason,
  waiverRefusal,
} from "@/lib/finance/dues";
import { ACCOUNT_LABELS } from "@/lib/labels";
import { normaliseCode } from "../normalise";
import { insertChunks, type BatchDb } from "../tx";
import {
  BEFORE_OPENING_IMPORT,
  day,
  Errors,
  json,
  Keys,
  money,
  NO_SUCH_MEMBER,
  RECORD_DELETED,
  RECORD_EDITED,
  RECORD_TAKEN,
  str,
  type Rules,
  withoutKayit,
} from "./common";
import { duesIndex, duesReads, usersRead } from "./dues-snapshot";
import { balancePreview, balanceRead, itemEntriesRead, openingRead } from "./ledger-snapshot";
import { overrideSnapshot } from "./uyeler";

const NO_PERIOD = "Bu adla bir aidat dönemi yok. Dönem adları Finans › Aidat sayfasında.";
const WAIVER_FIELDS = "Muafiyet satırında tutar, tarih ve hesap boş olmalı.";
const HAS_PAYMENT = "Bu döneme ödeme var; muafiyet verilemez.";

/** "Aidat" opens the earliest period this file touched. */
function periodLinks(periods: { id: string; startsOn: string }[], touched: string[]) {
  const set = new Set(touched);
  const first = periods.filter((p) => set.has(p.id)).sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0];
  return first
    ? [
        { label: "Aidat", href: `/finans/aidat?donem=${first.id}` },
        { label: "Finans raporu", href: "/finans/rapor" },
      ]
    : undefined;
}

const reads = (q: BatchDb) => ({
  users: usersRead(q),
  ...duesReads(q),
  opening: openingRead(q),
  balance: balanceRead(q),
  items: itemEntriesRead(q, "dues_payments"),
});

export const aidatOdemeleriRules: Rules<ReturnType<typeof reads>> = {
  reads,
  plan(rows, snap, ctx) {
    const errors = new Errors();
    const keys = new Keys();
    const dues = duesIndex(snap);
    const opened = snap.opening[0]?.on ?? null;
    const byEmail = new Map(snap.users.map((u) => [u.email, u]));
    const periodsByKey = new Map<string, (typeof snap.periods)[number][]>();
    for (const p of snap.periods) {
      const k = normaliseCode(p.name);
      periodsByKey.set(k, [...(periodsByKey.get(k) ?? []), p]);
    }
    const itemOf = new Map(snap.items.map((i) => [i.kayitNo!, i]));
    const overrideOf = (userId: string, periodId: string) => dues.overridesOf(userId).get(periodId);
    type Item = (typeof snap.items)[number];
    /** Whether the row an earlier import wrote still looks exactly as it was written. */
    const intact = (item: Item) => {
      if (item.target === "dues_override") {
        const live = overrideOf(item.overrideUserId!, item.overridePeriodId!);
        return Boolean(live) && item.afterJson === json(overrideSnapshot(live!));
      }
      const e = item.entry;
      return Boolean(e) && !e!.voidedAt && e!.revision === 0 && !e!.updatedAt;
    };
    /** The message for a kayit_no that an earlier import already used for something else. */
    const conflict = (item: Item, no: string) => {
      if (item.target === "dues_override" && (!item.overridePeriodId || !item.overrideUserId)) {
        return RECORD_DELETED(no);
      }
      return intact(item) ? RECORD_TAKEN(no, item.batchAt) : RECORD_EDITED(no);
    };
    // In-file state: what earlier rows paid or waived, per member and period.
    const filePaid = new Map<string, number>();
    const fileWaived = new Set<string>();
    const payments: (typeof financeEntries.$inferInsert & { id: string; kayitNo: string })[] = [];
    const waivers: (typeof duesOverrides.$inferInsert & { kayitNo: string; createdAt: Date })[] = [];
    const effects: string[] = [];
    let unchanged = 0;

    for (const row of rows) {
      errors.absorb(row);
      const no = str(row.v.kayit_no);
      if (no) keys.claim(errors, row, "kayit_no", no);
      const waiver = row.v.islem === "waiver";
      const amount = row.v.tutar as { kurus: number } | null;
      const date = str(row.v.tarih);
      const account = row.v.hesap as Account | null;
      if (waiver) {
        for (const col of ["tutar", "tarih", "hesap"] as const) {
          if (row.raw[col] !== "") errors.add(row, col, WAIVER_FIELDS);
        }
      } else {
        for (const col of ["tutar", "tarih", "hesap"] as const) {
          if (row.raw[col] === "") errors.add(row, col, "Ödeme satırında tutar, tarih ve hesap gerekli.");
        }
      }
      let reason: string | null = null;
      if (waiver && row.v.aciklama !== undefined) {
        const r = waiverReason.safeParse(row.v.aciklama ?? "");
        if (r.success) reason = r.data;
        else errors.add(row, "aciklama", r.error.issues[0].message);
      }
      if (!errors.ok(row)) continue;
      const member = byEmail.get(str(row.v.eposta)!);
      if (!member) {
        errors.add(row, "eposta", NO_SUCH_MEMBER);
        continue;
      }
      const hits = periodsByKey.get(normaliseCode(str(row.v.donem)!)) ?? [];
      if (hits.length !== 1) {
        errors.add(row, "donem", hits.length ? "Bu adla birden çok aidat dönemi var." : NO_PERIOD);
        continue;
      }
      const period = hits[0];
      const pair = `${member.id}|${period.id}`;
      const pos = dues.position(member, [period]).periods[0];
      const paidNow = pos.paid + (filePaid.get(pair) ?? 0);
      const item = itemOf.get(no!);

      if (waiver) {
        if (item) {
          const same =
            item.target === "dues_override" &&
            item.overridePeriodId === period.id &&
            item.overrideUserId === member.id &&
            intact(item) &&
            overrideOf(member.id, period.id)?.kind === "waiver" &&
            overrideOf(member.id, period.id)?.reason === reason;
          if (same) unchanged++;
          else errors.add(row, "kayit_no", conflict(item, no!));
          continue;
        }
        const refusal = waiverRefusal(member, { period, paid: paidNow });
        if (refusal === "not_responsible") errors.add(row, "donem", NOT_RESPONSIBLE);
        else if (refusal === "paid") errors.add(row, "donem", HAS_PAYMENT);
        else if (overrideOf(member.id, period.id)?.kind === "waiver" || fileWaived.has(pair)) {
          // A hand-made waiver already says what the file asks for; never take ownership of it.
          unchanged++;
        } else {
          fileWaived.add(pair);
          waivers.push({
            duesPeriodId: period.id,
            userId: member.id,
            kind: "waiver",
            owedKurus: 0,
            reason: reason!,
            createdBy: ctx.actor.id,
            createdAt: ctx.now,
            kayitNo: no!,
          });
          effects.push(`${member.name} · ${period.name} · Muaf (${reason})`);
        }
        continue;
      }

      const description = str(row.v.aciklama);
      if (item) {
        const e = item.entry;
        const same =
          item.target === "finance_entry" &&
          intact(item) &&
          e &&
          e.memberId === member.id &&
          e.duesPeriodId === period.id &&
          e.amountKurus === amount!.kurus &&
          e.occurredOn === date &&
          e.account === account &&
          e.description === description;
        if (same) unchanged++;
        else errors.add(row, "kayit_no", conflict(item, no!));
        continue;
      }
      if (!isDuesPayer(member.role) || !pos.onRoster) {
        errors.add(row, "donem", NOT_RESPONSIBLE);
        continue;
      }
      if (beforeOpening(opened, date!)) {
        errors.add(row, "tarih", BEFORE_OPENING_IMPORT(opened!));
        continue;
      }
      const owed = fileWaived.has(pair) ? 0 : pos.owed;
      const remaining = Math.max(owed - paidNow, 0);
      if (remaining === 0) {
        errors.add(row, "tutar", "Bu dönemin borcu yok.");
        continue;
      }
      if (amount!.kurus > remaining) {
        errors.add(row, "tutar", overpaymentError(remaining));
        continue;
      }
      filePaid.set(pair, (filePaid.get(pair) ?? 0) + amount!.kurus);
      payments.push({
        id: crypto.randomUUID(),
        kayitNo: no!,
        kind: "income",
        category: "dues",
        amountKurus: amount!.kurus,
        occurredOn: date!,
        account: account!,
        description,
        memberId: member.id,
        duesPeriodId: period.id,
        paymentGroupId: null,
        createdBy: ctx.actor.id,
        createdAt: ctx.now,
      });
      effects.push(
        `${member.name} · ${period.name} · ${money(amount!.kurus)} · ${ACCOUNT_LABELS[account!]} · ${day(date!)}`,
      );
    }

    return {
      errors: errors.sorted(),
      warnings: [],
      effects,
      notes: [],
      counts: { added: payments.length + waivers.length, updated: 0, unchanged },
      links: periodLinks(snap.periods, [...payments.map((p) => p.duesPeriodId!), ...waivers.map((w) => w.duesPeriodId)]),
      balances: balancePreview(
        snap.balance[0],
        payments.map((p) => ({ kind: "income", account: p.account, toAccount: null, amountKurus: p.amountKurus })),
        "Şimdi banka ekstrenle tutmalı.",
      ),
      deactivations: 0,
      writes: (q, batchId) => [
        ...insertChunks(q, financeEntries, payments.map(withoutKayit)),
        ...insertChunks(q, duesOverrides, waivers.map(withoutKayit)),
        ...insertChunks(q, importItems, [
          ...payments.map((p) => ({
            batchId,
            target: "finance_entry" as const,
            action: "create" as const,
            financeEntryId: p.id,
            kayitScope: "dues_payments" as const,
            kayitNo: p.kayitNo,
          })),
          ...waivers.map((w) => ({
            batchId,
            target: "dues_override" as const,
            action: "create" as const,
            overridePeriodId: w.duesPeriodId,
            overrideUserId: w.userId,
            kayitScope: "dues_payments" as const,
            kayitNo: w.kayitNo,
            afterJson: json(overrideSnapshot(w)),
          })),
        ]),
      ],
    };
  },
};
