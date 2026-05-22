/**
 * Inline markdown for node descriptions (the grammar's `?`).
 *
 * Inline-only by design: the doc block renders with `white-space: pre-wrap`,
 * so authored newlines and blank lines come through untouched; this pass just
 * makes `[text](url)`, `` `code` ``, `**bold**`, and italic clickable/styled.
 *
 * Output is sanitised HTML safe for `{@html ...}`: text is escaped, only the
 * allow-listed tags appear, `href` is restricted to http(s)/mailto/file. A
 * malformed or unsafe link silently renders as the source you typed.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const esc = (s: string) => s.replace(/[&<>"']/g, c => HTML_ESCAPES[c]);

const safeUrl = (u: string): boolean =>
  /^(https?:\/\/|mailto:|file:\/\/)/i.test(u);

export function renderInlineMarkdown(src: string): string {
  if (!src) return '';
  // Extract each rendered span up front into a slot; leave a NUL-delimited
  // token behind. The remaining text is HTML-escaped at the end and the
  // tokens are re-substituted. NUL survives HTML-escape, so the boundary
  // marker can't collide with user content (which gets `&...;`-escaped).
  const slots: string[] = [];
  const stash = (html: string) => {
    const i = slots.length;
    slots.push(html);
    return `\x00${i}\x00`;
  };

  // Code spans are highest priority — their content is opaque to all other
  // inline rules (so `` `*not bold*` `` stays literal).
  let s = src.replace(
    /`([^`\n]+)`/g,
    (_, c: string) => stash(`<code>${esc(c)}</code>`),
  );

  // A rejected scheme falls through to literal text.
  s = s.replace(
    /\[([^\]\n]+)\]\(([^)\s]+)\)/g,
    (whole, label: string, url: string) => {
      if (!safeUrl(url)) return whole;
      return stash(
        `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`,
      );
    },
  );

  // Bold before italic so `**x**` isn't eaten as two `*x*`.
  s = s.replace(
    /\*\*([^*\n]+)\*\*/g,
    (_, c: string) => stash(`<strong>${esc(c)}</strong>`),
  );

  // Lookarounds keep us off intra-word underscores (`snake_case`) and stray
  // asterisks inside identifiers.
  s = s.replace(
    /(?<![*\w])\*([^*\n]+)\*(?!\*)/g,
    (_, c: string) => stash(`<em>${esc(c)}</em>`),
  );
  s = s.replace(
    /(?<![_\w])_([^_\n]+)_(?!\w)/g,
    (_, c: string) => stash(`<em>${esc(c)}</em>`),
  );

  return esc(s).replace(/\x00(\d+)\x00/g, (_, i: string) => slots[Number(i)]);
}
