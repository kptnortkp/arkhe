// Isomorphic: profile UI, server actions and the dispatcher share these keys and labels.
import type { PushPrefKey, Role, VoicePart } from "@/db/schema";

export const PUSH_GROUPS = [
  "calisma",
  "devamsizlik",
  "odev",
  "dinleme",
  "repertuvar",
  "yonetim",
  "aidat",
  "butce",
  "sistem",
] as const;
export type PushGroup = (typeof PUSH_GROUPS)[number];
export const QUIET_KEY = "gece" as const;
export type { PushPrefKey };

export const GROUP_LABELS: Record<PushGroup, string> = {
  calisma: "Çalışma ve konser duyuruları",
  devamsizlik: "Gelmedi olarak işaretlendiğimde",
  odev: "Ödevler ve şef yorumları",
  dinleme: "Dinleme kuyruğu",
  repertuvar: "Repertuvar yenilikleri",
  yonetim: "Yönetim işleri",
  aidat: "Aidat hatırlatmaları",
  butce: "Bütçe",
  sistem: "Yedek ve depolama uyarıları",
};
export const QUIET_LABEL = "Gece sessiz (22:00–08:00)";

export const DEFAULTS: Record<PushPrefKey, boolean> = {
  calisma: true,
  devamsizlik: false,
  odev: true,
  dinleme: true,
  repertuvar: false,
  yonetim: true,
  aidat: true,
  butce: true,
  sistem: true,
  gece: true,
};

export type Audience = {
  role: Role;
  voicePart: VoicePart | null;
  assistant: boolean;
};

/** Which switches a person sees, and therefore which groups can ever reach them (D72). */
export function groupVisible(group: PushGroup, a: Audience, duesOn: boolean) {
  switch (group) {
    case "calisma":
    case "repertuvar":
      return true;
    case "devamsizlik":
    case "odev":
      return a.voicePart !== null && a.role !== "conductor";
    case "dinleme":
      return a.role === "conductor" || a.assistant;
    case "yonetim":
    case "butce":
      return a.role === "conductor" || a.role === "board";
    case "aidat":
      return duesOn;
    case "sistem":
      return a.role === "conductor";
  }
}

export function isPushGroup(v: unknown): v is PushGroup {
  return typeof v === "string" && (PUSH_GROUPS as readonly string[]).includes(v);
}
