"use client";

import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteAssignment } from "@/app/(portal)/odevler/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRunAction } from "@/components/use-run-action";
import { cn } from "@/lib/utils";

export function AssignmentMenu({
  id,
  title,
  submitted,
}: {
  id: string;
  title: string;
  submitted: number;
}) {
  const router = useRouter();
  const [pending, run] = useRunAction();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex gap-2">
      <Link
        href={`/odevler/${id}/duzenle`}
        aria-label="Ödevi düzenle"
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
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem className="min-h-11" render={<Link href={`/odevler/${id}/duzenle`} />}>
            <Pencil />
            Düzenle
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-11"
            variant="destructive"
            onClick={() => setConfirm(true)}
          >
            <Trash2 />
            Sil
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`"${title}" silinsin mi?`}
        description={
          submitted
            ? `${submitted} teslim kaydı ve notlar da silinir. Bu işlem geri alınamaz.`
            : "Bu işlem geri alınamaz."
        }
        pending={pending}
        actions={[
          {
            label: "Sil",
            run: () =>
              run(
                () => deleteAssignment(id),
                (result) => {
                  setConfirm(false);
                  if (!result.error) router.push("/odevler");
                },
              ),
          },
        ]}
      />
    </div>
  );
}
