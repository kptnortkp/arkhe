"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";

type Guard = { dirty: boolean; setDirty: (d: boolean) => void; ask: (href: string) => void };
const GuardContext = createContext<Guard>({ dirty: false, setDirty: () => {}, ask: () => {} });

/** D41: leaving the review page with unsaved text asks first (Sonraki and the back link only). */
export function ReviewGuard({ title, children }: { title: string; children: React.ReactNode }) {
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  return (
    <GuardContext.Provider value={{ dirty, setDirty, ask: setTarget }}>
      {children}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(o) => !o && setTarget(null)}
        title={title}
        description="Yazdıkların kaybolur."
        cancelLabel="Kal"
        cancelVariant="default"
        actions={[
          {
            label: "Geç",
            variant: "outline",
            className: "text-absent-ink",
            run: () => {
              const href = target;
              setTarget(null);
              setDirty(false);
              if (href) router.push(href);
            },
          },
        ]}
      />
    </GuardContext.Provider>
  );
}

export function useReviewDirty(dirty: boolean) {
  const { setDirty } = useContext(GuardContext);
  useEffect(() => setDirty(dirty), [dirty, setDirty]);
}

export function GuardedLink({
  href,
  ...props
}: React.ComponentProps<typeof Link> & { href: string }) {
  const { dirty, ask } = useContext(GuardContext);
  return (
    <Link
      href={href}
      {...props}
      onClick={(e) => {
        if (!dirty) return;
        e.preventDefault();
        ask(href);
      }}
    />
  );
}
