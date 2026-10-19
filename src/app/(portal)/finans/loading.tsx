export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Yükleniyor">
      <div className="h-10 w-48 rounded-lg bg-muted" />
      <div className="h-11 w-full rounded-xl bg-muted" />
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 h-28 rounded-3xl bg-muted" />
        <div className="h-24 rounded-2xl bg-muted" />
        <div className="h-24 rounded-2xl bg-muted" />
      </div>
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="flex min-h-16 items-center gap-3 px-4">
            <div className="size-9 rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 rounded bg-muted" />
              <div className="h-3 w-1/3 rounded bg-muted" />
            </div>
            <div className="h-4 w-20 rounded bg-muted" />
          </li>
        ))}
      </ul>
    </div>
  );
}
