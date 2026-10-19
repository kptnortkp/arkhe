import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { requireManager } from "@/lib/auth/dal";
import { istanbulDateOf } from "@/lib/time";
import { createMember } from "../actions";
import { MemberForm } from "../member-form";

export const metadata = { title: "Yeni üye" };

export default async function NewMemberPage() {
  const actor = await requireManager();
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
        <h1 className="text-4xl font-medium">Yeni üye</h1>
        <p className="text-sm text-muted-foreground">
          Kaydettikten sonra bir davet linki oluşur; WhatsApp ile gönderirsin, kişi kendi şifresini
          belirler.
        </p>
      </div>
      <MemberForm
        action={createMember}
        actorRole={actor.role}
        defaultJoinedOn={istanbulDateOf(new Date())}
      />
    </div>
  );
}
