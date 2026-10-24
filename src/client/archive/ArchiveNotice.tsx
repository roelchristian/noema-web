import {SuccessNotice} from '../components/SuccessNotice';

export function ArchiveNotice({count,onUndo,onDismiss}:{count:number;onUndo:()=>void;onDismiss:()=>void}) {
  return <SuccessNotice message={count===1?'Page archived.':`${count} pages archived.`} onDismiss={onDismiss} dismissLabel="Dismiss archive confirmation" action={<button type="button" className="success-notice-action" onClick={onUndo}>Undo</button>}/>;
}
