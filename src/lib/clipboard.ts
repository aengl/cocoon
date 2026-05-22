/**
 * `navigator.clipboard` is async + permissioned; the execCommand path keeps
 * copy working when the page is iframed without the clipboard permission.
 */
export function copyToClipboard(text: string): void {
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } finally {
      document.body.removeChild(ta);
    }
  };
  if (navigator.clipboard?.writeText)
    navigator.clipboard.writeText(text).catch(fallback);
  else fallback();
}
