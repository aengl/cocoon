/**
 * Minimal inline markdown for node descriptions (the grammar's `'?'`).
 *
 * Scope is *inline only* — we deliberately do not parse block structure
 * (paragraphs, lists, headings). The doc block already renders with
 * `white-space: pre-wrap`, so authored newlines and blank lines come through
 * untouched; this pass just makes `[text](url)`, `` `code` ``, `**bold**`,
 * and `*italic*` / `_italic_` clickable/styled.
 *
 * The reason this fits the codebase: legacy `editor.actions` mostly carried
 * `open <url>` navigation links. Under co-evolution those move into `'?'` as
 * `[label](url)`. The other action shapes (reset side-files, out-of-band
 * transforms) re-home as control buttons / real nodes, not link markup —
 * see CLAUDE.md "actions" discussion. So a *block*-level grammar would be
 * solving a problem we don't have.
 *
 * Output is a sanitised HTML string safe to drop into `{@html ...}`:
 * every text run is HTML-escaped, only the allow-listed tags (`<a>`,
 * `<code>`, `<strong>`, `<em>`) appear, and `href` is restricted to
 * `http(s):`, `mailto:`, and `file:` schemes. Anything else falls back to
 * literal text — a malformed link silently renders as the source you typed.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const esc = (s: string) => s.replace(/[&<>"']/g, c => HTML_ESCAPES[c]);

/** Allow http(s), mailto, file. Everything else (incl. `javascript:`,
 *  `data:`, schemeless) is rejected and the link is rendered as text. */
const safeUrl = (u: string): boolean =>
  /^(https?:\/\/|mailto:|file:\/\/)/i.test(u);

/** Convert one chunk of inline markdown to sanitised HTML. */
export function renderInlineMarkdown(src: string): string {
  if (!src) return '';
  // Placeholder strategy: extract each replaced span up front and stash its
  // already-rendered (and inner-escaped) HTML, leaving a NUL-delimited token
  // in its place. The remaining text is HTML-escaped at the end and the
  // tokens are re-substituted. NUL survives HTML-escape, so the boundary
  // marker can't collide with user content (which gets `&...;`-escaped).
  const slots: string[] = [];
  const stash = (html: string) => {
    const i = slots.length;
    slots.push(html);
    return `\x00${i}\x00`;
  };

  // 1. Code spans — highest priority; their content is opaque to all other
  //    inline rules (so `` `*not bold*` `` stays literal).
  let s = src.replace(
    /`([^`\n]+)`/g,
    (_, c: string) => stash(`<code>${esc(c)}</code>`),
  );

  // 2. Links `[label](url)`. A rejected scheme falls through to literal
  //    text (the source you typed, escaped). Label may itself contain
  //    already-stashed tokens (e.g. an inline code span) — those pass
  //    through verbatim because they don't match any further inline rule.
  s = s.replace(
    /\[([^\]\n]+)\]\(([^)\s]+)\)/g,
    (whole, label: string, url: string) => {
      if (!safeUrl(url)) return whole;
      return stash(
        `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`,
      );
    },
  );

  // 3. Bold `**...**` (before italic so `**x**` isn't eaten as two `*x*`).
  s = s.replace(
    /\*\*([^*\n]+)\*\*/g,
    (_, c: string) => stash(`<strong>${esc(c)}</strong>`),
  );

  // 4. Italic `*...*` and `_..._`. Lookarounds keep us off intra-word
  //    underscores (`snake_case`) and stray asterisks inside identifiers.
  s = s.replace(
    /(?<![*\w])\*([^*\n]+)\*(?!\*)/g,
    (_, c: string) => stash(`<em>${esc(c)}</em>`),
  );
  s = s.replace(
    /(?<![_\w])_([^_\n]+)_(?!\w)/g,
    (_, c: string) => stash(`<em>${esc(c)}</em>`),
  );

  // Escape everything that's still raw text, then restore the stashed HTML.
  return esc(s).replace(/\x00(\d+)\x00/g, (_, i: string) => slots[Number(i)]);
}
