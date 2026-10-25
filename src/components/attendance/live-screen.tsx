"use client";

import { ArrowLeft, QrCode } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { closeAttendance } from "@/app/(portal)/calismalar/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LiveSnapshot } from "@/lib/attendance/live";
import { cn } from "@/lib/utils";
import { MarkingRoster, useLiveSnapshot } from "./marking-roster";

function CodePanel({
  code,
  codeOnly,
  qrBase,
  rehearsalId,
  lateFrom,
}: {
  code: string | null;
  codeOnly: boolean;
  qrBase: string;
  rehearsalId: string;
  lateFrom: string;
}) {
  const qrUrl = code ? `${qrBase}${rehearsalId}?c=${code}` : "";

  return (
    <div className="on-stage flex min-w-0 flex-col items-center justify-center gap-6 overflow-hidden bg-stage p-6 text-stage-foreground lg:p-8">
      <p className="text-xs tracking-[0.2em] text-stage-foreground/70 uppercase">Yoklama kodu</p>
      <p
        data-testid="live-code"
        aria-live="off"
        className={cn(
          "font-heading leading-none font-medium tracking-[0.08em] tabular-nums",
          codeOnly ? "text-[min(20vw,20vh)]" : "text-[clamp(96px,9.5vw,140px)]",
        )}
      >
        {code ?? "––––"}
      </p>
      {qrUrl ? (
        <div className="rounded-2xl bg-white p-3" aria-label="Yoklama QR kodu" role="img">
          <QRCodeSVG
            value={qrUrl}
            size={codeOnly ? 360 : 200}
            className={cn("h-auto w-auto", codeOnly ? "max-h-[42vh] max-w-[70vw]" : "max-h-[36vh]")}
          />
        </div>
      ) : (
        <p className="text-sm text-stage-foreground/70">Bağlantı yok, kod alınamadı.</p>
      )}
      <div className="space-y-1 text-center text-sm text-stage-foreground/70">
        <p>Telefonunla QR&apos;ı okut ya da Arkhe&apos;de Geldim&apos;e bas, kodu gir.</p>
        <p>{lateFrom}&apos;ten sonra geç sayılır.</p>
      </div>
    </div>
  );
}

export function LiveScreen({
  rehearsalId,
  title,
  lateFrom,
  initial,
  codeOnly,
  qrBase,
}: {
  rehearsalId: string;
  title: string;
  lateFrom: string;
  initial: LiveSnapshot;
  codeOnly: boolean;
  qrBase: string;
}) {
  const router = useRouter();
  const { snapshot, setSnapshot, online, setOnline } = useLiveSnapshot(rehearsalId, initial, true);
  const [closeOpen, setCloseOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (snapshot.closedAt) router.replace(`/calismalar/${rehearsalId}`);
  }, [snapshot.closedAt, rehearsalId, router]);

  // Keep the tablet awake; silently skipped where unsupported.
  useEffect(() => {
    type Lock = { release: () => Promise<void> };
    let lock: Lock | null = null;
    const request = async () => {
      try {
        const wakeLock = (
          navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Lock> } }
        ).wakeLock;
        lock = (await wakeLock?.request("screen")) ?? null;
      } catch {
        lock = null;
      }
    };
    void request();
    const again = () => document.visibilityState === "visible" && void request();
    document.addEventListener("visibilitychange", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      void lock?.release();
    };
  }, []);

  const unmarked = snapshot.rows.filter((r) => r.onRoster && r.status === null).length;
  const codePanel = (
    <CodePanel
      code={snapshot.code}
      codeOnly={codeOnly}
      qrBase={qrBase}
      rehearsalId={rehearsalId}
      lateFrom={lateFrom}
    />
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Link
          href={`/calismalar/${rehearsalId}`}
          aria-label="Çalışmaya dön"
          className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-11 rounded-full")}
        >
          <ArrowLeft />
        </Link>
        <p className="min-w-0 flex-1 truncate font-medium">{title}</p>
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
          <span className={cn("size-2 rounded-full", online ? "bg-present" : "bg-destructive")} />
          {online ? "Canlı" : "Bağlantı yok"}
        </span>
        <Link
          href={
            codeOnly
              ? `/calismalar/${rehearsalId}/canli`
              : `/calismalar/${rehearsalId}/canli?gorunum=kod`
          }
          aria-label={codeOnly ? "Liste ve kod görünümü" : "Sadece kod görünümü"}
          className={cn(buttonVariants({ variant: "outline" }), "h-10 rounded-full px-4")}
        >
          {codeOnly ? (
            "Liste + kod"
          ) : (
            <>
              <QrCode />
              <span className="hidden sm:inline">Sadece kod</span>
            </>
          )}
        </Link>
        {!codeOnly && (
          <Button
            variant="outline"
            onClick={() => setCloseOpen(true)}
            className="hidden h-10 rounded-full px-4 md:inline-flex"
          >
            Yoklamayı kapat
          </Button>
        )}
      </header>

      {codeOnly ? (
        <main className="grid flex-1 overflow-hidden">{codePanel}</main>
      ) : (
        <main className="grid flex-1 lg:grid-cols-[minmax(0,38%)_minmax(0,1fr)]">
          <div className="min-w-0 lg:sticky lg:top-0 lg:h-[calc(100dvh-3.5rem)]">
            <div className="grid h-full">{codePanel}</div>
          </div>
          <div className="min-w-0 space-y-4 p-4 md:p-6 lg:h-[calc(100dvh-3.5rem)] lg:overflow-y-auto">
            <MarkingRoster
              rehearsalId={rehearsalId}
              snapshot={snapshot}
              onSnapshot={setSnapshot}
              online={online}
              onOnline={setOnline}
              canClear
            />
            <Button
              variant="outline"
              onClick={() => setCloseOpen(true)}
              className="h-11 w-full rounded-full md:hidden"
            >
              Yoklamayı kapat
            </Button>
          </div>
        </main>
      )}

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Yoklama kapatılsın mı?</DialogTitle>
            <DialogDescription data-testid="close-summary">
              {unmarked > 0
                ? `${unmarked} kişi işaretlenmedi. Gelmedi olarak kaydedilecek.`
                : "Herkes işaretlendi."}{" "}
              Kapattıktan sonra da düzeltme yapabilirsin.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCloseOpen(false)}
              className="h-11 rounded-xl"
            >
              Vazgeç
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await closeAttendance(rehearsalId);
                  if (result.error) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success(result.success);
                  router.replace(`/calismalar/${rehearsalId}`);
                })
              }
              className="h-11 rounded-xl"
            >
              Kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
