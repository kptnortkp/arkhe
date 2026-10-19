import { desc, isNotNull } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { RehearsalForm } from "@/components/attendance/rehearsal-form";
import { db } from "@/db";
import { rehearsals } from "@/db/schema";
import { requireManager } from "@/lib/auth/dal";
import { istanbulDateOf } from "@/lib/time";
import { createRehearsal } from "../actions";

export const metadata = { title: "Yeni çalışma" };

export default async function NewRehearsalPage() {
  await requireManager();
  const [last] = await db
    .select({ location: rehearsals.location })
    .from(rehearsals)
    .where(isNotNull(rehearsals.location))
    .orderBy(desc(rehearsals.createdAt))
    .limit(1);

  return (
    <div className="max-w-2xl space-y-8">
      <div className="space-y-2">
        <Link
          href="/calismalar"
          className="-my-2 inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Çalışmalar
        </Link>
        <h1 className="text-4xl font-medium">Yeni çalışma</h1>
      </div>
      <RehearsalForm
        action={createRehearsal}
        allowRepeat
        submitLabel="Çalışmayı ekle"
        defaults={{
          type: "tutti",
          date: istanbulDateOf(new Date()),
          start: "19:00",
          end: "21:30",
          title: "",
          location: last?.location ?? "",
          note: "",
          parts: [],
        }}
      />
    </div>
  );
}
