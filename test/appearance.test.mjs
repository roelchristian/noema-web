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
  assert.equal(legacy.entityColors.person, 'sage');
  assert.equal(parseAppearance('{"mode":"invalid"}').mode, 'system');
});
