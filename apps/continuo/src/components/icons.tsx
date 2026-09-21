export function FolderGlyph({ size = 64 }: { size?: number }) {
  const h = Math.round(size * 0.79);
  return (
    <svg width={size} height={h} viewBox="0 0 100 79" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="fld-back" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4a8ff2" /><stop offset="1" stopColor="#2f6fde" /></linearGradient>
        <linearGradient id="fld-front" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#62a9fb" /><stop offset="1" stopColor="#3b86ef" /></linearGradient>
      </defs>
      <path d="M4 14.5A6.5 6.5 0 0 1 10.5 8H40c2.6 0 5 1 6.8 2.8l2 2.1c1.7 1.8 4.1 2.8 6.6 2.8H89.5A6.5 6.5 0 0 1 96 22.2V68.5a6.5 6.5 0 0 1-6.5 6.5h-79A6.5 6.5 0 0 1 4 68.5Z" fill="url(#fld-back)" />
      <rect x="4" y="23" width="92" height="52" rx="6.5" fill="url(#fld-front)" />
      <path d="M10.5 23.6h79" stroke="#ffffff" strokeOpacity=".42" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

const TYPE_COLOR: Record<string, string> = { md: '#4f6fd8', markdown: '#4f6fd8', txt: '#727279', csv: '#39765a', xlsx: '#39765a', json: '#a1683d', pdf: '#a24444', docx: '#3a73a8', pptx: '#c26a2a', py: '#3a73a8', ts: '#3a73a8', js: '#a1683d', html: '#c26a2a' };

export function FileGlyph({ name, size = 56 }: { name: string; size?: number }) {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const color = TYPE_COLOR[ext] ?? '#8a8a91';
  const h = Math.round(size * 1.29);
  return (
    <svg width={size} height={h} viewBox="0 0 56 72" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="doc-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#f3f3f5" /></linearGradient>
      </defs>
      <path d="M8 2h28l14 14v50a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4Z" fill="url(#doc-body)" stroke="#c9c9ce" strokeWidth="1" />
      <path d="M36 2v10a4 4 0 0 0 4 4h10" fill="#e6e6ea" stroke="#c9c9ce" strokeWidth="1" strokeLinejoin="round" />
      <rect x="12" y="30" width="30" height="3" rx="1.5" fill={color} opacity=".55" />
      <rect x="12" y="38" width="32" height="3" rx="1.5" fill={color} opacity=".4" />
      <rect x="12" y="46" width="22" height="3" rx="1.5" fill={color} opacity=".4" />
      {ext && <text x="12" y="64" fontSize="10" fontWeight="600" fill={color} fontFamily="-apple-system, system-ui, sans-serif">{ext.toUpperCase().slice(0, 4)}</text>}
    </svg>
  );
}

export function fileTypeLabel(name: string, kind: 'file' | 'dir'): string {
  if (kind === 'dir') return '目录';
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const map: Record<string, string> = { md: 'Markdown', markdown: 'Markdown', txt: '文本', csv: 'CSV 表格', xlsx: 'Excel 表格', json: 'JSON', pdf: 'PDF', docx: 'Word 文档', pptx: '演示文稿', py: 'Python', ts: 'TypeScript', js: 'JavaScript', html: '网页', png: '图片', jpg: '图片', jpeg: '图片' };
  return map[ext] ?? (ext ? ext.toUpperCase() : '文件');
}
