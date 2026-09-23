export function Hint({ title, children }: { title: string | undefined; children: React.ReactNode }) {
  return <span className="inline-flex" title={title}>{children}</span>;
}
