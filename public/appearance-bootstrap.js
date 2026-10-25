// Deliberately classic and parser-blocking: appearance is established before CSS
// and React can paint. Keep this same-origin file compatible with script-src 'self'.
(() => {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('noema.appearance.v1') || 'null'); }
  catch { /* Storage may be unavailable or contain a damaged preference. */ }
  let systemDark = false;
  try { systemDark = matchMedia('(prefers-color-scheme: dark)').matches; }
  catch { /* A browser without media queries uses the light fallback. */ }
  const mode = saved?.mode === 'light' || saved?.mode === 'dark' ? saved.mode : systemDark ? 'dark' : 'light';
  // These compact first-paint values are checked against appearance.ts in tests.
  const themes = {
    ink: ['#171717', '#eaeaea', '#e6e6e6', '#303030'],
    juniper: ['#2d5947', '#e8f0eb', '#a0cbb1', '#23382c'],
    atlantic: ['#315b86', '#e8eff7', '#a6c8ee', '#25374d'],
  };
  const theme = typeof saved?.theme === 'string' && Object.hasOwn(themes, saved.theme) ? themes[saved.theme] : themes.ink;
  const root = document.documentElement;
  root.dataset.mode = mode;
  root.dataset.ocsFont = String(saved?.ocsFontOverride !== false);
  root.style.setProperty('--ocs-font-scale', String([1, 1.12, 1.25].includes(saved?.ocsFontScale) ? saved.ocsFontScale : 1.12));
  root.style.colorScheme = mode;
  root.style.setProperty('--accent', theme[mode === 'dark' ? 2 : 0]);
  root.style.setProperty('--accent-soft', theme[mode === 'dark' ? 3 : 1]);
})();
