import { z } from "zod";
import { json, managerOrError } from "@/lib/api";
import { liveSnapshot } from "@/lib/attendance/live";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/calismalar/[id]/durum">,
) {
  const auth = await managerOrError();
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return json({ error: "Bulunamadı." }, 404);
  const withCodes = new URL(request.url).searchParams.get("kodlar") === "1";
  const snapshot = await liveSnapshot(id, withCodes);
  return snapshot ? json(snapshot) : json({ error: "Bulunamadı." }, 404);
}
