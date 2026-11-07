"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { deleteAnnouncement } from "@/app/(portal)/duyurular/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { reloadIfStale, STALE_MESSAGE } from "@/components/stale-deploy";
import { Button } from "@/components/ui/button";

export function DeleteAnnouncementButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      try {
        const result = await deleteAnnouncement(id);
        if (result.ok) toast.success(result.message);
        else if (result.error) toast.error(result.error);
      } catch (e) {
        toast.error(reloadIfStale(e) ? STALE_MESSAGE : "Bir şeyler ters gitti, tekrar dene.");
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="h-11 rounded-full px-3 [&_svg]:text-destructive"
        onClick={() => setOpen(true)}
        data-testid="announcement-delete"
      >
        <Trash2 aria-hidden />
        Sil
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Duyuru silinsin mi?"
        description={`“${title}” listeden ve ana sayfadan kalkar. Gönderilmiş bildirimler geri alınmaz.`}
        pending={pending}
        actions={[{ label: pending ? "Siliniyor…" : "Sil", run }]}
      />
    </>
  );
}
