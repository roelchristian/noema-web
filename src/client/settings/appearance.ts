import type {CitationStyle} from '../../shared/citations';
import { entityTypes, type EntityType } from '../../shared/domain';

const systemFont = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif';
export const fontOptions = [
  {id: 'system', name: 'System', family: systemFont},
  {id: 'geist', name: 'Geist', family: `Geist, ${systemFont}`},
  {id: 'inter', name: 'Inter', family: `Inter, ${systemFont}`},
  {id: 'dm-sans', name: 'DM Sans', family: `"DM Sans", ${systemFont}`},
  {id: 'manrope', name: 'Manrope', family: `Manrope, ${systemFont}`},
  {id: 'public-sans', name: 'Public Sans', family: `"Public Sans", ${systemFont}`},
  {id: 'plus-jakarta-sans', name: 'Plus Jakarta Sans', family: `"Plus Jakarta Sans", ${systemFont}`},
  {id: 'ibm-plex-mono', name: 'IBM Plex Mono', family: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'},
  {id: 'ibm-plex-sans', name: 'IBM Plex Sans', family: `"IBM Plex Sans", ${systemFont}`},
] as const;
export type FontId = typeof fontOptions[number]['id'];
export function fontFamily(id: FontId): string {
  return fontOptions.find(font => font.id === id)?.family ?? systemFont;
}

export const themes = [
  {id: 'ink', name: 'Midnight Ink', color: '#171717', soft: '#eaeaea', darkColor: '#e6e6e6', darkSoft: '#303030', description: 'Quiet, classic black'},
  {id: 'juniper', name: 'Juniper', color: '#2d5947', soft: '#e8f0eb', darkColor: '#a0cbb1', darkSoft: '#23382c', description: 'Grounded forest green'},
  {id: 'atlantic', name: 'Atlantic', color: '#315b86', soft: '#e8eff7', darkColor: '#a6c8ee', darkSoft: '#25374d', description: 'Deep, considered blue'},
] as const;
export const displayModes = ['light', 'dark', 'system'] as const;
export type DisplayMode = typeof displayModes[number];
export function resolveDisplayMode(mode: DisplayMode, systemDark: boolean): 'light' | 'dark' {
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
}
export type ThemeId = typeof themes[number]['id'];

// Dark text on pale backgrounds keeps mentions readable within a paragraph.
export const pillColors = {
  graphite: {name: 'Graphite', background: '#f0f0f0', text: '#333333', border: '#d9d9d9', darkBackground: '#303033', darkText: '#dedee3', darkBorder: '#4b4b51'},
  sage: {name: 'Sage', background: '#eaf2e9', text: '#35563c', border: '#ccdcca', darkBackground: '#263a2c', darkText: '#b9dbbe', darkBorder: '#45654d'},
  ocean: {name: 'Ocean', background: '#eaf1fa', text: '#305580', border: '#cedded', darkBackground: '#27374c', darkText: '#bed6f5', darkBorder: '#435e7e'},
  iris: {name: 'Iris', background: '#f0ecf8', text: '#614580', border: '#ddd2ec', darkBackground: '#392e48', darkText: '#dac6ef', darkBorder: '#5f4b77'},
  rose: {name: 'Rose', background: '#faecef', text: '#884358', border: '#eed1da', darkBackground: '#482e38', darkText: '#efc1cf', darkBorder: '#784c5d'},
  honey: {name: 'Honey', background: '#faf2df', text: '#77551e', border: '#e9d9b4', darkBackground: '#423722', darkText: '#ead39d', darkBorder: '#6c5a37'},
} as const;
export type PillColor = keyof typeof pillColors;
export const presentationModes = ['standard', 'subtle', 'focus'] as const;
export type PresentationMode = typeof presentationModes[number];
export function presentationTraits(mode: PresentationMode) {
  return {entityEmphasis: mode === 'standard' ? 'normal' : 'subtle', workspaceVisibility: mode === 'focus' ? 'minimal' : 'full'} as const;
}
export const paragraphIndentModes = ['none', 'all', 'except-first'] as const;
export type ParagraphIndentMode = typeof paragraphIndentModes[number];
export const paragraphIndentWidths = {small: '1em', medium: '1.5em', large: '2em'} as const;
export type ParagraphIndentWidth = keyof typeof paragraphIndentWidths;
export const paragraphSpacingOptions = ['standard', 'book'] as const;
export type ParagraphSpacing = typeof paragraphSpacingOptions[number];
export interface Appearance { paragraphSpacing: ParagraphSpacing; paragraphIndent: ParagraphIndentMode; paragraphIndentWidth: ParagraphIndentWidth; citationStyleExplicit:boolean; citationStyle:CitationStyle; bodyFont: FontId; headingFont: FontId; presentationMode: PresentationMode; mode: DisplayMode; theme: ThemeId; entityColors: Record<EntityType, PillColor>; entityOverrides: Record<string, PillColor> }
export const appearanceStorageKey = 'noema.appearance.v1';
export function defaultAppearance(): Appearance {
  return {paragraphSpacing:'standard', paragraphIndent:'none', paragraphIndentWidth:'medium', citationStyleExplicit:false,citationStyle:'references',bodyFont: 'system', headingFont: 'geist', presentationMode: 'standard', mode: 'system', theme: 'ink', entityOverrides: {}, entityColors: Object.fromEntries(entityTypes.map(type => [type, 'graphite'])) as Appearance['entityColors']};
}
export function parseAppearance(raw: string | null): Appearance {
  const result = defaultAppearance();
  try {
    const value = JSON.parse(raw || 'null');
    if (!value || typeof value !== 'object') return result;
    if (paragraphSpacingOptions.includes(value.paragraphSpacing)) result.paragraphSpacing = value.paragraphSpacing;
    if (paragraphIndentModes.includes(value.paragraphIndent)) result.paragraphIndent = value.paragraphIndent;
    if (typeof value.paragraphIndentWidth === 'string' && Object.hasOwn(paragraphIndentWidths, value.paragraphIndentWidth)) result.paragraphIndentWidth = value.paragraphIndentWidth;
    if (fontOptions.some(font => font.id === value.bodyFont)) result.bodyFont = value.bodyFont;
    if (fontOptions.some(font => font.id === value.headingFont)) result.headingFont = value.headingFont;
    // Earlier versions saved the inline default automatically. Only retain an explicit choice.
    if ((value.citationStyleExplicit===true||value.citationStyle==='references')&&(value.citationStyle==='inline'||value.citationStyle==='references')) {
      result.citationStyle=value.citationStyle;result.citationStyleExplicit=true;
    }
    // Read the old preference once; the validated presentation mode is the only written choice.
    result.presentationMode = presentationModes.includes(value.presentationMode) ? value.presentationMode : value.focusedReading === true ? 'subtle' : 'standard';
    if (displayModes.includes(value.mode)) result.mode = value.mode;
    if (themes.some(theme => theme.id === value.theme)) result.theme = value.theme;
    for (const type of entityTypes) {
      const color = value.entityColors?.[type];
      if (typeof color === 'string' && Object.hasOwn(pillColors, color)) result.entityColors[type] = color as PillColor;
    }
    if (value.entityOverrides && typeof value.entityOverrides === 'object') {
      for (const [id, color] of Object.entries(value.entityOverrides)) {
        if (typeof color === 'string' && Object.hasOwn(pillColors, color)) {
          Object.defineProperty(result.entityOverrides, id, {value: color, enumerable: true, configurable: true, writable: true});
        }
      }
    }
  } catch { /* Invalid or older preferences fall back to the defaults. */ }
  return result;
}
