"use client";

import { HardDrive, Headphones, Mail, Settings2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RecordingEmailDialog } from "./recording-email-dialog";

/** D60: the weekly-at-most settings behind one `Ayarlar` menu in the /odevler header. */
export function HomeworkSettings({
  email,
  conductor,
}: {
  email: string | null;
  conductor: boolean;
}) {
  const [dialog, setDialog] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" className="h-11 rounded-full px-4" />}
        >
          <Settings2 />
          Ayarlar
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          {conductor && (
            <DropdownMenuItem className="min-h-11" render={<Link href="/odevler/asistanlar" />}>
              <Headphones />
              Dinleme asistanları
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className="min-h-11" render={<Link href="/odevler/depolama" />}>
            <HardDrive />
            Depolama
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-11" onClick={() => setDialog(true)}>
            <Mail />
            Kayıt e-postası…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RecordingEmailDialog current={email} open={dialog} onOpenChange={setDialog} />
    </>
  );
}
