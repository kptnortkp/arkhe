export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl animate-pulse space-y-5" aria-busy="true">
      <div className="h-10 w-40 rounded-xl bg-muted" />
      <div className="flex gap-2">
        <div className="h-11 w-36 rounded-full bg-muted" />
        <div className="h-11 w-32 rounded-full bg-muted" />
      </div>
      {[0, 1].map((g) => (
        <div key={g} className="space-y-2">
          <div className="h-4 w-1/2 rounded bg-muted" />
          <div className="divide-y rounded-2xl border bg-card">
            {[0, 1, 2].map((r) => (
              <div key={r} className="space-y-2 px-4 py-3">
                <div className="h-4 w-1/3 rounded bg-muted" />
                <div className="h-3 w-1/4 rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
