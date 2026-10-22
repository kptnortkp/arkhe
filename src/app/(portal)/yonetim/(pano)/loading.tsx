export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Yükleniyor">
      <div className="flex items-end justify-between">
        <div className="h-10 w-56 rounded-lg bg-muted" />
        <div className="h-11 w-28 rounded-full bg-muted" />
      </div>
      <div className="h-11 w-72 rounded-full bg-muted" />
      <div className="h-14 rounded-2xl bg-muted xl:hidden" />
      <div className="grid gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, c) => (
          <div key={c} className={c > 0 ? "hidden space-y-3 xl:block" : "space-y-3"}>
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-32 rounded-2xl bg-muted" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
