import {referentStatuses,referentStatusLabels,type ReferentStatus} from '../../shared/domain';
import {Select} from '../components/Select';
import {t as uiText} from '../i18n';
export function ReferentStatusPicker({value='unspecified',onChange,disabled=false}:{value?:ReferentStatus;onChange:(value:ReferentStatus)=>void;disabled?:boolean}) {
 return <label>{uiText('Referent status')}<Select aria-label={uiText('Referent status')} value={value} disabled={disabled} onChange={event=>onChange(event.target.value as ReferentStatus)}>{referentStatuses.map(status=><option key={status} value={status}>{uiText(referentStatusLabels[status])}</option>)}</Select><small>{uiText('Use authored evidence. Leave uncertain or contested status unspecified; names and religious traditions alone do not establish status.')}</small></label>;
}
