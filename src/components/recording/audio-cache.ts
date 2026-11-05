"use client";

/** Thrown for a non-2xx answer, carrying the response so callers can read its message. */
export class AudioFetchError extends Error {
  constructor(readonly response: Response) {
    super(`audio ${response.status}`);
  }
}

// Rehearsal audio never changes under its id, and the browser's HTTP cache can't be relied on for
// large files (iOS home-screen apps), so each file is fetched once per page session.
const files = new Map<string, Promise<Blob>>();

export function fetchAudio(src: string): Promise<Blob> {
  let pending = files.get(src);
  if (!pending) {
    pending = fetch(src).then((res) => {
      if (!res.ok) throw new AudioFetchError(res);
      return res.blob();
    });
    // A failure is not kept: the next tap asks again.
    pending.catch(() => files.delete(src));
    files.set(src, pending);
  }
  return pending;
}
