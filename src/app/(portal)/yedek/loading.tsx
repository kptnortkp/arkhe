export default function Loading() {
  return (
    <div className="max-w-2xl space-y-6" aria-busy="true" aria-label="Yükleniyor">
      <div className="space-y-3">
        <div className="h-5 w-16 rounded bg-muted" />
        <div className="h-10 w-48 rounded-lg bg-muted" />
        <div className="h-4 w-full rounded bg-muted" />
        <div className="h-4 w-2/3 rounded bg-muted" />
      </div>
      <div className="h-24 rounded-2xl bg-muted" />
      <div className="h-48 rounded-2xl bg-muted" />
      <div className="h-40 rounded-2xl bg-muted" />
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="flex min-h-16 items-center gap-3 px-4">
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/3 rounded bg-muted" />
              <div className="h-3 w-1/2 rounded bg-muted" />
            </div>
            <div className="h-5 w-20 rounded-full bg-muted" />
          </li>
        ))}
      </ul>
    </div>
  );
}
