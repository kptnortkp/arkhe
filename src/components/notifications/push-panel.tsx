"use client";

import { Bell, BellOff, BellRing, Send, Share } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { removePushDevice, savePushPref, sendTestPush } from "@/app/actions/push";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { QUIET_KEY, QUIET_LABEL } from "@/lib/push/groups";
import {
  disablePush,
  enablePush,
  SWITCH_CLASS,
  useDeviceState,
  type DeviceState,
} from "./push-client";
import type { FormState } from "@/lib/validation";

export type PanelDevice = { id: string; label: string; added: string; current: boolean };
export type PanelPref = { key: string; label: string; on: boolean };

const STATE_TEXT: Partial<Record<DeviceState, string>> = {
  unsupported:
    "Bu tarayıcı bildirim göstermiyor. Android'de Chrome'u, iPhone'da ana ekrana eklenmiş Arkhe'yi kullan.",
  "ios-install":
    "iPhone'da bildirim almak için önce Arkhe'yi ana ekrana ekle, sonra ana ekrandaki Arkhe'yi açıp buraya gel.",
  "ios-old": "Bildirim için iOS 16.4 ya da daha yeni bir sürüm gerekiyor.",
  default:
    "Yoklama, çalışma değişikliği ve ödevler için telefonuna haber verelim. Bildirim gelmese de her şey portalda durur.",
  denied:
    "Bildirim izni kapalı. Telefonunun ayarlarından Arkhe'ye bildirim izni ver, sonra bu sayfayı yenile.",
  on: "Bu cihazda bildirimler açık.",
};

function StateIcon({ state }: { state: DeviceState }) {
  const cls = "mt-0.5 size-5 shrink-0";
  if (state === "on") return <BellRing aria-hidden className={`${cls} text-present`} />;
  if (state === "default") return <Bell aria-hidden className={`${cls} text-muted-foreground`} />;
  return <BellOff aria-hidden className={`${cls} text-muted-foreground`} />;
}

function PrefRow({
  pref,
  help,
  disabled,
}: {
  pref: PanelPref;
  help?: React.ReactNode;
  disabled?: boolean;
}) {
  const [on, setOn] = useState(pref.on);
  const [, startTransition] = useTransition();
  const helpId = useId();
  const labelId = useId();

  function change(next: boolean) {
    setOn(next);
    startTransition(async () => {
      const form = new FormData();
      form.set("key", pref.key);
      form.set("on", next ? "1" : "0");
      const result = await savePushPref({}, form).catch((): FormState => ({
        error: "Bir şeyler ters gitti, tekrar dene.",
      }));
      if (result.error) {
        setOn(!next);
        toast.error(result.error);
      } else toast.success(result.success ?? "Kaydedildi.");
    });
  }

  return (
    <li>
      <label
        className="flex min-h-14 cursor-pointer items-center gap-4 px-4 py-3"
        data-testid="push-pref"
        data-key={pref.key}
      >
        <span className="min-w-0 flex-1">
          <span id={labelId} className="block">
            {pref.label}
          </span>
          {help && (
            <span id={helpId} className="mt-0.5 block text-sm text-muted-foreground">
              {help}
            </span>
          )}
        </span>
        <Switch
          checked={on}
          onCheckedChange={change}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-describedby={help ? helpId : undefined}
          className={SWITCH_CLASS}
        />
      </label>
    </li>
  );
}

export function PushPanel({
  publicKey,
  userId,
  devices,
  prefs,
  quiet,
  manager,
}: {
  publicKey: string;
  userId: string;
  devices: PanelDevice[];
  prefs: PanelPref[];
  quiet: boolean;
  manager: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useDeviceState();
  const [busy, setBusy] = useState(false);
  const [testing, startTest] = useTransition();
  const [removing, startRemove] = useTransition();
  const [confirm, setConfirm] = useState<PanelDevice | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const testHint = useId();

  async function onEnable() {
    if (busy) return;
    setBusy(true);
    const result = await enablePush(publicKey, userId).catch(() => ({
      state: "default" as const,
      error: "Bildirimler açılamadı. Sayfayı yenileyip tekrar dene.",
    }));
    setState(result.state);
    if ("error" in result && result.error) toast.error(result.error);
    else if ("success" in result && result.success) toast.success(result.success);
    setBusy(false);
    status.current?.focus();
    router.refresh();
  }

  async function onDisable() {
    if (busy) return;
    setBusy(true);
    const result = await disablePush();
    if (result.error) toast.error(result.error);
    else {
      toast.success(result.success ?? "Bu cihazda bildirimler kapandı.");
      setState("default");
    }
    setBusy(false);
    status.current?.focus();
    router.refresh();
  }

  function onTest() {
    startTest(async () => {
      const result = await sendTestPush().catch((): FormState => ({
        error: "Bir şeyler ters gitti, tekrar dene.",
      }));
      if (result.error) toast.error(result.error);
      else if (result.success) toast.success(result.success);
      if (result.warning) toast.warning(result.warning);
      router.refresh();
    });
  }

  function onRemove(device: PanelDevice) {
    startRemove(async () => {
      const form = new FormData();
      form.set("id", device.id);
      const result = await removePushDevice({}, form).catch((): FormState => ({
        error: "Bir şeyler ters gitti, tekrar dene.",
      }));
      if (result.error) toast.error(result.error);
      else toast.success(result.success ?? "Cihaz kaldırıldı.");
      setConfirm(null);
      router.refresh();
    });
  }

  const noDevice = devices.length === 0;

  return (
    <>
      <div
        className="space-y-3 rounded-2xl border bg-card p-4"
        data-testid="push-device"
        data-state={state}
        aria-busy={state === "loading"}
      >
        {state === "loading" ? (
          <p className="min-h-10 text-sm text-muted-foreground">Bu cihaz kontrol ediliyor…</p>
        ) : (
          <div className="flex items-start gap-3">
            <StateIcon state={state} />
            <div className="min-w-0 space-y-2">
              <p
                ref={status}
                tabIndex={-1}
                className={state === "on" ? "font-medium outline-none" : "text-sm outline-none"}
                data-testid="push-state-text"
              >
                {STATE_TEXT[state]}
              </p>
              {state === "ios-install" && (
                <p className="text-sm text-muted-foreground">
                  Safari&apos;de Paylaş{" "}
                  <Share aria-hidden className="mr-1 inline size-4 align-[-2px]" />
                  simgesine, sonra “Ana Ekrana Ekle”ye dokun.
                </p>
              )}
            </div>
          </div>
        )}
        {state === "default" && (
          <Button
            type="button"
            onClick={onEnable}
            disabled={busy}
            className="h-11 w-full rounded-full"
          >
            <Bell aria-hidden />
            Bildirimleri aç
          </Button>
        )}
        {state === "on" && (
          <Button
            type="button"
            variant="outline"
            onClick={onDisable}
            disabled={busy}
            className="h-11 w-full rounded-full"
          >
            <BellOff aria-hidden />
            Bu cihazda kapat
          </Button>
        )}
      </div>

      {devices.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground">Cihazların</h3>
          <ul className="divide-y rounded-2xl border bg-card" data-testid="push-devices">
            {devices.map((d) => (
              <li
                key={d.id}
                className="flex min-h-14 items-center gap-3 py-2 pr-2 pl-4"
                data-testid="push-device-row"
                data-current={d.current || undefined}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{d.label}</span>
                    {d.current && <Badge variant="secondary">Bu cihaz</Badge>}
                  </span>
                  <span className="block text-sm text-muted-foreground">Eklendi {d.added}</span>
                </span>
                {!(d.current && state === "on") && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 shrink-0 rounded-xl px-3 text-muted-foreground"
                    aria-label={`Kaldır: ${d.label}`}
                    onClick={() => setConfirm(d)}
                  >
                    Kaldır
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(state === "default" || state === "on" || !noDevice) && (
        <div className="space-y-1.5">
          <Button
            type="button"
            variant="outline"
            onClick={onTest}
            disabled={testing || noDevice}
            aria-describedby={noDevice ? testHint : undefined}
            className="h-11 w-full rounded-full"
          >
            <Send aria-hidden />
            Deneme bildirimi gönder
          </Button>
          {noDevice && (
            <p id={testHint} className="text-sm text-muted-foreground">
              Önce bu cihazda bildirimleri aç.
            </p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">Neler için bildirim gelsin?</h3>
        {noDevice && (
          <p className="text-sm text-muted-foreground">
            Bildirimleri bir cihazda açınca bu ayarlar geçerli olur.
          </p>
        )}
        <ul className="divide-y rounded-2xl border bg-card" data-testid="push-prefs">
          {prefs.map((p) => (
            <PrefRow key={p.key} pref={p} />
          ))}
          <PrefRow
            pref={{ key: QUIET_KEY, label: QUIET_LABEL, on: quiet }}
            help={
              <>
                Bu saatlerde gelenler sabah 08:00–09:00 arası tek bildirimde gelir.
                {manager && " Acil yönetim işleri beklemez."}
              </>
            }
          />
        </ul>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm ? `${confirm.label} kaldırılsın mı?` : ""}
        description="Bu cihaza artık bildirim gitmez."
        pending={removing}
        actions={[{ label: "Kaldır", run: () => confirm && onRemove(confirm) }]}
      />
    </>
  );
}
