import "server-only";
import { eq } from "drizzle-orm";
import { duesOverrides, importItems, memberDues, users, type VoicePart } from "@/db/schema";
import type { DuesRate } from "@/lib/finance/categories";
import { freezesForRateChange, isDuesPayer, RATE_FREEZE_REASON } from "@/lib/finance/dues";
import { searchKey } from "@/lib/format";
import { DUES_RATE_LABELS, VOICE_PART_LABELS } from "@/lib/labels";
import { deactivateQueries } from "@/lib/members/deactivate";
import { canEditMember } from "@/lib/permissions";
import { addDays, istanbulDateOf, istanbulToUtc } from "@/lib/time";
import { insertChunks, type BatchDb, type Stmt } from "../tx";
import type { Warning } from "../types";
import { day, Errors, json, Keys, secs, str, type Rules } from "./common";
import { duesIndex, duesReads, usersRead } from "./dues-snapshot";

export const CONDUCTOR_ONLY = "Bu kişiyi yalnızca koro şefi değiştirebilir.";
const UNKNOWN_EMAIL =
  "Bu e-postayla üye yok. Aktif üyeleri Üyeler sayfasından davetle ekle; eski üyeler için ayrılış tarihini de yaz.";
const LEFT_BEFORE_JOINED = "Ayrılış tarihi katılım tarihinden önce olamaz.";

/** ayrilis_tarihi is the last day of membership: 23:59:59 Istanbul (the column has seconds). */
export const leftAtOf = (d: string) => new Date(istanbulToUtc(addDays(d, 1)).getTime() - 1000);
const auditDay = (at: Date) => day(istanbulDateOf(at));

const reads = (q: BatchDb) => ({ users: usersRead(q), ...duesReads(q) });

/** The member fields an undo restores and compares; timestamps in seconds. */
export type MemberState = {
  joinedAt: number;
  leftAt: number | null;
  isActive: 0 | 1;
  voicePart: VoicePart | null;
  rate: DuesRate | null;
  rateNote: string | null;
};

export const uyelerRules: Rules<ReturnType<typeof reads>> = {
  reads,
  plan(rows, snap, ctx) {
    const errors = new Errors();
    const keys = new Keys();
    const dues = duesIndex(snap);
    const byEmail = new Map(snap.users.map((u) => [u.email, u]));
    const updates: {
      user: (typeof snap.users)[number];
      set: Partial<typeof users.$inferInsert>;
      deactivate: Date | null;
      rate: DuesRate | null;
      freezes: { periodId: string; owedKurus: number }[];
      before: MemberState;
      after: MemberState & { role: string };
    }[] = [];
    const creates: { user: typeof users.$inferInsert & { id: string }; rate: DuesRate | null }[] = [];
    const effects: string[] = [];
    const mismatches: string[] = [];
    const deactivated: string[] = [];
    let unchanged = 0;

    for (const row of rows) {
      errors.absorb(row);
      const email = str(row.v.eposta);
      if (email) keys.claim(errors, row, "eposta", email);
      if (!errors.ok(row)) continue;
      const name = str(row.v.ad);
      const join = str(row.v.katilim_tarihi);
      const left = str(row.v.ayrilis_tarihi);
      const part = row.v.partisyon as VoicePart | null;
      const rate = row.v.aidat_orani as DuesRate | null;
      const user = byEmail.get(email!);

      if (!user) {
        if (!left) {
          errors.add(row, "eposta", UNKNOWN_EMAIL);
          continue;
        }
        if (!name) errors.add(row, "ad", "Eski üye için ad gerekli.");
        if (!join) errors.add(row, "katilim_tarihi", "Eski üye için katılım tarihi gerekli.");
        if (!part) errors.add(row, "partisyon", "Eski üye için partisyon gerekli.");
        if (!errors.ok(row)) continue;
        if (left < join!) {
          errors.add(row, "ayrilis_tarihi", LEFT_BEFORE_JOINED);
          continue;
        }
        creates.push({
          user: {
            id: crypto.randomUUID(),
            name: name!,
            email: email!,
            phone: null,
            role: "member",
            voicePart: part,
            passwordHash: null,
            isActive: false,
            joinedAt: istanbulToUtc(join!),
            leftAt: leftAtOf(left),
            createdAt: ctx.now,
          },
          rate,
        });
        effects.push(`${name} (eski üye, ${VOICE_PART_LABELS[part!]}): ${day(join!)} – ${day(left)}`);
        continue;
      }

      if (name && searchKey(name).replace(/\s+/g, " ").trim() !== searchKey(user.name).replace(/\s+/g, " ").trim()) {
        mismatches.push(`Ad portaldakinden farklı: "${name}" ↔ "${user.name}"`);
      }
      const currentRate = dues.rateOf.get(user.id)?.rate ?? "standard";
      const joinChanges = join !== null && join !== istanbulDateOf(user.joinedAt);
      const leftChanges = left !== null && (!user.leftAt || left !== istanbulDateOf(user.leftAt));
      const partChanges = part !== null && part !== user.voicePart;
      const rateChanges = rate !== null && rate !== currentRate;
      if (!joinChanges && !leftChanges && !partChanges && !rateChanges) {
        unchanged++;
        continue;
      }
      if (!canEditMember(ctx.actor, user, user.role)) {
        errors.add(row, "eposta", CONDUCTOR_ONLY);
        continue;
      }
      const joinDay = join ?? istanbulDateOf(user.joinedAt);
      const leftDay = left ?? (user.leftAt ? istanbulDateOf(user.leftAt) : null);
      if (leftDay && leftDay < joinDay) {
        errors.add(row, left ? "ayrilis_tarihi" : "katilim_tarihi", LEFT_BEFORE_JOINED);
      }
      if (leftChanges && user.isActive && user.id === ctx.actor.id) {
        errors.add(row, "ayrilis_tarihi", "Kendini pasifleştiremezsin.");
      }
      if (rateChanges && !isDuesPayer(user.role)) {
        errors.add(row, "aidat_orani", "Koro şefi aidattan sorumlu değil.");
      }
      if (!errors.ok(row)) continue;

      const set: Partial<typeof users.$inferInsert> = {};
      const changes: string[] = [];
      if (joinChanges) {
        set.joinedAt = istanbulToUtc(join!);
        changes.push(`katılım ${auditDay(user.joinedAt)} → ${day(join!)}`);
      }
      const deactivate = leftChanges && user.isActive ? leftAtOf(left!) : null;
      if (leftChanges && !deactivate) {
        set.leftAt = leftAtOf(left!);
        changes.push(`ayrılış ${user.leftAt ? auditDay(user.leftAt) : "—"} → ${day(left!)}`);
      }
      if (partChanges) {
        set.voicePart = part;
        changes.push(
          `partisyon ${user.voicePart ? VOICE_PART_LABELS[user.voicePart] : "—"} → ${VOICE_PART_LABELS[part!]}`,
        );
      }
      if (rateChanges) changes.push(`aidat ${DUES_RATE_LABELS[currentRate]} → ${DUES_RATE_LABELS[rate!]}`);
      if (deactivate) {
        deactivated.push(user.name);
        changes.push(`pasifleşir, ayrılış ${day(left!)}`);
      }
      effects.push(`${user.name}: ${changes.join(" · ")}`);

      const position = dues.position(user);
      const freezes = rateChanges ? freezesForRateChange(currentRate, rate!, position.periods) : [];
      const rateRow = dues.rateOf.get(user.id) ?? null;
      const before: MemberState = {
        joinedAt: secs(user.joinedAt)!,
        leftAt: secs(user.leftAt),
        isActive: user.isActive ? 1 : 0,
        voicePart: user.voicePart,
        rate: rateRow?.rate ?? null,
        rateNote: rateRow?.note ?? null,
      };
      const after = {
        joinedAt: secs(set.joinedAt ?? user.joinedAt)!,
        leftAt: secs(deactivate ?? (set.leftAt as Date | undefined) ?? user.leftAt),
        isActive: (deactivate ? 0 : before.isActive) as 0 | 1,
        voicePart: (set.voicePart ?? user.voicePart) as VoicePart | null,
        rate: rateChanges ? rate : before.rate,
        rateNote: before.rateNote,
        role: user.role,
      };
      updates.push({ user, set, deactivate, rate: rateChanges ? rate : null, freezes, before, after });
    }

    const warnings: Warning[] = [];
    if (deactivated.length) {
      warnings.push({
        kind: "deactivate",
        text: `${deactivated.length} kişi pasifleştirilecek ve oturumları kapatılacak: ${deactivated.join(", ")}`,
        items: deactivated,
      });
    }
    if (mismatches.length) {
      warnings.push({
        kind: "nameMismatch",
        text: `${mismatches.length} kişinin adı portaldakinden farklı (ad değişmez).`,
        items: mismatches,
      });
    }

    return {
      errors: errors.sorted(),
      warnings,
      effects,
      notes: [],
      counts: { added: creates.length, updated: updates.length, unchanged },
      deactivations: deactivated.length,
      writes: (q, batchId) => {
        const out: Stmt[] = [];
        for (const u of updates) {
          if (Object.keys(u.set).length) out.push(q.update(users).set(u.set).where(eq(users.id, u.user.id)));
          if (u.deactivate) out.push(...deactivateQueries(q, u.user.id, u.deactivate));
          if (u.rate) {
            out.push(
              q
                .insert(memberDues)
                .values({ userId: u.user.id, rate: u.rate, note: u.before.rateNote, updatedBy: ctx.actor.id, updatedAt: ctx.now })
                .onConflictDoUpdate({
                  target: memberDues.userId,
                  set: { rate: u.rate, updatedBy: ctx.actor.id, updatedAt: ctx.now },
                }),
            );
          }
        }
        const freezes = updates.flatMap((u) =>
          u.freezes.map((f) => ({
            duesPeriodId: f.periodId,
            userId: u.user.id,
            kind: "freeze" as const,
            owedKurus: f.owedKurus,
            reason: RATE_FREEZE_REASON,
            createdBy: ctx.actor.id,
            createdAt: ctx.now,
          })),
        );
        out.push(...insertChunks(q, duesOverrides, freezes));
        out.push(...insertChunks(q, users, creates.map((c) => c.user)));
        out.push(
          ...insertChunks(
            q,
            memberDues,
            creates
              .filter((c) => c.rate)
              .map((c) => ({ userId: c.user.id, rate: c.rate!, note: null, updatedBy: ctx.actor.id, updatedAt: ctx.now })),
          ),
        );
        out.push(
          ...insertChunks(q, importItems, [
            ...updates.map((u) => ({
              batchId,
              target: "user" as const,
              action: "update" as const,
              userId: u.user.id,
              beforeJson: json(u.before),
              afterJson: json(u.after),
            })),
            ...freezes.map((f) => ({
              batchId,
              target: "dues_override" as const,
              action: "create" as const,
              overridePeriodId: f.duesPeriodId,
              overrideUserId: f.userId,
              afterJson: json(overrideSnapshot(f)),
            })),
            ...creates.map((c) => ({
              batchId,
              target: "user" as const,
              action: "create" as const,
              userId: c.user.id,
              afterJson: json(createdSnapshot(c.user, c.rate)),
            })),
          ]),
        );
        return out;
      },
    };
  },
};

export function overrideSnapshot(o: {
  kind: string;
  owedKurus: number;
  reason: string;
  createdBy?: string | null;
  createdAt?: Date | null;
}) {
  return {
    kind: o.kind,
    owedKurus: o.owedKurus,
    reason: o.reason,
    createdBy: o.createdBy ?? null,
    createdAt: secs(o.createdAt ?? null),
  };
}

export function createdSnapshot(
  u: {
    name: string;
    email: string;
    phone?: string | null;
    role?: string;
    voicePart?: string | null;
    isActive?: boolean;
    joinedAt?: Date;
    leftAt?: Date | null;
  },
  rate: string | null,
  hasPassword = false,
) {
  return {
    name: u.name,
    email: u.email,
    phone: u.phone ?? null,
    role: u.role ?? "member",
    voicePart: u.voicePart ?? null,
    isActive: u.isActive ? 1 : 0,
    joinedAt: secs(u.joinedAt ?? null),
    leftAt: secs(u.leftAt ?? null),
    hasPassword: hasPassword ? 1 : 0,
    rate,
  };
}
