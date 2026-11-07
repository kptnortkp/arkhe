import { connection } from "next/server";
import { z } from "zod";
import { consumeAttempt } from "@/lib/auth/rate-limit";
import { getSessionUser } from "@/lib/auth/session";
import { reportImageFor } from "@/lib/reports/queries";
import { storage } from "@/lib/storage/driver";
import { empty, fail, fileHeaders, startTimeout } from "@/lib/storage/http";
import { MSG } from "@/lib/storage/messages";
import { logDelivery } from "@/lib/storage/quota";

export const runtime = "nodejs";
export const maxDuration = 30;

const PER_HOUR = 120;

/**
 * A report screenshot for its reporter or a handler; anyone else gets the same empty 404 as an
 * unknown id. Counted as a non-recording delivery (area 'score'), never cached by the browser.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/dosya/sorun/[id]">) {
  await connection();
  const viewer = await getSessionUser();
  if (!viewer) return empty(401);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return empty(404);
  const image = await reportImageFor(id, viewer.id);
  if (!image) return empty(404);
  if ((await consumeAttempt(`report-image-get:${viewer.id}`, PER_HOUR, 3_600_000)).blocked) {
    return fail(429, MSG.listenRate, "rate");
  }
  const driver = await storage();
  if (!driver) return fail(503, MSG.playbackFailed, "disabled");
  const timeout = startTimeout(15_000);
  let object;
  try {
    object = await driver.get(image.storageKey, timeout.signal);
  } catch (error) {
    timeout.clear();
    console.error("storage get failed", { driver: driver.name, kind: (error as { kind?: string }).kind });
    return fail(503, MSG.playbackFailed, "storage");
  }
  timeout.clear();
  if (!object) {
    console.error("storage object missing", { driver: driver.name });
    return empty(410);
  }
  const size = object.size ?? image.sizeBytes;
  await logDelivery("score", size);
  return new Response(object.body, {
    status: 200,
    headers: fileHeaders({
      type: image.contentType,
      size,
      cache: "private, no-store",
      attachment: null,
    }),
  });
}
