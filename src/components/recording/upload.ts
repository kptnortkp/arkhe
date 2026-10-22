import type { UploadCode, UploadResult } from "@/lib/storage/limits";

export type UploadOutcome =
  | { ok: true; status: number; result: UploadResult }
  | { ok: false; status: number; code: UploadCode | "network" | "aborted"; error: string | null };

/** Raw-body upload over XHR: `fetch` reports no upload progress in Safari. */
export function uploadBlob(
  url: string,
  body: Blob,
  opts: {
    headers?: Record<string, string>;
    onProgress?: (percent: number) => void;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.timeout = opts.timeoutMs ?? 60_000;
    for (const [k, v] of Object.entries(opts.headers ?? {})) xhr.setRequestHeader(k, v);
    let last = -1;
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const percent = Math.floor((e.loaded / e.total) * 100);
      if (percent !== last) opts.onProgress?.((last = percent));
    };
    xhr.onload = () => {
      let data: { error?: string; code?: UploadCode } & Partial<UploadResult> = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 200 || xhr.status === 201) {
        resolve({ ok: true, status: xhr.status, result: data as UploadResult });
      } else if (xhr.status === 413) {
        // The platform's own 413 is HTML: map any of them to the size refusal.
        resolve({ ok: false, status: 413, code: "size", error: null });
      } else {
        resolve({
          ok: false,
          status: xhr.status,
          code: data.code ?? "storage",
          error: data.error ?? null,
        });
      }
    };
    const network = () => resolve({ ok: false, status: 0, code: "network", error: null });
    xhr.onerror = network;
    xhr.ontimeout = network;
    xhr.onabort = () => resolve({ ok: false, status: 0, code: "aborted", error: null });
    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}
