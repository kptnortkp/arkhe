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
