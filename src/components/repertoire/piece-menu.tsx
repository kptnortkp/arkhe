"use client";

import {
  Archive,
  ArchiveRestore,
  ListMinus,
  ListPlus,
  Mic,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { addToProgram, removeFromProgram, setPieceStatus } from "@/app/(portal)/repertuvar/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PieceStatus } from "@/db/schema";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useRunAction } from "@/components/use-run-action";

export function PieceMenu({
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
  const [pending, run] = useRunAction();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const archive = () => run(() => setPieceStatus(id, "archive"));

  return (
    <div className="flex gap-2">
      <Link
        href={`/repertuvar/${id}/duzenle`}
        aria-label="Eseri düzenle"
        className={cn(buttonVariants({ variant: "outline" }), "size-11 rounded-full")}
      >
        <Pencil />
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              className="size-11 rounded-full"
              aria-label="Diğer işlemler"
              disabled={pending}
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {status !== "archive" && (
            <DropdownMenuItem
              className="min-h-11"
              render={<Link href={`/odevler/yeni?eser=${id}`} />}
            >
              <Mic />
              Ödev ver
            </DropdownMenuItem>
          )}
          {status !== "archive" &&
            (inProgram ? (
              <DropdownMenuItem
                className="min-h-11"
                onClick={() => run(() => removeFromProgram(id))}
              >
                <ListMinus />
                Programdan çıkar
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem className="min-h-11" onClick={() => run(() => addToProgram(id))}>
                <ListPlus />
                Programa ekle
              </DropdownMenuItem>
            ))}
          {status === "archive" ? (
            <DropdownMenuItem
              className="min-h-11"
              onClick={() => run(() => setPieceStatus(id, "concert"))}
            >
              <ArchiveRestore />
              Arşivden çıkar
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              className="min-h-11"
              onClick={() => (inProgram ? setConfirmArchive(true) : archive())}
            >
              <Archive />
              Arşivle
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
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
    </div>
  );
}
