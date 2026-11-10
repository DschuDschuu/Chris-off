// Kleine Markdown-Erweiterung für die Einträge:
//  [[Lied 2]]            -> Liedwechsel-Marke (2. Lied aus der Liederliste)
//  ![Unterschrift](bild) -> allein stehendes Bild wird zu <figure> mit Bildunterschrift
//  externe Links         -> öffnen sich im Bilderrahmen-Fenster
const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function walk(node, fn) {
  if (!node.children) return;
  for (let i = 0; i < node.children.length; i++) {
    const r = fn(node.children[i], i, node);
    if (r === 'skip') continue;
    walk(node.children[i], fn);
  }
}

export default function remarkTagebuch() {
  return (tree, file) => {
    const fm = (file.data && file.data.astro && file.data.astro.frontmatter) || {};
    const lieder = Array.isArray(fm.lieder) ? fm.lieder : [];
    walk(tree, (node, i, parent) => {
      if (node.type === 'paragraph' && node.children.length === 1) {
        const c = node.children[0];
        if (c.type === 'text') {
          const m = c.value.trim().match(/^\[\[\s*lied\s*(\d+)\s*\]\]$/i);
          if (m) {
            const n = Number(m[1]) - 1;
            const l = lieder[n] || {};
            parent.children[i] = { type: 'html', value: `<div class="liedwechsel" data-lied="${n}">♪ Liedwechsel ab hier${l.titel ? ' · ' + esc(l.titel) : ''}</div>` };
            return 'skip';
          }
        }
        if (c.type === 'image') {
          parent.children[i] = { type: 'html', value: `<figure><img src="${esc(c.url)}" alt="${esc(c.alt)}" loading="lazy" decoding="async">${c.alt ? `<figcaption>${esc(c.alt)}</figcaption>` : ''}</figure>` };
          return 'skip';
        }
      }
      if (node.type === 'link' && /^https?:\/\//.test(node.url)) {
        node.data = node.data || {};
        node.data.hProperties = { ...(node.data.hProperties || {}), 'data-rahmen': '', rel: 'noopener', target: '_blank' };
      }
    });
  };
}
