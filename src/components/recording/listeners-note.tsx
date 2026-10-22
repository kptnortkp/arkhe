import { ChevronDown, Lock } from "lucide-react";

/** D11 transparency: one visible line; the full sentences sit in the disclosure (AC 7, 21). */
export function ListenersNote({ names }: { names: string[] }) {
  const list = names.join(", ");
  return (
    <div className="flex gap-2 text-xs text-muted-foreground" data-testid="listeners">
      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p>
          {names.length === 0 ? (
            "Kaydını yalnızca şef dinler."
          ) : (
            <>
              Kaydını şef ve dinleme {names.length > 1 ? "asistanları" : "asistanı"}{" "}
              <span className="font-medium text-foreground">{list}</span> dinler.
            </>
          )}
        </p>
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center font-medium text-primary">
            Kimler görür, ne zaman silinir?
          </summary>
          <div className="space-y-1 pb-1">
            {names.length > 0 && (
              <p>Kaydını şef ve şefin atadığı dinleme asistanları dinler: {list}.</p>
            )}
            <p>Asistanların notlarını yalnızca şef görür; sana şefin yorumu gelir.</p>
            <p>
              Ses dosyası, şef yorumundan 90 gün sonra silinir. Yorum gelmezse yüklendikten 120 gün
              sonra silinir.
            </p>
            <p>Yorumlar ve notlar silinmez.</p>
          </div>
        </details>
      </div>
    </div>
  );
}

/** D5: the Phase 4 mail block and `Teslim ettim`, one disclosure below the recorder. */
export function FallbackDetails({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <details id="baska-yolla" open={open} className="group border-t pt-1" data-testid="fallback">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden">
        Başka yolla gönderdim
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-3 pb-2">
        <p className="text-xs text-muted-foreground">
          Kaydını e-postayla ya da elden şefe ilettiysen burada işaretle.
        </p>
        {children}
      </div>
    </details>
  );
}
