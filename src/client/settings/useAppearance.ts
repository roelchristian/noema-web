import { useEffect, useState } from 'react';
import { entityTypes } from '../../shared/domain';
import { appearanceStorageKey, defaultAppearance, fontFamily, parseAppearance, pillColors, themes, resolveDisplayMode, type Appearance } from './appearance';

export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(() => {
    try { return parseAppearance(localStorage.getItem(appearanceStorageKey)); } catch { return defaultAppearance(); }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const changed = () => setSystemDark(query.matches);
    changed();
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const theme = themes.find(theme => theme.id === appearance.theme)!;
    const mode = resolveDisplayMode(appearance.mode, systemDark);
    root.dataset.mode = mode;
    root.dataset.focusedReading = String(appearance.focusedReading);
    root.style.setProperty('--font-ui', fontFamily(appearance.bodyFont));
    root.style.setProperty('--font-title', fontFamily(appearance.headingFont));
    root.style.setProperty('--accent', mode === 'dark' ? theme.darkColor : theme.color);
    root.style.setProperty('--accent-soft', mode === 'dark' ? theme.darkSoft : theme.soft);
    for (const [id, color] of Object.entries(pillColors)) {
      root.style.setProperty(`--palette-${id}-bg`, mode === 'dark' ? color.darkBackground : color.background);
      root.style.setProperty(`--palette-${id}-text`, mode === 'dark' ? color.darkText : color.text);
      root.style.setProperty(`--palette-${id}-border`, mode === 'dark' ? color.darkBorder : color.border);
    }
    for (const type of entityTypes) {
      const color = pillColors[appearance.entityColors[type]];
      root.style.setProperty(`--${type}-bg`, (mode === 'dark' ? color.darkBackground : color.background));
      root.style.setProperty(`--${type}-text`, (mode === 'dark' ? color.darkText : color.text));
      root.style.setProperty(`--${type}-border`, (mode === 'dark' ? color.darkBorder : color.border));
    }
    const overrides = document.createElement('style');
    overrides.dataset.appearance = 'entity-overrides';
    overrides.textContent = Object.entries(appearance.entityOverrides).map(([id, colorId]) => {
      const color = pillColors[colorId];
      return `.mention[data-entity="${CSS.escape(id)}"] { background: ${mode === 'dark' ? color.darkBackground : color.background}; color: ${mode === 'dark' ? color.darkText : color.text}; border-color: ${mode === 'dark' ? color.darkBorder : color.border}; }`;
    }).join('\n');
    document.head.append(overrides);
    try { localStorage.setItem(appearanceStorageKey, JSON.stringify(appearance)); setStorageError(false); }
    catch { setStorageError(true); }
    return () => overrides.remove();
  }, [appearance, systemDark]);
  return {appearance, setAppearance, storageError};
}
