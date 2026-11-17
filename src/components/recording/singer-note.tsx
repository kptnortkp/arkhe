"use client";

import { MessageSquareText } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { saveMyHomeworkNote } from "@/app/(portal)/odevler/kayit-actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SINGER_NOTE_MAX } from "@/lib/storage/messages";

/** The singer's optional note to the conductor; read-only once the conductor has commented. */
export function SingerNote({
  assignmentId,
  note,
  locked,
}: {
  assignmentId: string;
  note: string | null;
  locked: boolean;
}) {
  const [state, action, pending] = useActionState(saveMyHomeworkNote, {});
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(note ?? "");

  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.success) {
      toast.success(state.success);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- close after a confirmed save
      setOpen(false);
    }
  }, [state]);

  if (locked) {
    if (!note) return null;
    return (
      <div className="space-y-1 rounded-2xl border p-3" data-testid="singer-note">
        <p className="text-xs font-medium text-muted-foreground">Şefe notun</p>
        <p className="text-sm whitespace-pre-line">{note}</p>
      </div>
    );
  }

  if (!open) {
    return note ? (
      <div className="space-y-1 rounded-2xl border p-3" data-testid="singer-note">
        <p className="text-xs font-medium text-muted-foreground">Şefe notun</p>
        <p className="text-sm whitespace-pre-line">{note}</p>
        <Button
          type="button"
          variant="ghost"
          className="-mx-2 h-11 px-2 text-primary"
          onClick={() => setOpen(true)}
        >
          Notu düzenle
        </Button>
      </div>
    ) : (
      <Button
        type="button"
        variant="outline"
        className="h-12 w-full rounded-2xl text-base md:max-w-sm"
        onClick={() => setOpen(true)}
        data-testid="singer-note-open"
      >
        <MessageSquareText />
        Şefe not ekle
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-2" data-testid="singer-note-form">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <Label htmlFor="singer-note">Şefe not (isteğe bağlı)</Label>
      <Textarea
        id="singer-note"
        name="note"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={SINGER_NOTE_MAX}
        rows={3}
        placeholder="Örneğin: 12. ölçüdeki girişten emin değilim."
      />
      <p className="text-xs text-muted-foreground">
        Kaydını dinleyen şef ve partisyon şefleri görür. Şef yorum yazınca not değişmez.
      </p>
      <div className="flex gap-2">
        <Button type="submit" className="h-11 rounded-full px-5" disabled={pending}>
          {text.trim() ? "Notu kaydet" : note ? "Notu sil" : "Kaydet"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11 rounded-full px-5"
          onClick={() => {
            setText(note ?? "");
            setOpen(false);
          }}
        >
          Vazgeç
        </Button>
      </div>
    </form>
  );
}
