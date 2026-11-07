"use client";

import Link from "next/link";
import { setMySection } from "@/app/(portal)/profil/section-actions";
import { useRunAction } from "@/components/use-run-action";
import type { VoicePart, VoiceSection } from "@/db/schema";
import { VOICE_PART_LABELS, partLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";

const segment =
  "flex min-h-11 flex-1 items-center justify-center rounded-full px-4 text-sm font-medium transition-colors hover:bg-muted aria-pressed:bg-primary aria-pressed:text-primary-foreground disabled:opacity-60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/** Profil: "Alt partisyonun" as 1 / 2 / Bilmiyorum; one tap saves. */
export function SectionPicker({ part, section }: { part: VoicePart; section: VoiceSection | null }) {
  const [pending, run] = useRunAction();
  const options: [VoiceSection | null, string][] = [
    [1, partLabel(part, 1)],
    [2, partLabel(part, 2)],
    [null, "Bilmiyorum"],
  ];
  return (
    <div className="space-y-2" data-testid="section-picker">
      <p id="alt-partisyon" className="text-sm font-medium">
        Alt partisyonun
      </p>
      <div
        role="group"
        aria-labelledby="alt-partisyon"
        className="flex max-w-sm gap-1 rounded-full border bg-card p-1"
      >
        {options.map(([value, label]) => (
          <button
            key={label}
            type="button"
            aria-pressed={section === value}
            disabled={pending}
            className={segment}
            onClick={() => section !== value && run(() => setMySection(value))}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Doğru ses kaydı ve {VOICE_PART_LABELS[part]} 1 / {VOICE_PART_LABELS[part]} 2 ödevleri için.
        Emin değilsen şefe sor.
      </p>
    </div>
  );
}

/** Home: a one-tap prompt while the singer hasn't picked a sub-part. */
export function SectionPrompt({ part }: { part: VoicePart }) {
  const [pending, run] = useRunAction();
  return (
    <section
      aria-labelledby="alt-partisyon-sor"
      className="space-y-3 rounded-2xl border bg-card p-4"
      data-testid="section-prompt"
    >
      <h2 id="alt-partisyon-sor" className="font-sans text-base font-medium">
        Alt partisyonunu seç: {partLabel(part, 1)} mi {partLabel(part, 2)} mi?
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        {([1, 2] as const).map((value) => (
          <button
            key={value}
            type="button"
            disabled={pending}
            className={cn(segment, "flex-none border bg-background px-5")}
            onClick={() => run(() => setMySection(value))}
          >
            {partLabel(part, value)}
          </button>
        ))}
        <Link
          href="/profil"
          className="inline-flex min-h-11 items-center px-2 text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          Emin değilim, Profil&apos;e git
        </Link>
      </div>
    </section>
  );
}
