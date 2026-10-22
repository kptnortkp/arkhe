"use client";

import { MoreHorizontal, Plus } from "lucide-react";
import { useActionState, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  addAssistant,
  removeAssistant,
  updateAssistant,
} from "@/app/(portal)/odevler/asistanlar/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormMessage } from "@/components/forms/field";
import { submitWithoutReset } from "@/components/forms/submit-without-reset";
import { useFocusError } from "@/components/forms/use-focus-error";
import { PartDot } from "@/components/part-dot";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useRunAction } from "@/components/use-run-action";
import { VOICE_PARTS, type Role, type VoicePart } from "@/db/schema";
import { searchKey } from "@/lib/format";
import { ROLE_LABELS, VOICE_PART_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

export type Candidate = { id: string; name: string; part: VoicePart | null; role: Role };
type Editing = { userId: string; name: string; scope: VoicePart[]; allParts: boolean };

const chip =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-full border bg-card px-4 text-sm transition-colors select-none hover:bg-muted has-checked:border-primary has-checked:bg-primary/8 has-checked:font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring/50";

function AssistantForm({
  candidates,
  editing,
  onDone,
}: {
  candidates: Candidate[];
  editing: Editing | null;
  onDone: () => void;
}) {
  const action = editing ? updateAssistant.bind(null, editing.userId) : addAssistant;
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useFocusError(state);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string>("");
  const [all, setAll] = useState(editing?.allParts ?? false);
  const [parts, setParts] = useState<VoicePart[]>(editing?.allParts ? [] : (editing?.scope ?? []));
  const [pickError, setPickError] = useState(false);

  useEffect(() => {
    if (!state.success) return;
    toast.success(state.success);
    onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per result
  }, [state]);

  const shown = useMemo(() => {
    const q = searchKey(query.trim());
    return candidates.filter((c) => !q || searchKey(c.name).includes(q));
  }, [candidates, query]);
  const groups = [...VOICE_PARTS, null].map((p) => ({
    part: p,
    rows: shown.filter((c) => c.part === p),
  }));
  const partsError = state.fieldErrors?.parts?.[0];

  return (
    <form
      ref={formRef}
      className="space-y-5"
      noValidate
      onSubmit={(e) => {
        if (!editing && !picked) {
          e.preventDefault();
          setPickError(true);
          return;
        }
        submitWithoutReset(e, formAction);
      }}
    >
      <FormMessage error={state.error} />
      {editing ? (
        <p className="font-medium">{editing.name}</p>
      ) : (
        <fieldset className="space-y-2" aria-invalid={pickError || undefined} aria-describedby={pickError ? "pick-error" : undefined}>
          <legend className="mb-2 text-sm font-medium">Kim?</legend>
          <Input
            type="search"
            placeholder="İsim ara"
            aria-label="İsim ara"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 rounded-xl"
          />
          <div className="max-h-64 space-y-3 overflow-y-auto rounded-xl border p-2">
            {shown.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground">Kimse bulunamadı.</p>
            )}
            {groups
              .filter((g) => g.rows.length > 0)
              .map((g) => (
                <div key={g.part ?? "none"} className="space-y-1">
                  <p className="px-2 font-sans text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
                    {g.part ? VOICE_PART_LABELS[g.part] : "Partisyonsuz"}
                  </p>
                  {g.rows.map((c) => (
                    <label
                      key={c.id}
                      className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-muted has-checked:bg-primary/8 has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
                    >
                      <input
                        type="radio"
                        name="userId"
                        value={c.id}
                        checked={picked === c.id}
                        onChange={() => {
                          setPicked(c.id);
                          setPickError(false);
                          if (!all && parts.length === 0) {
                            if (c.part) setParts([c.part]);
                            else setAll(true);
                          }
                        }}
                        className="size-4 accent-primary"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{c.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {c.part ? VOICE_PART_LABELS[c.part] : "Partisyonsuz"} · {ROLE_LABELS[c.role]}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ))}
          </div>
          {pickError && (
            <p id="pick-error" className="text-sm text-destructive">
              Bir kişi seç.
            </p>
          )}
        </fieldset>
      )}
      <fieldset
        className="space-y-2"
        aria-invalid={partsError ? true : undefined}
        aria-describedby={partsError ? "parts-error" : undefined}
      >
        <legend className="mb-2 text-sm font-medium">Hangi partisyonları dinlesin?</legend>
        <div className="flex flex-wrap gap-2">
          <label className={chip}>
            <input
              type="checkbox"
              name="scope"
              value="all"
              checked={all}
              onChange={(e) => {
                setAll(e.target.checked);
                if (e.target.checked) setParts([]);
              }}
              className="sr-only"
            />
            Tüm partisyonlar
          </label>
          {VOICE_PARTS.map((p) => (
            <label key={p} className={chip}>
              <input
                type="checkbox"
                name="parts"
                value={p}
                checked={parts.includes(p)}
                onChange={(e) => {
                  setAll(false);
                  setParts((prev) =>
                    e.target.checked ? [...prev, p] : prev.filter((x) => x !== p),
                  );
                }}
                className="sr-only"
              />
              <PartDot part={p} />
              {VOICE_PART_LABELS[p]}
            </label>
          ))}
        </div>
        {partsError && (
          <p id="parts-error" className="text-sm text-destructive">
            {partsError}
          </p>
        )}
      </fieldset>
      <p className="text-xs text-muted-foreground">
        Kendi kaydını hiçbir zaman dinlemez. Koristler, kaydını kimlerin dinlediğini görür.
      </p>
      <div className="space-y-2">
        <Button type="submit" className="h-12 w-full rounded-xl" disabled={pending}>
          {editing ? "Kaydet" : "Ekle"}
        </Button>
        <Button type="button" variant="ghost" className="h-12 w-full" onClick={onDone}>
          Vazgeç
        </Button>
      </div>
    </form>
  );
}

export function AddAssistant({ candidates, label = "Asistan ekle" }: { candidates: Candidate[]; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button className="h-11 rounded-full px-4" onClick={() => setOpen(true)}>
        <Plus />
        {label}
      </Button>
      <AssistantSheet open={open} onOpenChange={setOpen} candidates={candidates} editing={null} />
    </>
  );
}

function AssistantSheet({
  open,
  onOpenChange,
  candidates,
  editing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  candidates: Candidate[];
  editing: Editing | null;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92dvh] max-w-lg overflow-y-auto rounded-t-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="p-0">
          <SheetTitle className="font-heading text-xl">
            {editing ? "Asistanı düzenle" : "Asistan ekle"}
          </SheetTitle>
          <SheetDescription>
            Asistan, seçtiğin partisyonların kayıtlarını dinleyip sana not yazar.
          </SheetDescription>
        </SheetHeader>
        {open && (
          <AssistantForm
            candidates={candidates}
            editing={editing}
            onDone={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

export function AssistantMenu({
  row,
  effective,
}: {
  row: Editing;
  effective: boolean;
}) {
  const [edit, setEdit] = useState(false);
  const [remove, setRemove] = useState(false);
  const [pending, run] = useRunAction();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              className={cn("size-11 shrink-0 rounded-full")}
              aria-label={`İşlemler: ${row.name}`}
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          {effective && (
            <DropdownMenuItem className="min-h-11" onClick={() => setEdit(true)}>
              Düzenle
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className="min-h-11" variant="destructive" onClick={() => setRemove(true)}>
            Kaldır
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AssistantSheet open={edit} onOpenChange={setEdit} candidates={[]} editing={row} />
      <ConfirmDialog
        open={remove}
        onOpenChange={setRemove}
        title={`"${row.name}" kaldırılsın mı?`}
        description={`${row.name} artık kayıt dinleyemeyecek. Yazdığı notlar şefte kalır.`}
        pending={pending}
        actions={[
          { label: "Kaldır", run: () => run(() => removeAssistant(row.userId), () => setRemove(false)) },
        ]}
      />
    </>
  );
}
