import {t as uiText} from '../i18n';
import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { pillColors, type PillColor } from './appearance';

const previewStyle = (color: PillColor) => ({background: `var(--palette-${color}-bg)`, color: `var(--palette-${color}-text)`, borderColor: `var(--palette-${color}-border)`});
const colors = Object.keys(pillColors) as PillColor[];
/** A listbox uses real pill previews instead of platform-dependent option styling. */
export function ColorPicker({id, label, value, onChange}: {id: string; label: string; value: PillColor; onChange: (value: PillColor) => void}) {
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const [position, setPosition] = useState({top: 0, left: 0});
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), list = useRef<HTMLDivElement>(null);
  const listId = useId();
  function close() { setOpen(false); trigger.current?.focus(); }
  function choose(color: PillColor) { onChange(color); close(); }
  useLayoutEffect(() => {
    if (!open) return;
    const box = trigger.current!.getBoundingClientRect();
    const height = Math.min(288, window.innerHeight - 24);
    setPosition({left: Math.max(12, Math.min(box.right - 220, window.innerWidth - 232)), top: box.bottom + height + 6 <= window.innerHeight ? box.bottom + 6 : Math.max(12, box.top - height - 6)});
    list.current?.focus({preventScroll: true});
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const moved = (event: Event) => { if (!list.current?.contains(event.target as Node)) setOpen(false); };
    const resized = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('scroll', moved, true);
    window.addEventListener('resize', resized);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('scroll', moved, true);
      window.removeEventListener('resize', resized);
    };
  }, [open]);
  return <div ref={root} className="color-picker">
    <button ref={trigger} type="button" id={id} className="color-picker-trigger" aria-label={label + ': ' + uiText(pillColors[value].name)} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      onClick={() => { setActive(colors.indexOf(value)); setOpen(!open); }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(colors.indexOf(value)); setOpen(true); } }}>
      <span className="pill-preview" style={previewStyle(value)}><Icon name="knowledge"/>{uiText(pillColors[value].name)}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && <div ref={list} id={listId} role="listbox" aria-label={label} aria-activedescendant={listId + '-' + active} tabIndex={-1} className="color-picker-list" style={position} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive((active + (event.key === 'ArrowDown' ? 1 : -1) + colors.length) % colors.length); }
      else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); setActive(event.key === 'Home' ? 0 : colors.length - 1); }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(colors[active]); }
      else if (event.key === 'Tab') setOpen(false);
    }}>
      {colors.map((color, index) => <button key={color} type="button" id={listId + '-' + index} role="option" aria-selected={color === value} tabIndex={-1} className={index === active ? 'active' : ''} onPointerMove={() => setActive(index)} onClick={() => choose(color)}>
        <span className="pill-preview" style={previewStyle(color)}><Icon name="knowledge"/>{uiText(pillColors[color].name)}</span><span aria-hidden="true">{color === value ? '✓' : ''}</span>
      </button>)}
    </div>}
  </div>;
}
