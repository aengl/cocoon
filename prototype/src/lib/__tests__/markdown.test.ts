/**
 * Inline-markdown rendering for the node description (`'?'`).
 *
 * Lives in `markdown.ts`. The scope is deliberately tiny — links / inline
 * code / bold / italic — and the output is the sanitised HTML string the
 * CocoonNode template drops into `{@html ...}`, so each test pins the
 * exact emitted markup (escaping, attributes, fallback behaviour).
 */
import { describe, expect, it } from 'vitest';
import { renderInlineMarkdown as md } from '../markdown';

describe('renderInlineMarkdown', () => {
  it('passes plain text through HTML-escaped', () => {
    expect(md('a < b & "c"')).toBe('a &lt; b &amp; &quot;c&quot;');
  });

  it('renders http/https links with safe attrs', () => {
    expect(md('see [docs](https://example.com/x)')).toBe(
      'see <a href="https://example.com/x" target="_blank" rel="noopener noreferrer">docs</a>',
    );
    expect(md('[a](http://a.b)')).toContain('href="http://a.b"');
  });

  it('allows mailto: and file:// schemes', () => {
    expect(md('[mail](mailto:x@y.z)')).toContain('href="mailto:x@y.z"');
    expect(md('[here](file:///tmp/x)')).toContain('href="file:///tmp/x"');
  });

  it('rejects javascript: and other unsafe schemes, keeping literal text', () => {
    expect(md('[x](javascript:alert(1))')).toBe(
      '[x](javascript:alert(1))',
    );
    expect(md('[x](data:text/html,foo)')).toBe('[x](data:text/html,foo)');
    // schemeless relative URLs are also rejected (no useful browser meaning)
    expect(md('[x](./local)')).toBe('[x](./local)');
  });

  it('escapes link labels and hrefs', () => {
    expect(md('[<b>](https://x.test/?a=1&b=2)')).toBe(
      '<a href="https://x.test/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">&lt;b&gt;</a>',
    );
  });

  it('renders inline code, opaque to other inline rules', () => {
    expect(md('use `*literal*` here')).toBe(
      'use <code>*literal*</code> here',
    );
    expect(md('`a < b`')).toBe('<code>a &lt; b</code>');
  });

  it('renders bold and italic, preferring bold over nested italic', () => {
    expect(md('a **bold** b')).toBe('a <strong>bold</strong> b');
    expect(md('a *it* b')).toBe('a <em>it</em> b');
    expect(md('a _it_ b')).toBe('a <em>it</em> b');
  });

  it('does not italicise inside identifiers', () => {
    // intra-word underscores are common in snake_case / cocoon URIs
    expect(md('snake_case_name')).toBe('snake_case_name');
    // a stray asterisk inside a word should not start an italic span
    expect(md('a*b*c')).toBe('a*b*c');
  });

  it('preserves newlines (block layout is the .doc rule, not markdown)', () => {
    // pre-wrap on the host element handles the visual wrapping; the parser
    // just leaves the \n alone, including across an inline span.
    expect(md('one\ntwo')).toBe('one\ntwo');
    expect(md('a **b**\nc')).toBe('a <strong>b</strong>\nc');
  });

  it('does not interpret HTML in the source', () => {
    expect(md('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    // A link rendered inside escaped HTML stays correctly attributed.
    expect(md('<b>[x](https://y.test)</b>')).toBe(
      '&lt;b&gt;<a href="https://y.test" target="_blank" rel="noopener noreferrer">x</a>&lt;/b&gt;',
    );
  });

  it('handles empty input', () => {
    expect(md('')).toBe('');
  });
});
