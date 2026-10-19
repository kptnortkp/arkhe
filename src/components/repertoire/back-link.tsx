"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

const KEY = "arkhe:repertoire-list";

/** Remembers the list URL (filters, search) so the detail page's back link returns to it. */
export function ListMemory() {
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, location.pathname + location.search);
    } catch {}
  });
  return null;
}

export function BackLink() {
  const [href, setHref] = useState("/repertuvar");
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage only exists after mount
      if (stored?.startsWith("/repertuvar")) setHref(stored);
    } catch {}
  }, []);
  return (
    <Link
      href={href}
      className="-ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      Repertuvar
    </Link>
  );
}
