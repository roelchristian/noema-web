import {copyFileSync,mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

/** macOS dyld needs extra access when launching an executable under a denied
 * home directory. Launch a private temporary copy instead of broadening access
 * to the vault data directory. The parser still reads only its allowed input. */
export function preparePDFWorker(program:string,args:string[]) {
 if(program!=='/usr/bin/sandbox-exec'||args[0]!=='-p'||!args[2])return {args,dispose:()=>{}};
 const directory=mkdtempSync(path.join(tmpdir(),'noema-worker-'));
 try {
  const original=realpathSync(args[2]),executable=path.join(realpathSync(directory),'worker');
  copyFileSync(original,executable);
  const profile=args[1]!.split(JSON.stringify(original)).join(JSON.stringify(executable));
  return {args:[args[0]!,profile,executable,...args.slice(3)],dispose:()=>rmSync(directory,{recursive:true,force:true})};
 }catch(error){rmSync(directory,{recursive:true,force:true});throw error;}
}
