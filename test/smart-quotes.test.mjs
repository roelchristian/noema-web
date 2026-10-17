import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smartenTypedQuotes } from '../src/client/editor/smart-quotes.ts';
const type = input => [...input].reduce((text, char) => smartenTypedQuotes(text + char, text.length + char.length, char, 'insertText'), '');

test('typing pairs double/single quotes and uses curly apostrophes in contractions', () => {
  assert.equal(type('She said "hello" and \'goodbye\'.'), 'She said “hello” and ‘goodbye’.');
  assert.equal(type("Don't change John's notes."), 'Don’t change John’s notes.');
  assert.equal(type('("Hello!")'), '(“Hello!”)');
  assert.equal(type('"She said \'hello\'."'), '“She said ‘hello’.”');
});

test('only newly typed quotes change; insertion context works in the middle of text', () => {
  const original = 'Old "quotes" and ';
  assert.equal(smartenTypedQuotes(original + '"', original.length + 1, '"', 'insertText'), original + '“');
  const beforeWord = 'Some "word';
  assert.equal(smartenTypedQuotes(beforeWord, 6, '"', 'insertText'), 'Some “word');
  const afterWord = 'Some “word" here';
  assert.equal(smartenTypedQuotes(afterWord, 11, '"', 'insertText'), 'Some “word” here');
});

test('paste, undo/redo, IME composition and existing curly quotes remain untouched', () => {
  const text = '"literal"';
  for (const inputType of ['insertFromPaste', 'historyUndo', 'historyRedo', 'insertCompositionText']) {
    assert.equal(smartenTypedQuotes(text, text.length, text, inputType), text);
  }
  assert.equal(smartenTypedQuotes(text, text.length, text, 'insertText', true), text);
  assert.equal(smartenTypedQuotes('“curly”', 7, '”', 'insertText'), '“curly”');
  assert.equal(smartenTypedQuotes('plain', 5, null, 'insertText'), 'plain');
});

test('quotes in typed code, inline math, LaTeX delimiters and escapes stay literal', () => {
  assert.equal(type('`const name = "Ada";` then "hello"'), '`const name = "Ada";` then “hello”');
  assert.equal(type('$f\'(x)$ then "hello"'), '$f\'(x)$ then “hello”');
  assert.equal(type('\\(f\'(x)\\) then "hello"'), '\\(f\'(x)\\) then “hello”');
  assert.equal(type('\\[f\'(x)\\] then "hello"'), '\\[f\'(x)\\] then “hello”');
  assert.equal(type('\\"literal\\"'), '\\"literal\\"');
});
