import { ChevronRight, Play } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { VoicePart } from "@/db/schema";
import type { MyPart, PieceSummary } from "@/lib/repertoire";
import { PartButton } from "./part-button";
import { composerLine, MetaChips, PieceStatusChip } from "./piece-meta";

export function PieceRow({
  piece,
  myPart,
  voicePart,
  showStatus = false,
  showMeta = true,
  number,
  midiHref,
}: {
  piece: PieceSummary;
  myPart: MyPart;
  voicePart: VoicePart | null;
  showStatus?: boolean;
  showMeta?: boolean;
  number?: number;
  /** D59: a portal MIDI for my part plays on the piece page (`?cal=1`) instead of Drive. */
  midiHref?: string;
}) {
  const by = composerLine(piece.composer, piece.arranger);
  return (
    <li className="flex min-h-[76px] items-center gap-3 pr-3" data-testid="piece-row">
      <Link
        href={`/repertuvar/${piece.id}`}
        className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-3 pl-4 transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset"
      >
        {number !== undefined && (
          <span
            aria-hidden
            className="w-7 shrink-0 font-heading text-2xl text-muted-foreground tabular-nums"
            data-testid="program-number"
          >
            {number}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 leading-snug font-medium" data-testid="piece-title">
            {piece.title}
          </span>
          {by && <span className="block truncate text-sm text-muted-foreground">{by}</span>}
          {(showStatus || showMeta) && (
            <span className="mt-1.5 flex flex-wrap gap-1">
              {showStatus && <PieceStatusChip status={piece.status} />}
              {showMeta && <MetaChips {...piece} />}
            </span>
          )}
        </span>
        {!myPart && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
      </Link>
      {midiHref ? (
        <Link
          href={midiHref}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-11 w-[116px] shrink-0 justify-center gap-1.5 rounded-full px-3 text-sm",
          )}
          data-testid="midi-part-link"
        >
          <Play className="size-3.5" aria-hidden />
          Partisyonum
          <span className="sr-only">: {piece.title}, portalda çal</span>
        </Link>
      ) : (
        <PartButton myPart={myPart} voicePart={voicePart} pieceId={piece.id} title={piece.title} />
      )}
    </li>
  );
}
