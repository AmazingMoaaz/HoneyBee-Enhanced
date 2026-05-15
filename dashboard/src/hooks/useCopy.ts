/**
 * copyToClipboard — works in both secure (HTTPS/localhost) and non-secure
 * (plain HTTP LAN) contexts.
 *
 * navigator.clipboard.writeText is only available in secure contexts.  When
 * it is not available (e.g. http://10.10.10.2:5300) we fall back to the
 * legacy execCommand("copy") approach using a temporary textarea.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for non-secure (plain HTTP) contexts
  const el = document.createElement("textarea");
  el.value = text;
  el.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0";
  document.body.appendChild(el);
  el.focus();
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
}
