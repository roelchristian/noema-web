import {Icon} from '../components/Icon';
import type {NoticeTone} from './types';
export function NoticeIcon({tone,className=''}:{tone:NoticeTone;className?:string}) {return <span className={'notice-icon '+className} data-tone={tone} aria-hidden="true"><Icon name={tone==='neutral'?'check':tone==='success'?'check-circle':tone==='info'?'info':'alert'}/></span>;}
