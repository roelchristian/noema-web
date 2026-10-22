import {ENTITY_SCAN_BATCH_SIZE} from '../../shared/entity-scan.js';

/** Successful early stop: the extra object is the next batch's checkpoint. */
export class EntityScanBatchReady extends Error {
  constructor(public output:string){super('Entity scan batch ready.');}
}
/** Extract complete suggestion objects while a JSON array is still arriving. */
export class EntityScanStream {
  private text='';
  private count=0;
  feed(delta:string):unknown[]|null {
    this.text+=delta;
    const prefix=/^\s*\{\s*"suggestions"\s*:\s*\[/.exec(this.text);
    if(!prefix)return null;
    const values:unknown[]=[];
    let start=-1,depth=0,quoted=false,escaped=false;
    for(let i=prefix[0].length;i<this.text.length;i++) {
      const c=this.text[i];
      if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
      if(c==='"'){quoted=true;continue;}
      if(c==='{'){if(depth===0)start=i;depth++;}
      if(c==='}'&&depth>0&&--depth===0){
        values.push(JSON.parse(this.text.slice(start,i+1)));
        if(values.length===ENTITY_SCAN_BATCH_SIZE+1)throw new EntityScanBatchReady(JSON.stringify({suggestions:values}));
      }
      if(c===']'&&depth===0)break;
    }
    if(this.text.length>100000)throw new Error('Entity scan exceeded its size limit.');
    if(values.length===this.count)return null;
    this.count=values.length;return values;
  }
}
