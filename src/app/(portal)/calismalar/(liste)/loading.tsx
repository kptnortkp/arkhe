export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Yükleniyor">
      <div className="flex items-end justify-between gap-4">
        <div className="h-10 w-48 rounded-lg bg-muted" />
        <div className="h-10 w-28 rounded-full bg-muted" />
      </div>
      <div className="flex gap-2">
        <div className="h-10 w-24 rounded-full bg-muted" />
        <div className="h-10 w-24 rounded-full bg-muted" />
      </div>
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i} className="flex min-h-20 items-center gap-4 px-4 py-3">
            <div className="h-[76px] w-14 shrink-0 rounded-2xl bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 rounded bg-muted" />
              <div className="h-3 w-1/2 rounded bg-muted" />
              <div className="h-5 w-16 rounded-full bg-muted" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
