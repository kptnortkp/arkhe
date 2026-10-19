"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deletePiece, setPieceStatus } from "@/app/(portal)/repertuvar/actions";
import { Button } from "@/components/ui/button";
import type { PieceStatus } from "@/db/schema";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useRunAction } from "@/components/use-run-action";

export function DangerZone({
  id,
  title,
  status,
  inProgram,
}: {
  id: string;
  title: string;
  status: PieceStatus;
  inProgram: boolean;
}) {
  const router = useRouter();
  const [pending, run] = useRunAction();
  const [confirm, setConfirm] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const archive = () => run(() => setPieceStatus(id, "archive"));
  const askArchive = () => (inProgram ? setConfirmArchive(true) : archive());

  return (
    <section className="space-y-3 rounded-2xl border border-destructive/30 p-4">
      <p className="text-sm text-muted-foreground">
        Artık söylemediğiniz eserleri silmek yerine arşivleyin; bağlantılar korunur.
      </p>
      <div className="flex flex-wrap gap-2">
        {status !== "archive" && (
          <Button
            variant="outline"
            className="h-11 rounded-xl px-4"
            disabled={pending}
            onClick={archive}
          >
            Arşivle
          </Button>
        )}
        <Button
          variant="destructive"
          className="h-11 rounded-xl px-4"
          disabled={pending}
          onClick={() => setConfirm(true)}
        >
          Eseri sil
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`"${title}" kalıcı olarak silinsin mi? Bağlantıları da silinir.`}
        description="Bu işlem geri alınamaz."
        pending={pending}
        actions={[
          ...(status !== "archive"
            ? [
                {
                  label: "Arşivle",
                  variant: "outline" as const,
                  run: () => {
                    setConfirm(false);
                    askArchive();
                  },
                },
              ]
            : []),
          {
            label: "Kalıcı olarak sil",
            run: () =>
              run(
                () => deletePiece(id),
                (result) => {
                  setConfirm(false);
                  if (!result.error) router.push("/repertuvar");
                },
              ),
          },
        ]}
      />
      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`"${title}" arşivlensin mi?`}
        description="Arşivlenen eser programdan da çıkar. Bağlantıları korunur."
        pending={pending}
        actions={[
          {
            label: "Arşivle",
            run: () => {
              setConfirmArchive(false);
              archive();
            },
          },
        ]}
      />
    </section>
  );
}
