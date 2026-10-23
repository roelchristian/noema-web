import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,rename,rm,stat} from 'node:fs/promises';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createWriteStream} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

export const kokoroRevision='1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const files=JSON.parse(await readFile(new URL('./kokoro-files.json',import.meta.url),'utf8'));
export const defaultKokoroDirectory=resolve(import.meta.dirname,'../data/models/kokoro');
async function verified(filename,file) {
  try {
    if((await stat(filename)).size!==file.size)return false;
    const hash=createHash(file.algorithm==='git-sha1'?'sha1':'sha256');
    if(file.algorithm==='git-sha1')hash.update(`blob ${file.size}\0`);
    for await(const chunk of createReadStream(filename))hash.update(chunk);
    return hash.digest('hex')===file.hash;
  }catch{return false;}
}
/** Only this explicit setup action accesses the network. Files are pinned and verified. */
export async function downloadKokoroFiles(directory=process.env.NOEMA_KOKORO_MODEL_DIR||defaultKokoroDirectory) {
  for(const file of files) {
    const destination=resolve(directory,file.path);
    if(await verified(destination,file))continue;
    await mkdir(dirname(destination),{recursive:true});
    const temporary=destination+'.'+randomUUID()+'.partial';
    try {
      console.log(`Downloading Kokoro: ${file.path}`);
      const response=await fetch(`https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/${kokoroRevision}/${file.path}`,{signal:AbortSignal.timeout(300000)});
      if(!response.ok||!response.body)throw new Error(`Download failed (${response.status}) for ${file.path}`);
      let bytes=0;
      const limit=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;callback(bytes>file.size?new Error('Model download exceeded its expected size.'):null,chunk);}});
      await pipeline(Readable.fromWeb(response.body),limit,createWriteStream(temporary,{flags:'wx',mode:0o600}));
      if(!await verified(temporary,file))throw new Error(`Checksum verification failed for ${file.path}`);
      await rename(temporary,destination);
    }finally{await rm(temporary,{force:true});}
  }
  console.log(`Kokoro 82M is ready in ${directory}`);
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try{await downloadKokoroFiles();}catch(error){console.error(error.message);process.exitCode=1;}
}
