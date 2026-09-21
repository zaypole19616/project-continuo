export function FolderGlyph({ size = 64 }: { size?: number }) {
  const h = Math.round(size * (366 / 475));
  return (
    <svg width={size} height={h} viewBox="0 0 475 366" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="fld-front" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#62c8f7" /><stop offset="0.5" stopColor="#7ad5fb" /><stop offset="0.88" stopColor="#70c9f2" /><stop offset="1" stopColor="#62c1ec" /></linearGradient>
        <linearGradient id="fld-back" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#97dfff" /><stop offset="1" stopColor="#8fd9fc" /></linearGradient>
      </defs>
      <path d="M0 22A22 22 0 0 1 22 0h118c12 0 20 4 27 12l18 20c6 7 13 10 23 10h245a22 22 0 0 1 22 22v280a22 22 0 0 1-22 22H22A22 22 0 0 1 0 344Z" fill="url(#fld-back)" />
      <rect x="0" y="66" width="475" height="300" rx="22" fill="url(#fld-front)" />
    </svg>
  );
}

const TYPE_COLOR: Record<string, string> = { md: '#4f6fd8', markdown: '#4f6fd8', txt: '#727279', csv: '#39765a', xlsx: '#39765a', json: '#a1683d', pdf: '#a24444', docx: '#3a73a8', pptx: '#c26a2a', py: '#3a73a8', ts: '#3a73a8', js: '#a1683d', html: '#c26a2a' };

export function FileGlyph({ name, size = 56 }: { name: string; size?: number }) {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const color = TYPE_COLOR[ext] ?? '#8a8a91';
  const h = Math.round(size * (476 / 362));
  return (
    <svg width={size} height={h} viewBox="0 0 362 476" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="doc-fold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#d9d9dd" /><stop offset="1" stopColor="#f4f4f6" /></linearGradient>
      </defs>
      <path d="M14 0H168L362 204V462a14 14 0 0 1-14 14H14a14 14 0 0 1-14-14V14A14 14 0 0 1 14 0Z" fill="#ffffff" stroke="#cfcfd4" strokeWidth="3" />
      <path d="M168 0V190a14 14 0 0 0 14 14H362Z" fill="url(#doc-fold)" stroke="#cfcfd4" strokeWidth="3" strokeLinejoin="round" />
      {ext && <text x="181" y="430" textAnchor="middle" fontSize="64" fontWeight="600" fill={color} fontFamily="-apple-system, system-ui, sans-serif">{ext.toUpperCase().slice(0, 5)}</text>}
    </svg>
  );
}

export function fileTypeLabel(name: string, kind: 'file' | 'dir'): string {
  if (kind === 'dir') return '目录';
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const map: Record<string, string> = { md: 'Markdown', markdown: 'Markdown', txt: '文本', csv: 'CSV 表格', xlsx: 'Excel 表格', json: 'JSON', pdf: 'PDF', docx: 'Word 文档', pptx: '演示文稿', py: 'Python', ts: 'TypeScript', js: 'JavaScript', html: '网页', png: '图片', jpg: '图片', jpeg: '图片' };
  return map[ext] ?? (ext ? ext.toUpperCase() : '文件');
}
