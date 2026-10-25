"use client";

import {
  ArrowUpRight,
  AudioLines,
  Eye,
  EyeOff,
  FileMusic,
  FileText,
  FolderOpen,
  Headphones,
  Loader2,
  MonitorPlay,
} from "lucide-react";
import { createContext, useContext, useId, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import type { LinkKind, VoicePart } from "@/db/schema";
import { VOICE_PART_LABELS, VOICE_PART_STYLES } from "@/lib/labels";
import { cn } from "@/lib/utils";

const ICONS = {
  score: FileMusic,
  part: AudioLines,
  recording: Headphones,
  video: MonitorPlay,
  other: FileText,
  folder: FolderOpen,
};

type Previews = { open: string[]; toggle: (id: string, media: boolean) => void };

const OpenPreview = createContext<Previews>({ open: [], toggle: () => {} });

/** Scores stay open next to a video, but only one player at a time: two would play over each other. */
export function PreviewGroup({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<{ id: string; media: boolean }[]>([]);
  const toggle = (id: string, media: boolean) =>
    setOpen((prev) =>
      prev.some((p) => p.id === id)
        ? prev.filter((p) => p.id !== id)
        : [...prev.filter((p) => !(media && p.media)), { id, media }],
    );
  return (
    <OpenPreview.Provider value={{ open: open.map((p) => p.id), toggle }}>
      {children}
    </OpenPreview.Provider>
  );
}

export type LinkRowData = {
  id: string;
  kind: LinkKind | "folder";
  label: string;
  voicePart: VoicePart | null;
  host: string;
  url: string | null;
  previewSrc: string | null;
  provider: string;
};

export function LinkRow({ link }: { link: LinkRowData }) {
  const previews = useContext(OpenPreview);
  const [loaded, setLoaded] = useState(false);
  const panelId = useId();
  const open = previews.open.includes(link.id);
  const Icon = ICONS[link.kind];
  const media = link.provider === "youtube" || link.kind === "part" || link.kind === "recording";
  const frame =
    link.kind === "folder" ? "h-96" : media ? "aspect-video" : "aspect-[3/4] max-h-[75dvh]";
  const isDrive = link.provider === "drive-file" || link.provider === "drive-folder";

  return (
    <li data-testid="link-row">
      <div className="flex min-h-14 items-center gap-3 py-2 pr-2 pl-4">
        <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-medium break-words" data-testid="link-label">
            {link.label}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {link.kind !== "folder" && (
              <>
                {link.voicePart ? (
                  <span
                    className={cn("size-2 rounded-full", VOICE_PART_STYLES[link.voicePart].dot)}
                  />
                ) : (
                  <span className="size-2 rounded-full ring-1 ring-foreground/40" />
                )}
                {link.voicePart ? VOICE_PART_LABELS[link.voicePart] : "Tutti"} ·{" "}
              </>
            )}
            <span className="truncate">{link.host}</span>
          </p>
        </div>
        {link.previewSrc && (
          <Button
            variant="ghost"
            className="h-11 shrink-0 px-3"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => {
              setLoaded(false);
              previews.toggle(link.id, media);
            }}
          >
            {open ? <EyeOff /> : <Eye />}
            {open ? "Kapat" : "Önizle"}
            <span className="sr-only">: {link.label}</span>
          </Button>
        )}
        {link.url && (
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-11 shrink-0 rounded-full px-4",
            )}
          >
            Aç
            <span className="sr-only">: {link.label}, yeni sekmede açılır</span>
            <ArrowUpRight className="size-3.5" aria-hidden />
          </a>
        )}
      </div>
      {open && link.previewSrc && (
        <div
          id={panelId}
          role="region"
          aria-label={`${link.label} önizlemesi`}
          className="space-y-2 px-2 pb-3"
        >
          <div
            className={cn(
              "relative mx-auto w-full max-w-2xl overflow-hidden rounded-xl bg-muted ring-1 ring-border",
              frame,
            )}
          >
            {!loaded && (
              <Loader2 className="absolute top-1/2 left-1/2 size-6 -translate-1/2 text-muted-foreground motion-safe:animate-spin" />
            )}
            <iframe
              src={link.previewSrc}
              title={`${link.label} önizlemesi`}
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allow={
                link.provider === "youtube"
                  ? "autoplay; encrypted-media; picture-in-picture; fullscreen"
                  : "autoplay; fullscreen"
              }
              allowFullScreen
              onLoad={() => setLoaded(true)}
              className="absolute inset-0 size-full"
            />
          </div>
          {isDrive && link.url && (
            <p className="mx-auto max-w-2xl text-xs text-muted-foreground">
              Önizleme açılmıyorsa dosya Drive&apos;da paylaşıma açık olmayabilir.{" "}
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline"
              >
                Drive&apos;da aç
              </a>
            </p>
          )}
        </div>
      )}
    </li>
  );
}
