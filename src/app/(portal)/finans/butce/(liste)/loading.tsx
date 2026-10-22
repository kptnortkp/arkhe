export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Yükleniyor">
      <div className="h-10 w-40 rounded-lg bg-muted" />
      <div className="h-11 w-full rounded-xl bg-muted" />
      <div className="h-40 rounded-2xl bg-muted" />
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="h-28 rounded-2xl bg-muted" />
      ))}
    </div>
  );
}
