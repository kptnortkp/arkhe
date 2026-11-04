import { notFound } from "next/navigation";
import { z } from "zod";
import { updatePiece } from "@/app/(portal)/repertuvar/actions";
import { AudioEditor } from "@/components/audio/audio-editor";
import { BackLink } from "@/components/repertoire/back-link";
import { DangerZone } from "@/components/repertoire/danger-zone";
import { MidiEditor } from "@/components/midi/midi-editor";
import { LinksEditor } from "@/components/repertoire/links-editor";
import { PieceForm } from "@/components/repertoire/piece-form";
import { requireManager } from "@/lib/auth/dal";
import { formatDuration } from "@/lib/format";
import { getPiece } from "@/lib/repertoire";
import { autoTitle } from "@/components/midi/midi-list";
import { AutoGroup } from "@/components/midi/auto-group";
import { ScoreEditor } from "@/components/midi/score-editor";
import { omrConfigured, runUrl } from "@/lib/omr/config";
import { latestJob } from "@/lib/omr/jobs";
import { audioForPiece } from "@/lib/repertoire-audio";
import { midiForEditor, scoreForPiece } from "@/lib/repertoire-midi";

export const metadata = { title: "Eseri düzenle" };

const SECTIONS = [
  ["#bilgiler", "Bilgiler"],
  ["#baglantilar", "Bağlantılar"],
  ["#nota-ve-midi", "Nota ve MIDI"],
  ["#midi-dosyalari", "MIDI dosyaları"],
  ["#ses-kayitlari", "Ses kayıtları"],
] as const;

export default async function EditPiecePage({ params }: PageProps<"/repertuvar/[id]/duzenle">) {
  await requireManager();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await getPiece(id);
  if (!data) notFound();
  const { piece, links } = data;
  const [midi, score, job, audio] = await Promise.all([
    midiForEditor(piece.id),
    scoreForPiece(piece.id),
    latestJob(piece.id),
    audioForPiece(piece.id, "all"),
  ]);
  const active = job?.state === "queued" || job?.state === "running";

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-2">
        <BackLink />
        <h1 className="text-4xl font-medium">Eseri düzenle</h1>
        <p className="text-muted-foreground">{piece.title}</p>
      </div>
      <nav
        aria-label="Bölümler"
        className="-mx-4 -mt-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
      >
        {SECTIONS.map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="flex min-h-11 shrink-0 items-center rounded-full border bg-card px-4 text-sm transition-colors outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {label}
          </a>
        ))}
      </nav>
      <div id="bilgiler" className="scroll-mt-20 md:scroll-mt-6">
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
      </div>
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
      <ScoreEditor
        pieceId={piece.id}
        score={score}
        configured={omrConfigured()}
        active={active}
        defaults={{
          layout: job?.layout ?? null,
          piano: job?.piano ?? true,
          tempo: job?.tempo ?? null,
        }}
      >
        <AutoGroup
          pieceId={piece.id}
          scoreId={score?.id ?? null}
          job={
            job && {
              id: job.id,
              state: job.state,
              errorKind: job.errorKind,
              expected: job.expected,
              found: job.found,
              creatorName: job.creatorName,
              createdAt: job.createdAt,
              startedAt: job.startedAt,
              runUrl: job.runId ? runUrl(job.runId) : null,
            }
          }
          draft={
            midi.draft && {
              id: midi.draft.id,
              tracks: midi.draft.tracks.map((t) => ({ name: t.name })),
              measures: midi.draft.measures,
              durationSec: midi.draft.durationSec,
            }
          }
          auto={
            midi.published && {
              id: midi.published.id,
              title: autoTitle(midi.published),
              sizeBytes: midi.published.sizeBytes,
              publisherName: midi.published.publisherName,
              publishedAt: midi.published.publishedAt,
            }
          }
        />
      </ScoreEditor>
      <MidiEditor
        pieceId={piece.id}
        files={midi.manual.map((m) => ({
          id: m.id,
          title: m.title,
          label: m.label,
          voicePart: m.voicePart,
          sizeBytes: m.sizeBytes,
        }))}
      />
      <AudioEditor pieceId={piece.id} pieceTitle={piece.title} files={audio} />
      <DangerZone
        id={piece.id}
        title={piece.title}
        status={piece.status}
        inProgram={piece.programPosition !== null}
      />
    </div>
  );
}
