// Install-prompt state shared by PwaBoot (listens on every page) and the install card.

export type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type InstallStatus = "idle" | "dismissed" | "installed";

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let status: InstallStatus = "idle";
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeInstall(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setDeferredPrompt(event: BeforeInstallPromptEvent) {
  deferredPrompt = event;
  emit();
}

export function getDeferredPrompt() {
  return deferredPrompt;
}

export function getInstallStatus() {
  return status;
}

export function setInstallStatus(next: InstallStatus) {
  if (next !== "idle") deferredPrompt = null;
  status = next;
  emit();
}

const STANDALONE = "(display-mode: standalone)";

export function isStandalone() {
  return (
    window.matchMedia(STANDALONE).matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function watchStandalone(onChange: () => void) {
  const media = window.matchMedia(STANDALONE);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
