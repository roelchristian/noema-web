import {useEffect, useState} from 'react';
import {Icon} from './Icon';

export type ViewMode = 'list' | 'compact' | 'grid';
const modes = [{id: 'list', label: 'List'}, {id: 'compact', label: 'Compact'}, {id: 'grid', label: 'Grid'}] as const;
function readMode(scope: string): ViewMode {
  try {
    const stored = localStorage.getItem('noema-view-mode/' + scope);
    return stored === 'compact' || stored === 'grid' ? stored : 'list';
  } catch { return 'list'; }
}
export function useViewMode(scope: string) {
  const [mode, setMode] = useState<ViewMode>(() => readMode(scope));
  useEffect(() => { setMode(readMode(scope)); }, [scope]);
  function change(next: ViewMode) {
    setMode(next);
    try { localStorage.setItem('noema-view-mode/' + scope, next); } catch { /* Layout remains usable without storage. */ }
  }
  return [mode, change] as const;
}
export function ViewModeSwitch({value, onChange}: {value: ViewMode; onChange: (mode: ViewMode) => void}) {
  return <div className="view-mode-switch" role="group" aria-label="View layout">{modes.map(mode => <button key={mode.id} type="button" title={mode.label + ' view'} aria-label={mode.label + ' view'} aria-pressed={value === mode.id} onClick={() => onChange(mode.id)}><Icon name={'view-' + mode.id}/><span>{mode.label}</span></button>)}</div>;
}
