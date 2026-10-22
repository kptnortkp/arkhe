// Unsent takes survive in-app navigation (D40); never persisted, cleared on send and on logout.
export type Take = {
  blob: Blob;
  durationMs: number | null;
  /** One per take, reused by `Tekrar dene` so a replayed upload lands once. */
  uploadId: string;
  source: "record" | "file";
};

const takes = new Map<string, Take>();

export const takeKey = (userId: string, assignmentId: string) => `${userId}:${assignmentId}`;

export function getTake(key: string) {
  return takes.get(key) ?? null;
}

export function setTake(key: string, take: Take) {
  takes.set(key, take);
}

export function clearTake(key: string) {
  takes.delete(key);
}

export function clearTakes() {
  takes.clear();
}
