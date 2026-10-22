import { notFound } from "next/navigation";
import { z } from "zod";
import { updatePiece } from "@/app/(portal)/repertuvar/actions";
import { BackLink } from "@/components/repertoire/back-link";
import { DangerZone } from "@/components/repertoire/danger-zone";
import { MidiEditor } from "@/components/midi/midi-editor";
import { LinksEditor } from "@/components/repertoire/links-editor";
import { PieceForm } from "@/components/repertoire/piece-form";
import { requireManager } from "@/lib/auth/dal";
import { formatDuration } from "@/lib/format";
import { getPiece } from "@/lib/repertoire";
import { midiForPiece } from "@/lib/repertoire-midi";

export const metadata = { title: "Eseri düzenle" };

export default async function EditPiecePage({ params }: PageProps<"/repertuvar/[id]/duzenle">) {
  await requireManager();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await getPiece(id);
  if (!data) notFound();
  const { piece, links } = data;
  const midi = await midiForPiece(piece.id, "all");

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-2">
        <BackLink />
        <h1 className="text-4xl font-medium">Eseri düzenle</h1>
        <p className="text-muted-foreground">{piece.title}</p>
      </div>
      <PieceForm
        action={updatePiece.bind(null, piece.id)}
        isNew={false}
        submitLabel="Değişiklikleri kaydet"
        defaults={{
          title: piece.title,
          composer: piece.composer ?? "",
          arranger: piece.arranger ?? "",
          language: piece.language ?? "",
          voicing: piece.voicing ?? "",
          duration: piece.durationSec ? formatDuration(piece.durationSec) : "",
          status: piece.status,
          driveFolderUrl: piece.driveFolderUrl ?? "",
          notes: piece.notes ?? "",
        }}
      />
      <LinksEditor
        pieceId={piece.id}
        folderFree={!piece.driveFolderUrl}
        links={links.map((l) => ({
          id: l.id,
          kind: l.kind,
          voicePart: l.voicePart,
          label: l.label,
          url: l.url,
        }))}
      />
      <MidiEditor
        pieceId={piece.id}
        files={midi.map((m) => ({
          id: m.id,
          title: m.title,
          label: m.label,
          voicePart: m.voicePart,
          sizeBytes: m.sizeBytes,
        }))}
      />
      <DangerZone
        id={piece.id}
        title={piece.title}
        status={piece.status}
        inProgram={piece.programPosition !== null}
      />
    </div>
  );
}
