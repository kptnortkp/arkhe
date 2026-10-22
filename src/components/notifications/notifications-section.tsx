import { getPushSettings } from "@/lib/push/settings";
import { formatter } from "@/lib/time";
import { PushPanel } from "./push-panel";

const dayParts = formatter({ weekday: "short", day: "numeric", month: "short" });

/** "Çar 29 Eki": the spec's {gün}. */
function gun(at: Date) {
  const parts = Object.fromEntries(dayParts.formatToParts(at).map((p) => [p.type, p.value]));
  return `${parts.weekday} ${parts.day} ${parts.month}`;
}

/** Profilim › Bildirimler: this browser, the person's devices and their switches. */
export async function NotificationsSection({ userId }: { userId: string }) {
  const settings = await getPushSettings();
  return (
    <section
      id="bildirimler"
      aria-labelledby="bildirimler-title"
      className="scroll-mt-20 space-y-4"
      data-testid="push-section"
    >
      <h2 id="bildirimler-title" className="text-xl font-medium">
        Bildirimler
      </h2>
      {settings.publicKey ? (
        <PushPanel
          publicKey={settings.publicKey}
          userId={userId}
          devices={settings.devices.map((d) => ({
            id: d.id,
            label: d.label,
            added: gun(d.createdAt),
            current: d.current,
          }))}
          prefs={settings.groups}
          quiet={settings.quiet}
          manager={settings.manager}
        />
      ) : (
        <p className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
          Bildirimler henüz açılmadı.
        </p>
      )}
    </section>
  );
}
