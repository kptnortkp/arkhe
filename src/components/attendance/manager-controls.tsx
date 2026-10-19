"use client";

import { Ban, CalendarX2, Pencil, Radio, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  closeAttendance,
  endSeries,
  openAttendance,
  setCancelled,
} from "@/app/(portal)/calismalar/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RehearsalPhase } from "@/lib/attendance/rehearsals";
import type { FormState } from "@/lib/validation";
import { cn } from "@/lib/utils";

type Confirm = { title: string; text: string; label: string; run: () => Promise<FormState> };

export function ManagerControls({
  id,
  phase,
  inSeries,
  laterInSeries,
  unmarked,
  started,
}: {
  id: string;
  phase: RehearsalPhase;
  inSeries: boolean;
  laterInSeries: number;
  unmarked: number;
  started: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  function run(fn: () => Promise<FormState>) {
    startTransition(async () => {
      const result = await fn();
      if (result?.error) toast.error(result.error);
      else if (result?.success) toast.success(result.success);
      setConfirm(null);
      router.refresh();
    });
  }

  const pill = "h-11 rounded-full px-4";
  return (
    <div className="flex flex-wrap gap-2">
      {phase === "openable" && (
        <Button disabled={pending} onClick={() => run(() => openAttendance(id))} className={pill}>
          <Radio />
          Yoklamayı başlat
        </Button>
      )}
      {phase === "upcoming" && (
        <Button disabled className={pill} title="Yoklama çalışmadan 2 saat önce başlatılabilir.">
          <Radio />
          Yoklamayı başlat
        </Button>
      )}
      {phase === "open" && (
        <Link href={`/calismalar/${id}/canli`} className={cn(buttonVariants(), pill)}>
          <Radio />
          Canlı ekranı aç
        </Link>
      )}
      {(phase === "open" || phase === "untaken") && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            setConfirm({
              title: "Yoklama kapatılsın mı?",
              text: `${unmarked > 0 ? `${unmarked} kişi işaretlenmedi. Gelmedi olarak kaydedilecek.` : "Herkes işaretlendi."} Kapattıktan sonra da düzeltme yapabilirsin.`,
              label: "Kapat",
              run: () => closeAttendance(id),
            })
          }
          className={pill}
        >
          Yoklamayı kapat
        </Button>
      )}
      {phase !== "cancelled" && (
        <Link
          href={`/calismalar/${id}/duzenle`}
          className={cn(buttonVariants({ variant: "outline" }), pill)}
        >
          <Pencil />
          Düzenle
        </Link>
      )}
      {(phase === "upcoming" || phase === "openable") && !started && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            setConfirm({
              title: "Çalışma iptal edilsin mi?",
              text: "Koristler çalışmayı iptal edildi olarak görür. Bildirilen mazeretler saklanır; iptali geri alabilirsin.",
              label: "İptal et",
              run: () => setCancelled(id, true),
            })
          }
          className={pill}
        >
          <Ban />
          İptal et
        </Button>
      )}
      {phase === "cancelled" && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => run(() => setCancelled(id, false))}
          className={pill}
        >
          <RotateCcw />
          İptali geri al
        </Button>
      )}
      {inSeries && laterInSeries > 0 && (
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() =>
            setConfirm({
              title: "Seri bitirilsin mi?",
              text: `Bu tarihten sonraki ${laterInSeries} çalışma silinecek. Bildirilen mazeretler de silinir.`,
              label: "Seriyi bitir",
              run: () => endSeries(id),
            })
          }
          className={cn(pill, "text-destructive hover:text-destructive")}
        >
          <CalendarX2 />
          Seriyi bitir
        </Button>
      )}

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm?.title}</DialogTitle>
            <DialogDescription>{confirm?.text}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} className="h-11 rounded-xl">
              Vazgeç
            </Button>
            <Button
              disabled={pending}
              onClick={() => confirm && run(confirm.run)}
              className="h-11 rounded-xl"
            >
              {confirm?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
