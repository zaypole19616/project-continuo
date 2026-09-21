export function FolderGlyph({ size = 64 }: { size?: number }) {
  const h = Math.round(size * 0.8);
  return (
    <svg width={size} height={h} viewBox="0 0 64 51" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="fld-back" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6db4f5" /><stop offset="1" stopColor="#4a9be8" /></linearGradient>
        <linearGradient id="fld-front" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#b3dbfb" /><stop offset="0.55" stopColor="#95cdf9" /><stop offset="1" stopColor="#7dbff5" /></linearGradient>
        <linearGradient id="fld-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#000" stopOpacity="0.16" /><stop offset="1" stopColor="#000" stopOpacity="0" /></linearGradient>
      </defs>
      <path d="M2 10.5A5.5 5.5 0 0 1 7.5 5H22c1.6 0 3 .6 4.1 1.7l1.6 1.6c1 1 2.4 1.7 3.9 1.7h25A5.5 5.5 0 0 1 62 15.5V44a5.5 5.5 0 0 1-5.5 5.5h-49A5.5 5.5 0 0 1 2 44Z" fill="url(#fld-back)" />
      <rect x="2" y="15" width="60" height="34.5" rx="5.5" fill="url(#fld-front)" />
      <rect x="2" y="15" width="60" height="6" fill="url(#fld-shade)" style={{ mixBlendMode: 'multiply' }} opacity=".35" />
      <path d="M7.5 15.5h49" stroke="#ffffff" strokeOpacity=".55" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

const TYPE_COLOR: Record<string, string> = { md: '#4f6fd8', markdown: '#4f6fd8', txt: '#727279', csv: '#39765a', xlsx: '#39765a', json: '#a1683d', pdf: '#a24444', docx: '#3a73a8', pptx: '#c26a2a', py: '#3a73a8', ts: '#3a73a8', js: '#a1683d', html: '#c26a2a' };

export function FileGlyph({ name, size = 56 }: { name: string; size?: number }) {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const color = TYPE_COLOR[ext] ?? '#8a8a91';
  const h = Math.round(size * 1.22);
  return (
    <svg width={size} height={h} viewBox="0 0 46 56" fill="none" aria-hidden="true">
      <path d="M6 2h22l12 12v36a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4Z" fill="#ffffff" stroke="#d2d2d6" />
      <path d="M28 2v10a2 2 0 0 0 2 2h10" fill="#eaeaed" stroke="#d2d2d6" />
      <rect x="9" y="24" width="24" height="2.5" rx="1" fill={color} opacity=".55" />
      <rect x="9" y="31" width="28" height="2.5" rx="1" fill={color} opacity=".4" />
      <rect x="9" y="38" width="18" height="2.5" rx="1" fill={color} opacity=".4" />
      {ext && <text x="9" y="52" fontSize="9" fontWeight="600" fill={color} fontFamily="-apple-system, system-ui, sans-serif">{ext.toUpperCase().slice(0, 4)}</text>}
    </svg>
  );
}

export function fileTypeLabel(name: string, kind: 'file' | 'dir'): string {
  if (kind === 'dir') return '目录';
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const map: Record<string, string> = { md: 'Markdown', markdown: 'Markdown', txt: '文本', csv: 'CSV 表格', xlsx: 'Excel 表格', json: 'JSON', pdf: 'PDF', docx: 'Word 文档', pptx: '演示文稿', py: 'Python', ts: 'TypeScript', js: 'JavaScript', html: '网页', png: '图片', jpg: '图片', jpeg: '图片' };
  return map[ext] ?? (ext ? ext.toUpperCase() : '文件');
}
