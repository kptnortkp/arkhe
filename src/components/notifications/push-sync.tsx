"use client";

import { useEffect } from "react";
import { resyncPush } from "./push-client";

/** Re-registers this browser's granted subscription if the server lost it (at most daily). */
export function PushSync({ userId }: { userId: string }) {
  useEffect(() => {
    void resyncPush(userId).catch(() => undefined);
  }, [userId]);
  return null;
}
