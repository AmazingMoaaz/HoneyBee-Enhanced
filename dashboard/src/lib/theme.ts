// Tiny theme controller — toggles the `.dark` class on <html> and persists the
// choice. The deep-navy dark palette is defined in index.css under `html.dark`.
export type Theme = "light" | "dark";

const KEY = "hb-theme";

export function getTheme(): Theme {
  return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
}

export function applyTheme(t: Theme): void {
  document.documentElement.classList.toggle("dark", t === "dark");
}

export function setTheme(t: Theme): void {
  localStorage.setItem(KEY, t);
  applyTheme(t);
}

/** Apply the saved theme as early as possible (call before React renders). */
export function initTheme(): void {
  applyTheme(getTheme());
}
