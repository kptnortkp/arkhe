import { notFound } from "next/navigation";
import { z } from "zod";
import { PdfViewer } from "@/components/midi/pdf-viewer";
import { db } from "@/db";
import { requireUser } from "@/lib/auth/dal";
import { sql } from "drizzle-orm";

export const metadata = { title: "Nota" };

/** The score inside the portal: the home-screen iPhone app's "Aç" lands here (D94). */
export default async function ScorePage({ params }: PageProps<"/repertuvar/[id]/nota">) {
  await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [row] = await db.all<{ score: string; title: string }>(sql`
    select s.id as score, p.title from piece_scores s join pieces p on p.id = s.piece_id
    where p.id = ${id}`);
  if (!row) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <PdfViewer
        src={`/api/dosya/nota/${row.score}`}
        title={`${row.title} · Nota`}
        backHref={`/repertuvar/${id}`}
      />
    </div>
  );
}
