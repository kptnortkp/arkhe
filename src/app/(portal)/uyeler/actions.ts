"use server";

import { and, eq, isNull, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { invites, users } from "@/db/schema";
import { requireManager } from "@/lib/auth/dal";
import { deleteUserSessions } from "@/lib/auth/session";
import { createSetPasswordLink } from "@/lib/auth/set-password-links";
import { canEditMember, canIssueLink } from "@/lib/permissions";
import { fieldErrorsOf, formValues, memberSchema, type FormState } from "@/lib/validation";

export type MemberFormState = FormState & {
  link?: {
    url: string;
    expiresAt: Date;
    memberId: string;
    name: string;
    email: string;
    phone: string | null;
    purpose: "invite" | "reset";
  };
};

const FORBIDDEN = "Bu işlem için yetkin yok.";

async function emailTaken(email: string, exceptId?: string) {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(exceptId ? and(eq(users.email, email), ne(users.id, exceptId)) : eq(users.email, email))
    .limit(1);
  return Boolean(row);
}

async function loadTarget(id: string) {
  const [target] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      passwordHash: users.passwordHash,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return target ?? null;
}

export async function createMember(
  _prev: MemberFormState,
  formData: FormData,
): Promise<MemberFormState> {
  const actor = await requireManager();
  const parsed = memberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const data = parsed.data;
  const { joinedOn, ...rest } = data;

  if (!canEditMember(actor, { id: "", role: data.role }, data.role))
    return { error: FORBIDDEN, values: formValues(formData) };
  if (await emailTaken(data.email)) {
    return {
      values: formValues(formData),
      fieldErrors: { email: ["Bu e-posta ile kayıtlı bir üye zaten var."] },
    };
  }

  let member: { id: string; name: string };
  try {
    [member] = await db
      .insert(users)
      .values({ ...rest, joinedAt: joinedOn })
      .returning({ id: users.id, name: users.name });
  } catch (error) {
    // Two managers adding the same address at once: the unique index wins the race.
    if (String(error).includes("UNIQUE")) {
      return {
        values: formValues(formData),
        fieldErrors: { email: ["Bu e-posta ile kayıtlı bir üye zaten var."] },
      };
    }
    throw error;
  }
  const link = await createSetPasswordLink(member.id, "invite");
  revalidatePath("/uyeler");
  return {
    link: {
      ...link,
      memberId: member.id,
      name: member.name,
      email: data.email,
      phone: data.phone,
      purpose: "invite",
    },
  };
}

export async function updateMember(
  id: string,
  _prev: MemberFormState,
  formData: FormData,
): Promise<MemberFormState> {
  const actor = await requireManager();
  const target = await loadTarget(id);
  const parsed = memberSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const data = parsed.data;
  const { joinedOn, ...rest } = data;

  if (!target || !canEditMember(actor, target, data.role))
    return { error: FORBIDDEN, values: formValues(formData) };
  if (await emailTaken(data.email, id)) {
    return {
      values: formValues(formData),
      fieldErrors: { email: ["Bu e-posta ile kayıtlı başka bir üye var."] },
    };
  }

  await db
    .update(users)
    .set({ ...rest, joinedAt: joinedOn })
    .where(eq(users.id, id));
  revalidatePath("/uyeler");
  revalidatePath(`/uyeler/${id}`);
  return { success: "Değişiklikler kaydedildi." };
}

export async function createMemberLink(id: string): Promise<MemberFormState> {
  const actor = await requireManager();
  const target = await loadTarget(id);
  if (!target || !target.isActive || !canIssueLink(actor, target)) return { error: FORBIDDEN };

  const purpose = target.passwordHash ? "reset" : "invite";
  const link = await createSetPasswordLink(id, purpose);
  return {
    link: {
      ...link,
      memberId: id,
      name: target.name,
      email: target.email,
      phone: target.phone,
      purpose,
    },
  };
}

export async function setMemberActive(id: string, active: boolean): Promise<FormState> {
  const actor = await requireManager();
  const target = await loadTarget(id);
  if (!target || actor.id === id || !canEditMember(actor, target, target.role))
    return { error: FORBIDDEN };

  await db
    .update(users)
    .set({ isActive: active, leftAt: active ? null : new Date() })
    .where(eq(users.id, id));
  if (!active) {
    await deleteUserSessions(id);
    await db.delete(invites).where(and(eq(invites.userId, id), isNull(invites.usedAt)));
  }
  revalidatePath("/uyeler");
  revalidatePath(`/uyeler/${id}`);
  return {
    success: active ? "Üye yeniden aktif." : "Üye pasifleştirildi, oturumları kapatıldı.",
  };
}
