import { Mail } from "lucide-react";

export function RecipientsList({
  recipients,
  audit,
}: {
  recipients: string[];
  audit: string | null;
}) {
  return (
    <div className="space-y-2" data-testid="backup-recipients-readonly">
      {recipients.length ? (
        <ul className="space-y-1">
          {recipients.map((r) => (
            <li key={r} className="flex min-h-11 items-center gap-2 text-sm break-all">
              <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {r}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">Henüz alıcı yok.</p>
      )}
      <p className="text-sm text-muted-foreground">Alıcıları yalnızca koro şefi değiştirebilir.</p>
      {audit && (
        <p className="text-xs text-muted-foreground" data-testid="backup-audit">
          {audit}
        </p>
      )}
    </div>
  );
}
