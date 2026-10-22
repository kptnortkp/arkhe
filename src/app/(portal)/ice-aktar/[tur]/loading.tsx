export default function Loading() {
  return (
    <div className="max-w-3xl space-y-6" aria-busy="true" aria-label="Yükleniyor">
      <div className="space-y-3">
        <div className="h-5 w-24 rounded bg-muted" />
        <div className="h-4 w-20 rounded bg-muted" />
        <div className="h-10 w-64 rounded-lg bg-muted" />
        <div className="h-4 w-full rounded bg-muted" />
      </div>
      <div className="h-44 rounded-2xl bg-muted" />
      <div className="h-56 rounded-2xl bg-muted" />
      <div className="h-72 rounded-2xl bg-muted" />
    </div>
  );
}
