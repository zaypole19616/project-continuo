function escapeHtml(text: string): string {
  return text.replaceAll(/&/g, '&amp;').replaceAll(/</g, '&lt;').replaceAll(/>/g, '&gt;').replaceAll(/"/g, '&quot;');
}

function inline(text: string): string {
  let out = escapeHtml(text);
  out = out.replaceAll(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replaceAll(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replaceAll(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replaceAll(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return out;
}

export function renderMarkdown(source: string): string {
  const lines = source.replaceAll(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let i = 0;
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) { html.push(`<p>${inline(paragraph.join(' '))}</p>`); paragraph = []; }
  };
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.startsWith('```')) {
      flush();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) { buf.push(lines[i] ?? ''); i++; }
      i++;
      html.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) { flush(); const level = heading[1]!.length; html.push(`<h${level}>${inline(heading[2] ?? '')}</h${level}>`); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); html.push('<hr>'); i++; continue; }
    if (/^\s*>\s?/.test(line)) {
      flush();
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? '')) { buf.push((lines[i] ?? '').replace(/^\s*>\s?/, '')); i++; }
      html.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      flush();
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i] ?? '')) { rows.push(splitRow(lines[i] ?? '')); i++; }
      html.push(`<table><thead><tr>${header.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const listMatch = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (listMatch) {
      flush();
      const ordered = /\d/.test(listMatch[2] ?? '');
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i] ?? '');
        if (!m) break;
        items.push(`<li>${inline(m[3] ?? '')}</li>`);
        i++;
      }
      html.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (line.trim() === '') { flush(); i++; continue; }
    paragraph.push(line.trim());
    i++;
  }
  flush();
  return html.join('\n');
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}
