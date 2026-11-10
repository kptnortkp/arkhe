"use client";

import { ArrowLeft, Download, Minus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DownloadLink } from "@/components/download-link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Doc = {
  numPages: number;
  getPage: (n: number) => Promise<Page>;
  loadingTask: { destroy: () => Promise<void> };
};
type Page = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: {
    canvas: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
};

const ZOOMS = [1, 1.5, 2, 3];

async function openPdf(src: string, signal: AbortSignal): Promise<Doc> {
  const res = await fetch(src, { signal });
  if (!res.ok) throw new Error(`score ${res.status}`);
  const data = new Uint8Array(await res.arrayBuffer());
  // The legacy build also runs on the older iPhones the choir still uses.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerPort) {
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(
      new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url),
      { type: "module" },
    );
  }
  return (await pdfjs.getDocument({ data }).promise) as unknown as Doc;
}

/**
 * The score PDF drawn inside the portal, so a home-screen iPhone app never leaves the user on a
 * bare file with no way back.
 */
export function PdfViewer({
  src,
  title,
  backHref,
}: {
  src: string;
  title: string;
  backHref: string;
}) {
  const router = useRouter();
  const pagesRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    let loaded: Doc | null = null;
    openPdf(src, ctrl.signal)
      .then((d) => {
        loaded = d;
        setDoc(d);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setFailed(true);
      });
    return () => {
      ctrl.abort();
      void loaded?.loadingTask.destroy();
    };
  }, [src]);

  useEffect(() => {
    const box = pagesRef.current;
    if (!doc || !box) return;
    let cancelled = false;
    const draw = async () => {
      const width = box.clientWidth * ZOOMS[zoom];
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const canvases = Array.from(box.querySelectorAll("canvas"));
      for (let n = 1; n <= doc.numPages && !cancelled; n++) {
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (width / base.width) * ratio });
        const canvas = canvases[n - 1];
        if (!canvas || cancelled) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${width}px`;
        const ctx = canvas.getContext("2d");
        if (ctx) await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      }
    };
    void draw().catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [doc, zoom]);

  const back = () => {
    if (window.history.length > 1) router.back();
    else router.push(backHref);
  };

  return (
    <div className="space-y-3" data-testid="pdf-viewer">
      <div className="sticky top-14 z-20 -mx-4 flex items-center gap-2 border-b bg-background/90 px-4 py-2 backdrop-blur md:top-0 md:mx-0 md:rounded-2xl md:border">
        <Button variant="ghost" className="h-11 rounded-full px-3" onClick={back}>
          <ArrowLeft />
          Geri
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{title}</p>
        <Button
          variant="ghost"
          className="size-11 rounded-full"
          aria-label="Uzaklaştır"
          disabled={zoom === 0}
          onClick={() => setZoom((z) => Math.max(0, z - 1))}
        >
          <Minus />
        </Button>
        <Button
          variant="ghost"
          className="size-11 rounded-full"
          aria-label="Yakınlaştır"
          disabled={zoom === ZOOMS.length - 1}
          onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
        >
          <Plus />
        </Button>
        <DownloadLink
          href={`${src}?indir=1`}
          aria-label="İndir: Nota (PDF)"
          className={cn(buttonVariants({ variant: "ghost" }), "size-11 rounded-full")}
        >
          <Download />
        </DownloadLink>
      </div>
      {failed ? (
        <p
          className="rounded-2xl border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground"
          role="alert"
        >
          Nota açılamadı. Biraz sonra tekrar dene ya da İndir&apos;e dokun.
        </p>
      ) : !doc ? (
        <p className="py-10 text-center text-sm text-muted-foreground" aria-busy="true">
          Nota yükleniyor…
        </p>
      ) : null}
      <div ref={pagesRef} className="-mx-4 overflow-x-auto md:mx-0">
        <div className="w-max min-w-full space-y-3">
          {doc &&
            Array.from({ length: doc.numPages }, (_, i) => (
              <canvas
                key={i}
                className="block bg-white shadow-sm"
                aria-label={`Sayfa ${i + 1} / ${doc.numPages}`}
                data-testid="pdf-page"
              />
            ))}
        </div>
      </div>
    </div>
  );
}
