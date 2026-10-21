import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {Page} from '../../shared/domain';
import {captureEditorSelection, restoreEditorSelection, type EditorHistorySelection} from './history-selection';
import {pauseEntityRecognition, resumeEntityRecognition} from './auto-entity-matching';

type DocumentState = Pick<Page, 'title' | 'blocks' | 'featuredImageId'>;
type DocumentPatch = Partial<Pick<Page, 'title' | 'blocks' | 'sourceIds' | 'icon' | 'featuredImageId'>>;
type Selection = EditorHistorySelection | null;
interface InputRun {type: string; host: Element | null; composition: number; time: number}
interface Transaction {
  before: DocumentState; after: DocumentState;
  beforeSelection: Selection; afterSelection: Selection;
  run: InputRun | null;
}
interface History {
  key: string; current: DocumentState | null; currentSignature: string; observed: string;
  past: Transaction[]; future: Transaction[];
  selection: Selection; input: {run: InputRun | null; selection: Selection} | null;
  composing: boolean; compositionEnding: boolean; composition: number; batch: Transaction | null;
  captureAfter: Transaction | null;
  restore: {selection: Selection} | null;
}
const clone = <T,>(value: T): T => structuredClone(value);
const signature = (value: unknown) => JSON.stringify(value);
function documentState(page: Page): DocumentState {
  return {title: page.title, blocks: page.blocks, featuredImageId: page.featuredImageId ?? null};
}
// Snapshots are private: never mutate them or pass them to an external caller.
// Transactions may share these references; ingress and egress stay detached.
function snapshot(page: Page): DocumentState {
  return clone(documentState(page));
}
function emptyHistory(page: Page | null): History {
  const current = page ? snapshot(page) : null;
  const currentSignature = signature(current);
  return {key: page ? `${page.vault_id}:${page.id}` : '', current, currentSignature, observed: currentSignature, past: [], future: [], selection: null, input: null, composing: false, compositionEnding: false, composition: 0, batch: null, captureAfter: null, restore: null};
}
const rootElement = () => document.querySelector<HTMLElement>('article.page');
const capture = (): Selection => {const root = rootElement(); return root ? captureEditorSelection(root) : null;};
function documentTarget(target: EventTarget | null): target is Element {
  return target instanceof Element && !target.closest('[role="dialog"],dialog') && !!target.closest('article.page') && !!target.closest('#blocks,#page-title');
}
function shape(state: DocumentState) {
  return signature(state.blocks.map(block => [block.id, block.type, block.column, block.semantic, block.semanticGroup, block.rows?.map(row => row.length)]));
}
function typingType(type: string) {
  return type === 'insertText' || type === 'deleteContentBackward' || type === 'deleteContentForward' || type === 'insertCompositionText' || type === 'deleteCompositionText' || type === 'insertFromComposition';
}
/** The trailing empty editable row exists in the DOM before it is first saved. */
function withSelectionBlock(state: DocumentState, selection: Selection): DocumentState {
  if (selection?.kind === 'title') return state;
  const rows = rootElement()?.querySelectorAll<HTMLElement>('[data-block-id].paragraph');
  // Include the next virtual tail as well as the selected row: persisting it
  // during the next keystroke must not split an otherwise continuous run.
  const extras = Array.from(rows ?? []).filter(row => !state.blocks.some(block => block.id === row.dataset.blockId)).map(row => ({id: row.dataset.blockId!, type: 'paragraph' as const, checked: false, content: []}));
  return extras.length ? {...state, blocks: [...state.blocks, ...extras]} : state;
}

/** User edits, including native contenteditable input, share one document timeline. */
export function useDocumentHistory(page: Page | null, onChange: (patch: DocumentPatch) => void, disabled = false) {
  const history = useRef<History>(emptyHistory(null));
  const latest = useRef({page, onChange, disabled}); latest.current = {page, onChange, disabled};
  const [, refresh] = useState(0);
  const key = page ? `${page.vault_id}:${page.id}` : '';
  if (history.current.key !== key) {history.current = emptyHistory(page); resumeEntityRecognition();}

  useLayoutEffect(() => {
    const state = history.current;
    const incoming = page ? documentState(page) : null;
    const serialized = signature(incoming);
    if (serialized !== state.observed) {
      state.observed = serialized;
      if (state.currentSignature !== serialized) {
        // Recognition and server metadata reconciliation are part of the latest
        // state, not a new user action. They also end an active typing run.
        state.current = clone(incoming);
        state.currentSignature = serialized;
        const last = state.past.at(-1);
        if (last && state.current) {last.after = state.current; last.run = null;}
        state.batch = null; state.input = null;
      }
    }
    if (state.restore) {
      const root = rootElement();
      if (root) restoreEditorSelection(root, state.restore.selection);
      state.selection = state.restore.selection;
      state.restore = null;
    } else {
      const selection = capture();
      if (selection) {
        state.selection = selection;
        if (state.captureAfter && state.captureAfter.after === state.current) state.captureAfter.afterSelection = clone(selection);
      }
    }
    state.captureAfter = null;
  });

  const change = useCallback((patch: DocumentPatch) => {
    const state = history.current;
    if (!state.current || latest.current.page?.editLocked || latest.current.disabled) return;
    const candidate = documentState({...latest.current.page!, ...state.current, ...patch});
    // Compare every tracked field, including nested metadata. External block
    // references are mutable and cannot safely serve as an equality shortcut.
    const serialized = signature(candidate);
    if (serialized === state.currentSignature) {latest.current.onChange(patch); return;}
    const after = clone(candidate);
    resumeEntityRecognition();
    const beforeSelection = state.input?.selection ?? state.selection ?? capture();
    const before = withSelectionBlock(state.current, beforeSelection);
    const input = state.input?.run ?? null;
    const run = input && typingType(input.type) && shape(before) === shape(after) && before.featuredImageId === after.featuredImageId ? {...input, time: Date.now()} : null;
    const last = state.past.at(-1);
    const contiguous = !!last?.run && !!run && last.run.host === run.host && (
      run.composition ? last.run.composition === run.composition : !last.run.composition && last.run.type === run.type && run.time - last.run.time <= 1000 && signature(last.afterSelection) === signature(beforeSelection)
    );
    // execCommand can emit input before the explicit formatting commit. Both
    // synchronous writes belong to the same transaction.
    if (last && (state.batch === last || contiguous)) {
      last.after = after; last.run = run;
    } else {
      state.past.push({before, after, beforeSelection: clone(beforeSelection), afterSelection: capture() ?? clone(beforeSelection), run});
      if (state.past.length > 100) state.past.shift();
    }
    state.current = after; state.currentSignature = serialized; state.future = [];
    const transaction = state.past.at(-1)!;
    state.batch = transaction;
    state.captureAfter = transaction;
    queueMicrotask(() => {if (history.current === state && state.batch === transaction) state.batch = null;});
    latest.current.onChange(clone(patch));
    refresh(value => value + 1);
  }, []);

  const travel = useCallback((direction: 'undo' | 'redo') => {
    const state = history.current;
    if (!state.current || latest.current.page?.editLocked || latest.current.disabled) return;
    const source = direction === 'undo' ? state.past : state.future;
    const destination = direction === 'undo' ? state.future : state.past;
    const transaction = source.pop();
    if (!transaction) return;
    pauseEntityRecognition();
    document.dispatchEvent(new Event('noema:history-restore'));
    destination.push(transaction);
    state.current = direction === 'undo' ? transaction.before : transaction.after;
    state.currentSignature = signature(state.current);
    state.restore = {selection: clone(direction === 'undo' ? transaction.beforeSelection : transaction.afterSelection)};
    state.input = null; state.batch = null; state.captureAfter = null;
    const last = state.past.at(-1); if (last) last.run = null;
    latest.current.onChange(clone(state.current));
    refresh(value => value + 1);
  }, []);
  const undo = useCallback(() => travel('undo'), [travel]);
  const redo = useCallback(() => travel('redo'), [travel]);

  useEffect(() => {
    if (!key) return;
    function remember() {
      const selection = capture();
      if (selection) history.current.selection = selection;
    }
    function begin(event: Event) {
      if (event.target instanceof Element && event.target.closest<HTMLElement>('#blocks')?.dataset.formattingTransaction) return;
      const state = history.current;
      remember();
      const selection = clone(state.selection);
      let run: InputRun | null = null;
      if (event instanceof InputEvent && documentTarget(event.target)) {
        const type = event.inputType;
        run = {type, host: event.target.closest('[contenteditable="true"],input,textarea'), composition: state.composing || state.compositionEnding || type.includes('Composition') ? state.composition : 0, time: Date.now()};
      }
      state.input = {selection, run}; state.batch = null;
      const input = state.input;
      // A browser may run a microtask checkpoint between beforeinput and its
      // default input action. Keep these coordinates until input is delivered.
      if (!(event instanceof InputEvent)) queueMicrotask(() => {if (state.input === input) state.input = null;});
    }
    function keydown(event: KeyboardEvent) {
      if (event.isComposing || history.current.composing) return;
      if (documentTarget(event.target) && (event.metaKey || event.ctrlKey) && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === 'z' || key === 'y' && event.ctrlKey && !event.metaKey) {
          event.preventDefault(); event.stopPropagation();
          if (key === 'y' || event.shiftKey) redo(); else undo();
          return;
        }
      }
      begin(event);
    }
    function beforeinput(event: InputEvent) {
      if (documentTarget(event.target) && !event.isComposing && !history.current.composing && (event.inputType === 'historyUndo' || event.inputType === 'historyRedo')) {
        event.preventDefault(); event.stopPropagation();
        if (event.inputType === 'historyUndo') undo(); else redo();
        return;
      }
      begin(event);
    }
    function compositionstart(event: CompositionEvent) {
      if (!documentTarget(event.target)) return;
      history.current.composing = true; history.current.composition++;
      begin(event);
    }
    function compositionend() {
      const state = history.current;
      state.composing = false; state.compositionEnding = true;
      setTimeout(() => {state.compositionEnding = false;}, 0);
    }
    function input(event: Event) {
      if (!documentTarget(event.target)) return;
      if (event instanceof InputEvent && (event.inputType === 'historyUndo' || event.inputType === 'historyRedo')) {
        // Some engines expose a noncancelable beforeinput for native menu
        // commands. Its DOM mutation must never become another user edit.
        event.stopPropagation();
        const state = history.current;
        state.restore ??= {selection: clone(state.selection)};
        refresh(value => value + 1);
        return;
      }
      const state = history.current, pending = state.input;
      // Native listeners can have a microtask checkpoint before React receives
      // the same input event. Keep its run until all listeners have committed.
      setTimeout(() => {if (state.input === pending) state.input = null;}, 0);
    }
    function replaced(event: Event) {
      const page = (event as CustomEvent<Page>).detail;
      if (!page || `${page.vault_id}:${page.id}`!==history.current.key) return;
      history.current = emptyHistory(page); resumeEntityRecognition();
      refresh(value=>value+1);
    }
    document.addEventListener('noema:document-replaced', replaced);
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('beforeinput', beforeinput, true);
    document.addEventListener('input', input, true);
    document.addEventListener('pointerdown', begin, true);
    document.addEventListener('selectionchange', remember);
    document.addEventListener('compositionstart', compositionstart, true);
    document.addEventListener('compositionend', compositionend, true);
    return () => {
      document.removeEventListener('noema:document-replaced', replaced);
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('beforeinput', beforeinput, true);
      document.removeEventListener('input', input, true);
      document.removeEventListener('pointerdown', begin, true);
      document.removeEventListener('selectionchange', remember);
      document.removeEventListener('compositionstart', compositionstart, true);
      document.removeEventListener('compositionend', compositionend, true);
    };
  }, [key, undo, redo]);

  return {change, undo, redo, canUndo: !disabled && !page?.editLocked && history.current.past.length > 0, canRedo: !disabled && !page?.editLocked && history.current.future.length > 0};
}
