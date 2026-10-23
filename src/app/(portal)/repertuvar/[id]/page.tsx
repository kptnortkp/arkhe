import { ListOrdered } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { FilterChip } from "@/components/filter-chip";
import { MidiButton } from "@/components/midi/midi-button";
import { MidiList } from "@/components/midi/midi-list";
import { BackLink } from "@/components/repertoire/back-link";
import { LinkRow, PreviewGroup, type LinkRowData } from "@/components/repertoire/link-row";
import { PartButton } from "@/components/repertoire/part-button";
import { MetaChips, PieceStatusChip } from "@/components/repertoire/piece-meta";
import { PieceMenu } from "@/components/repertoire/piece-menu";
import { buttonVariants } from "@/components/ui/button";
import { LINK_KINDS, type VoicePart } from "@/db/schema";
import { requireUser } from "@/lib/auth/dal";
import { LINK_KIND_GROUPS, VOICE_PART_LABELS } from "@/lib/labels";
import { hostLabel, parseLink, resolveMyPart } from "@/lib/links";
import { isManager } from "@/lib/permissions";
import { DeadlineChip, DueLine } from "@/components/homework/deadline-chip";
import { managerBadge } from "@/lib/homework/deadline";
import { barsLabel } from "@/lib/homework/mail";
import { openHomeworkForPiece } from "@/lib/homework/queries";
import { getPiece, programRank } from "@/lib/repertoire";
import { midiForExactPart, midiForPiece } from "@/lib/repertoire-midi";
import { now } from "@/lib/time";
import { cn } from "@/lib/utils";

// Turkish URL value for the bass part, as elsewhere in the UI.
const PART_PARAM: Record<string, VoicePart> = {
  soprano: "soprano",
  alto: "alto",
  tenor: "tenor",
  bas: "bass",
};
const paramOf = (part: VoicePart) => (part === "bass" ? "bas" : part);

async function load(id: string) {
  // generateMetadata runs too; never leak a title without a session.
  await requireUser();
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await getPiece(id);
  if (!data) notFound();
  return data;
}

export async function generateMetadata({ params }: PageProps<"/repertuvar/[id]">) {
  const { piece } = await load((await params).id);
  return { title: piece.title };
}

export default async function PiecePage({ params, searchParams }: PageProps<"/repertuvar/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const { piece, links } = await load(id);
  const sp = await searchParams;
  const manager = isManager(user.role);
  const rank = piece.programPosition !== null ? await programRank(piece.id) : null;
  const at = now();
  const homework = await openHomeworkForPiece(piece.id, at);

  const mine = user.voicePart;
  const raw = typeof sp.partisyon === "string" ? sp.partisyon : undefined;
  // Default is my part; without a part (or with ?partisyon=tumu) everything shows.
  const filter: VoicePart | null =
    raw === "tumu" ? null : raw && Object.hasOwn(PART_PARAM, raw) ? PART_PARAM[raw] : mine;
  const visible = links.filter((l) => !filter || l.voicePart === null || l.voicePart === filter);
  const myPart = resolveMyPart(
    links.filter((l) => l.kind === "part"),
    mine,
  );

  const rowOf = (l: (typeof links)[number]): LinkRowData => {
    const parsed = parseLink(l.url);
    return {
      id: l.id,
      kind: l.kind,
      // The kind is already the section heading, so an unlabelled link is named by its part.
      label: l.label ?? (l.voicePart ? VOICE_PART_LABELS[l.voicePart] : "Tutti"),
      voicePart: l.voicePart,
      host: parsed ? hostLabel(parsed) : "",
      url: parsed?.url ?? null,
      previewSrc: parsed?.previewSrc ?? null,
      provider: parsed?.provider ?? "external",
    };
  };
  const folder = piece.driveFolderUrl ? parseLink(piece.driveFolderUrl) : null;
  const folderLabel = folder?.provider === "drive-folder" ? "Drive klasörü" : "Drive dosyası";
  const hiddenParts =
    links.some((l) => l.kind === "part") && !visible.some((l) => l.kind === "part");

  const [heroMidi, midiRows] = await Promise.all([
    mine ? midiForExactPart(piece.id, mine) : null,
    midiForPiece(piece.id, filter ?? "all"),
  ]);

  const chipHref = (value: string | null) =>
    value === null ? `/repertuvar/${piece.id}` : `/repertuvar/${piece.id}?partisyon=${value}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink />
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap gap-1.5 pt-1">
            <PieceStatusChip status={piece.status} />
            {rank !== null && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gold/20 px-2.5 py-0.5 text-xs font-medium text-foreground">
                <ListOrdered className="size-3" aria-hidden />
                Programda {rank}. sıra
              </span>
            )}
          </div>
          {manager && (
            <PieceMenu
              id={piece.id}
              title={piece.title}
              status={piece.status}
              inProgram={rank !== null}
            />
          )}
        </div>
        <h1 className="text-3xl leading-tight font-medium">{piece.title}</h1>
        {(piece.composer || piece.arranger) && (
          <div className="text-muted-foreground">
            {piece.composer && <p>{piece.composer}</p>}
            {piece.arranger && <p className="text-sm">Düzenleyen: {piece.arranger}</p>}
          </div>
        )}
        <MetaChips {...piece} />
      </header>

      {heroMidi && mine ? (
        <div className="space-y-2" data-testid="midi-hero">
          <MidiButton
            midiId={heroMidi.id}
            title={`Partisyonumu çal (${VOICE_PART_LABELS[mine]})`}
            myPart={mine}
            variant="hero"
            ready={sp.cal === "1"}
          />
          {myPart && myPart.links.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Drive&apos;daki partisyon kaydı aşağıda, “Partisyon kayıtları” bölümünde.
            </p>
          )}
        </div>
      ) : (
        <PartButton myPart={myPart} voicePart={mine} pieceId={piece.id} title={piece.title} hero />
      )}

      {homework.length > 0 && (
        <section aria-labelledby="odevler" className="space-y-2" data-testid="piece-homework">
          <h2
            id="odevler"
            className="font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase"
          >
            Ödevler
          </h2>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {homework.map((h) => (
              <li key={h.id}>
                <Link
                  href={`/odevler/${h.id}`}
                  className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 hover:bg-muted/60"
                >
                  <span className="font-medium">{barsLabel(h.barFrom, h.barTo)}</span>
                  <DeadlineChip badge={managerBadge(h.dueAt, at)} />
                  <DueLine dueAt={h.dueAt} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {piece.notes && (
        <section className="rounded-2xl bg-accent/60 p-4">
          <h2 className="font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
            Notlar
          </h2>
          <p className="mt-1 text-sm whitespace-pre-line">{piece.notes}</p>
        </section>
      )}

      {(mine || filter) && links.length > 0 && (
        <nav
          aria-label="Partisyon filtresi"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
        >
          {mine && (
            <FilterChip
              href={chipHref(null)}
              active={filter === mine}
              label={`Benim partisyonum (${VOICE_PART_LABELS[mine]})`}
            />
          )}
          <FilterChip href={chipHref(mine ? "tumu" : null)} active={filter === null} label="Tümü" />
          {filter && filter !== mine && (
            <FilterChip href={chipHref(paramOf(filter))} active label={VOICE_PART_LABELS[filter]} />
          )}
        </nav>
      )}

      <MidiList rows={midiRows} myPart={mine} />

      {links.length === 0 && !folder ? (
        <div className="staff-lines space-y-3 rounded-2xl border border-dashed bg-card px-6 pt-10 pb-12 text-center">
          <p className="text-sm text-muted-foreground">Bu esere henüz bağlantı eklenmedi.</p>
          {manager && (
            <Link
              href={`/repertuvar/${piece.id}/duzenle#baglantilar`}
              className={cn(buttonVariants(), "h-11 rounded-full px-5")}
            >
              Bağlantı ekle
            </Link>
          )}
        </div>
      ) : (
        <PreviewGroup>
          <div className="space-y-6">
            {visible.length === 0 && !folder && (
              <p className="text-sm text-muted-foreground">
                Bu partisyon için bağlantı yok.{" "}
                <Link href={chipHref("tumu")} className="font-medium text-primary underline">
                  Tümünü göster
                </Link>
              </p>
            )}
            {LINK_KINDS.map((kind) => {
              const group = visible.filter((l) => l.kind === kind);
              const showEmptyParts = kind === "part" && hiddenParts && filter;
              if (group.length === 0 && !showEmptyParts) return null;
              return (
                <section key={kind} aria-labelledby={`group-${kind}`} className="space-y-2">
                  <h2
                    id={`group-${kind}`}
                    className="font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase"
                  >
                    {LINK_KIND_GROUPS[kind]}
                  </h2>
                  {group.length > 0 ? (
                    <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
                      {group.map((l) => (
                        <LinkRow key={l.id} link={rowOf(l)} />
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-2xl border bg-card px-4 py-3 text-sm text-muted-foreground">
                      {VOICE_PART_LABELS[filter!]} için kayıt yok.{" "}
                      <Link href={chipHref("tumu")} className="font-medium text-primary underline">
                        Tüm partisyonları göster
                      </Link>
                    </p>
                  )}
                </section>
              );
            })}
            {folder && (
              <section aria-labelledby="group-folder" className="space-y-2">
                <h2
                  id="group-folder"
                  className="font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase"
                >
                  {folderLabel}
                </h2>
                <ul className="overflow-hidden rounded-2xl border bg-card">
                  <LinkRow
                    link={{
                      id: "folder",
                      kind: folder.provider === "drive-folder" ? "folder" : "other",
                      label: folderLabel,
                      voicePart: null,
                      host: hostLabel(folder),
                      url: folder.url,
                      previewSrc: folder.previewSrc,
                      provider: folder.provider,
                    }}
                  />
                </ul>
              </section>
            )}
          </div>
        </PreviewGroup>
      )}
    </div>
  );
}
