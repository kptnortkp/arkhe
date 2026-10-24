"use client";

import type { ComponentProps, MouseEvent } from "react";
import { toast } from "sonner";
import { isIos, isStandalone } from "@/lib/pwa-store";

async function fetchFile(href: string) {
  const res = await fetch(href);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "dosya";
  return new File([await res.blob()], name, { type: res.headers.get("Content-Type") ?? "" });
}

async function share(file: File) {
  try {
    await navigator.share({ files: [file] });
    return true;
  } catch (error) {
    const name = (error as Error).name;
    if (name === "AbortError") return true;
    if (name !== "NotAllowedError") throw error;
    return false;
  }
}

/**
 * iOS home-screen apps open an attachment in a viewer with no way back, so there the file goes to
 * the share sheet ("Dosyalara Kaydet") instead. Everywhere else the link downloads as usual.
 */
export async function downloadInApp(event: MouseEvent<HTMLAnchorElement>) {
  if (!isIos() || !isStandalone()) return;
  event.preventDefault();
  if (typeof navigator.canShare !== "function") {
    toast.error("Bu cihazda uygulama içinden indirilemiyor. Portalı Safari'de açıp indir.");
    return;
  }
  try {
    const file = await fetchFile(event.currentTarget.href);
    if (!navigator.canShare({ files: [file] })) throw new Error("share unsupported");
    // The fetch can outlive the tap's user activation; then a second tap opens the sheet.
    if (!(await share(file))) {
      toast("Dosya hazır.", { action: { label: "Kaydet", onClick: () => void share(file) } });
    }
  } catch {
    toast.error("Dosya indirilemedi. Biraz sonra tekrar dene.");
  }
}

export function DownloadLink({ onClick, ...props }: ComponentProps<"a">) {
  return (
    <a
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) void downloadInApp(event);
      }}
    />
  );
}
