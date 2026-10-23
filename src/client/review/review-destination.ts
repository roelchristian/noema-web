import {createContext} from 'react';
import type {ReviewItem} from '../../shared/review-centre';
/** Session navigation intent; never a second persisted review model. */
export const ReviewDestination=createContext<ReviewItem|null>(null);

interface ReviewLocation {
 vault:{id:string;locked:boolean}|null;
 view:string;
 page:{id:string}|null;
 entityId:string|null;
 sourceId:string|null;
 calendarDateId?:string|null;
}

/** Keep review intent on its original workspace, without following unrelated navigation. */
export function reviewDestinationAt(item:ReviewItem|null,vaultId:string|null,location:ReviewLocation):ReviewItem|null {
 if(!item||!location.vault||location.vault.locked||location.vault.id!==vaultId)return null;
 const matches=item.category==='scan'
  ?location.view==='pages'&&location.page?.id===item.originId
  :item.category==='property'
   ?location.view==='entity'&&location.entityId===item.originId||location.view==='source'&&location.sourceId===item.originId
  :item.category==='temporal'
   ?location.view==='calendar'&&location.calendarDateId===item.dateId
  :item.category==='discovery'
   ?location.view==='entity'&&location.entityId===item.originId
   :location.view==='source'&&location.sourceId===item.originId;
 return matches?item:null;
}
