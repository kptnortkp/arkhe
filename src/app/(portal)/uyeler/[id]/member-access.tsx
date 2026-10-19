"use client";

import { KeyRound, UserCheck, UserX } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createMemberLink, setMemberActive, type MemberFormState } from "../actions";
import { InviteLinkPanel } from "../invite-link-panel";

export function MemberAccess({
  id,
  isActive,
  hasPassword,
  canToggleActive,
  canIssueLink,
}: {
  id: string;
  isActive: boolean;
  hasPassword: boolean;
  canToggleActive: boolean;
  canIssueLink: boolean;
}) {
  const [link, setLink] = useState<MemberFormState["link"]>();
  const [pending, startTransition] = useTransition();

  function makeLink() {
    startTransition(async () => {
      const result = await createMemberLink(id);
      if (result.error) toast.error(result.error);
      else setLink(result.link);
    });
  }

  function toggleActive() {
    if (isActive && !confirm("Üye pasifleştirilsin mi? Giriş yapamaz, açık oturumları kapanır."))
      return;
    startTransition(async () => {
      const result = await setMemberActive(id, !isActive);
      if (result.error) toast.error(result.error);
      else toast.success(result.success);
      setLink(undefined);
    });
  }

  return (
    <div className="space-y-4">
      {isActive && canIssueLink && (
        <div className="flex flex-col gap-3 rounded-2xl border bg-card p-5 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="font-medium">{hasPassword ? "Şifre yenileme" : "Davet bekliyor"}</p>
            <p className="text-sm text-muted-foreground">
              {hasPassword
                ? "Şifresini unutan üyeye 24 saat geçerli yeni bir link gönder."
                : "Üye henüz şifresini belirlemedi. Yeni link oluşturunca eskisi geçersiz olur."}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={makeLink}
            className="h-10 shrink-0 rounded-full px-4"
          >
            <KeyRound />
            {hasPassword ? "Yenileme linki oluştur" : "Yeni davet linki"}
          </Button>
        </div>
      )}
      {link && <InviteLinkPanel {...link} />}
      {canToggleActive && (
        <Button
          type="button"
          variant={isActive ? "destructive" : "outline"}
          disabled={pending}
          onClick={toggleActive}
          className="h-10 rounded-full px-4"
        >
          {isActive ? <UserX /> : <UserCheck />}
          {isActive ? "Üyeyi pasifleştir" : "Üyeyi yeniden aktif et"}
        </Button>
      )}
    </div>
  );
}
