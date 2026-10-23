import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultAppearance, parseAppearance, pillColors, themes, resolveDisplayMode } from '../src/client/settings/appearance.ts';

test('missing, corrupt, or unsupported preferences retain safe defaults', () => {
  for (const raw of [null, '{', 'null', '42', JSON.stringify({theme: 'retired', entityColors: {person: 'toString', place: '#ffffff'}, entityOverrides: {example: 'constructor'}})]) {
    assert.deepEqual(parseAppearance(raw), defaultAppearance());
  }
  const partial = parseAppearance(JSON.stringify({theme: 'atlantic', entityColors: {person: 'sage', place: 'invalid'}}));
  assert.equal(partial.theme, 'atlantic');
  assert.equal(partial.entityColors.person, 'sage');
  assert.equal(partial.entityColors.place, 'graphite');
});

test('appearance survives serialization, including individual entity overrides', () => {
  const appearance = defaultAppearance();
  appearance.theme = 'juniper';
  appearance.mode = 'dark';
  appearance.citationStyleExplicit = true;
  appearance.presentationMode = 'subtle';
  appearance.entityColors.person = 'ocean';
  appearance.entityOverrides['entity-a'] = 'rose';
  assert.deepEqual(parseAppearance(JSON.stringify(appearance)), appearance);
  assert.deepEqual(defaultAppearance().entityOverrides, {});
});

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function contrast(a, b) { const values = [luminance(a), luminance(b)].sort((a, b) => b - a); return (values[0] + .05) / (values[1] + .05); }
test('all pill palettes and theme accents have readable text contrast', () => {
  for (const color of Object.values(pillColors)) {
    assert.ok(contrast(color.text, color.background) >= 4.5, color.name);
    assert.ok(contrast(color.darkText, color.darkBackground) >= 4.5, color.name + ' dark');
  }
  for (const theme of themes) {
    assert.ok(contrast(theme.color, '#ffffff') >= 4.5, theme.name + ' button');
    assert.ok(contrast(theme.color, theme.soft) >= 4.5, theme.name + ' selection');
    assert.ok(contrast(theme.darkColor, '#19191b') >= 4.5, theme.name + ' dark button');
    assert.ok(contrast(theme.darkColor, theme.darkSoft) >= 4.5, theme.name + ' dark selection');
  }
});

test('system appearance follows the computer while explicit choices take priority', () => {
  assert.equal(resolveDisplayMode('system', true), 'dark');
  assert.equal(resolveDisplayMode('system', false), 'light');
  assert.equal(resolveDisplayMode('light', true), 'light');
  assert.equal(resolveDisplayMode('dark', false), 'dark');
  const legacy = parseAppearance(JSON.stringify({theme: 'juniper', entityColors: {person: 'sage'}}));
  assert.equal(legacy.mode, 'system');
  assert.equal(legacy.presentationMode, 'standard');
  assert.equal(parseAppearance('{"focusedReading":"true"}').presentationMode, 'standard');
  assert.equal(legacy.entityColors.person, 'sage');
  assert.equal(parseAppearance('{"mode":"invalid"}').mode, 'system');
});

test('presentation migrates legacy values, validates modes and separates emphasis from layout', async () => {
  const {presentationTraits} = await import('../src/client/settings/appearance.ts');
  assert.equal(parseAppearance('{"focusedReading":true,"theme":"juniper"}').presentationMode, 'subtle');
  assert.equal(parseAppearance('{"focusedReading":false}').presentationMode, 'standard');
  assert.equal(parseAppearance('{"focusedReading":true,"presentationMode":"standard"}').presentationMode, 'standard');
  assert.equal(parseAppearance('{"presentationMode":"invalid"}').presentationMode, 'standard');
  for (const mode of ['standard', 'subtle', 'focus']) {
    const parsed = parseAppearance(JSON.stringify({...defaultAppearance(), presentationMode: mode}));
    assert.equal(parsed.presentationMode, mode);
    assert.equal(Object.hasOwn(parsed, 'focusedReading'), false);
    assert.deepEqual(presentationTraits(mode), {entityEmphasis: mode === 'standard' ? 'normal' : 'subtle', workspaceVisibility: mode === 'focus' ? 'minimal' : 'full'});
  }
});

test('paragraph indent preferences default safely and persist all supported modes and widths', () => {
  assert.equal(defaultAppearance().paragraphIndent, 'none');
  assert.equal(defaultAppearance().paragraphIndentWidth, 'medium');
  assert.equal(defaultAppearance().paragraphSpacing, 'standard');
  for (const paragraphIndent of ['none', 'all', 'except-first']) {
    for (const paragraphIndentWidth of ['small', 'medium', 'large']) {
      for (const paragraphSpacing of ['standard', 'book']) {
        const appearance = {...defaultAppearance(), citationStyleExplicit:true, paragraphIndent, paragraphIndentWidth, paragraphSpacing};
        assert.deepEqual(parseAppearance(JSON.stringify(appearance)), appearance);
      }
    }
  }
  for (const invalid of ['retired', 'constructor', null, 2, {}]) {
    const parsed = parseAppearance(JSON.stringify({paragraphIndent:invalid, paragraphIndentWidth:invalid, paragraphSpacing:invalid}));
    assert.equal(parsed.paragraphIndent, 'none');
    assert.equal(parsed.paragraphIndentWidth, 'medium');
    assert.equal(parsed.paragraphSpacing, 'standard');
  }
});

test('saved indentation modes apply to the document and persist through appearance updates',async()=>{
 const {setupDOM}=await import('./helpers/dom.mjs'),{act,createElement}=await import('react'),{createRoot}=await import('react-dom/client');
 const {useAppearance}=await import('../src/client/settings/useAppearance.ts');
 const env=setupDOM(),previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 env.defer(()=>{if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;});
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:env.dom.window.localStorage});
 localStorage.setItem('noema.appearance.v1',JSON.stringify({...defaultAppearance(),paragraphIndent:'except-first',paragraphIndentWidth:'large',paragraphSpacing:'book',mode:'dark'}));
 let controls;const root=createRoot(document.querySelector('#mount'));env.defer(()=>act(async()=>root.unmount()));
 function App(){controls=useAppearance();return null;}
 try{
  await act(async()=>root.render(createElement(App)));
  const html=document.documentElement;
  assert.equal(html.dataset.mode,'dark');assert.equal(html.dataset.paragraphIndent,'except-first');assert.equal(html.dataset.paragraphSpacing,'book');assert.equal(html.style.getPropertyValue('--paragraph-indent-width'),'2em');
  for(const mode of ['none','all','except-first'])await act(async()=>{
   controls.setAppearance(current=>({...current,paragraphIndent:mode,paragraphIndentWidth:'small',mode:'light'}));
  });
  assert.equal(html.dataset.mode,'light');assert.equal(html.dataset.paragraphIndent,'except-first');assert.equal(html.style.getPropertyValue('--paragraph-indent-width'),'1em');
  const saved=parseAppearance(localStorage.getItem('noema.appearance.v1'));assert.equal(saved.paragraphIndent,'except-first');assert.equal(saved.paragraphSpacing,'book');assert.equal(saved.paragraphIndentWidth,'small');
 }finally{await env.close();}
});
