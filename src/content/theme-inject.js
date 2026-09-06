/*
 * Injects the design-token stylesheet (theme.css) and the shared component
 * classes (injected-ui.css) into the YouTube page once per load. This only
 * declares CSS custom properties and class rules — inert, no script content,
 * no CSP impact. Both files must be listed in manifest.json's
 * web_accessible_resources so a content-script fetch() can read them.
 */

const SHEETS = [
  { id: 'tubeguard-theme-style', path: 'src/shared/theme.css' },
  { id: 'tubeguard-ui-style',    path: 'src/content/injected-ui.css' },
];

export async function injectTheme() {
  await Promise.all(SHEETS.map(injectSheet));
}

async function injectSheet({ id, path }) {
  if (document.getElementById(id)) return;

  try {
    const res = await fetch(chrome.runtime.getURL(path));
    const css = await res.text();

    if (document.getElementById(id)) return;

    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  } catch {
    // Theming is cosmetic only — never block content-script bootstrap on it.
  }
}
