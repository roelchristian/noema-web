import {presentationModes, type PresentationMode} from './appearance';

const descriptions = {
  standard: 'Standard: full workspace and normal entity highlights',
  subtle: 'Subtle: full workspace with understated entity references',
  focus: 'Focus: minimal workspace with understated references. Escape restores your previous view.',
};
export function PresentationSelector({value, onChange}: {value: PresentationMode; onChange: (mode: PresentationMode) => void}) {
  return <div className="presentation-selector" role="radiogroup" aria-label="Presentation mode">
    {presentationModes.map((mode, index) => <button key={mode} type="button" role="radio" aria-checked={value === mode} tabIndex={value === mode ? 0 : -1}
      title={descriptions[mode]} aria-description={descriptions[mode]} aria-label={mode[0].toUpperCase() + mode.slice(1)} onClick={() => onChange(mode)} onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3;
        onChange(presentationModes[next]);
        (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
      }}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}
  </div>;
}
