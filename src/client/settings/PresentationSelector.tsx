import {Icon} from '../components/Icon';
import {t as uiText} from '../i18n';
import type {PresentationMode} from './appearance';

export function PresentationSelector({value, onChange, onExitFocus}: {value: PresentationMode; onChange: (mode: PresentationMode) => void; onExitFocus: () => void}) {
  const focus=value==='focus',subtle=value!=='standard';
  return <div className="presentation-selector" role="group" aria-label={uiText('Presentation mode')}>
    <button type="button" aria-label={uiText('Subtle references')} aria-pressed={subtle} disabled={focus}
      title={uiText(focus?'Exit Focus to change reference emphasis':subtle?'Subtle references · Switch to Standard':'Standard references · Switch to Subtle')}
      onClick={()=>onChange(subtle?'standard':'subtle')}>
      <span className={'presentation-icon-pair'+(subtle?' is-active':'')} aria-hidden="true"><Icon name="reference-highlight"/><Icon name="reference-subtle"/></span>
    </button>
    <button type="button" className="presentation-focus" aria-label={uiText('Focus mode')} aria-pressed={focus}
      title={uiText(focus?'Exit Focus (Escape)':'Enter Focus')} onClick={()=>focus?onExitFocus():onChange('focus')}>
      <span className={'presentation-icon-pair'+(focus?' is-active':'')} aria-hidden="true"><Icon name="expand"/><Icon name="collapse"/></span>
    </button>
  </div>;
}
