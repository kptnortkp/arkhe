import { eq, sql } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireManager } from "@/lib/auth/dal";
import { istanbulDateOf } from "@/lib/time";
import { canEditMember, canIssueLink } from "@/lib/permissions";
import { updateMember } from "../actions";
import { MemberForm } from "../member-form";
import { MemberAccess } from "./member-access";

export const metadata = { title: "Üye" };

export default async function MemberPage({ params }: PageProps<"/uyeler/[id]">) {
  const actor = await requireManager();
  const { id } = await params;
  const [member] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      voicePart: users.voicePart,
      isActive: users.isActive,
      joinedAt: users.joinedAt,
      hasPassword: sql<boolean>`${users.passwordHash} is not null`.mapWith(Boolean),
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!member) notFound();

  const isSelf = actor.id === member.id;
  const editable = canEditMember(actor, member, member.role);

  return (
    <div className="max-w-2xl space-y-8">
      <div className="space-y-2">
        <Link
          href="/uyeler"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Üyeler
        </Link>
        <h1 className="text-4xl font-medium">{member.name}</h1>
        {!member.isActive && (
          <p className="w-fit rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            Pasif üye
          </p>
        )}
      </div>
      {editable ? (
        <>
          <MemberForm
            action={updateMember.bind(null, member.id)}
            member={{
              name: member.name,
              email: member.email,
              phone: member.phone,
              role: member.role,
              voicePart: member.voicePart,
              joinedOn: istanbulDateOf(member.joinedAt),
            }}
            actorRole={actor.role}
            isSelf={isSelf}
            defaultJoinedOn={istanbulDateOf(member.joinedAt)}
          />
          <MemberAccess
            id={member.id}
            isActive={member.isActive}
            hasPassword={member.hasPassword}
            canIssueLink={canIssueLink(actor, member)}
            canToggleActive={!isSelf}
          />
        </>
      ) : (
        <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
          Şef ve yönetim kurulu hesaplarını sadece koro şefi düzenleyebilir. Kendi bilgilerin için
          Profilim sayfasını kullan.
        </p>
      )}
    </div>
  );
}
