export default function Loading() {
  return (
    <div className="max-w-2xl space-y-6" aria-busy="true" aria-label="Yükleniyor">
      <div className="space-y-3">
        <div className="h-5 w-24 rounded bg-muted" />
        <div className="h-10 w-64 rounded-lg bg-muted" />
        <div className="h-4 w-full rounded bg-muted" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-36 rounded-2xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
