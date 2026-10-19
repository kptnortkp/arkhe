import { ArrowUpRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { VoicePart } from "@/db/schema";
import { VOICE_PART_LABELS } from "@/lib/labels";
import type { MyPart } from "@/lib/repertoire";
import { cn } from "@/lib/utils";
import { PartChooser } from "./part-chooser";
import { PartDot } from "@/components/part-dot";

/** "Partisyonum": 0 files → disabled, 1 → direct link, more → chooser. Hidden without a voice part. */
export function PartButton({
  myPart,
  voicePart,
  pieceId,
  title,
  hero = false,
}: {
  myPart: MyPart;
  voicePart: VoicePart | null;
  pieceId: string;
  title: string;
  hero?: boolean;
}) {
  if (!myPart || !voicePart) return null;
  const partName = VOICE_PART_LABELS[voicePart];
  const text = hero ? `Partisyonumu aç (${partName})` : "Partisyonum";
  const base = hero
    ? "h-12 w-full rounded-2xl px-5 text-base md:w-auto"
    : "h-11 w-[116px] shrink-0 justify-center rounded-full px-3 text-sm";
  const variant = hero ? "default" : "outline";

  if (myPart.links.length === 0) {
    return (
      <button
        type="button"
        disabled
        className={cn(
          buttonVariants({ variant: "outline" }),
          base,
          "border-dashed bg-transparent whitespace-normal text-muted-foreground disabled:opacity-100",
          !hero && "text-xs leading-tight",
        )}
      >
        {hero ? `${partName} için partisyon kaydı yok` : "Partisyon kaydı yok"}
      </button>
    );
  }
  const dot = <PartDot part={myPart.tutti ? null : voicePart} />;
  if (myPart.links.length === 1) {
    return (
      <a
        href={myPart.links[0].url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(buttonVariants({ variant }), base, "gap-2")}
      >
        {!hero && dot}
        {text}
        <span className="sr-only">
          {" "}
          ({myPart.tutti ? "Tutti" : partName}): {title}, yeni sekmede açılır
        </span>
        <ArrowUpRight className="size-3.5" aria-hidden />
      </a>
    );
  }
  return (
    <PartChooser
      pieceId={pieceId}
      title={title}
      description={`${myPart.tutti ? "Tutti" : partName} partisyon kayıtları`}
      links={myPart.links.map((l) => ({ id: l.id, url: l.url, label: l.label ?? partName }))}
      className={cn(buttonVariants({ variant }), base, "gap-2")}
      dot={hero ? null : dot}
      text={text}
    />
  );
}
