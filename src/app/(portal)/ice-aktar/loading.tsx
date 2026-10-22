export default function Loading() {
  return (
    <div className="max-w-2xl space-y-6" aria-busy="true" aria-label="Yükleniyor">
      <div className="space-y-3">
        <div className="h-5 w-16 rounded bg-muted" />
        <div className="h-10 w-56 rounded-lg bg-muted" />
        <div className="h-4 w-full rounded bg-muted" />
        <div className="h-4 w-2/3 rounded bg-muted" />
      </div>
      <div className="h-48 rounded-2xl bg-muted" />
      <div className="space-y-2">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="h-20 rounded-2xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
