import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, lstatSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { Store } from '../store.js';
import { HttpError } from '../validation.js';

// Unattached uploads get time to finish autosaving, including after a restart.
export const imageUploadGraceMs = 24 * 60 * 60 * 1000;
export const maxImageBytes = 20 * 1024 * 1024;
const imageId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/;
const mime: Record<string, string> = {png:'image/png', jpg:'image/jpeg', gif:'image/gif', webp:'image/webp'};
export class Images {
  private root: string;
  private persistent: boolean;
  constructor(private store: Store) {
    const database = store.all<{name: string; file: string}>('PRAGMA database_list').find(db => db.name === 'main');
    this.persistent = !!database?.file;
    this.root = path.join(path.dirname(database?.file || ':memory:'), 'assets');
  }
  private filename(vault: string, id: string) {
    if (!/^(default|[0-9a-f-]{36})$/.test(vault) || !imageId.test(id)) throw new HttpError(400, 'Invalid image ID');
    return path.join(this.root, vault, 'images', id);
  }
  require(vault: string, id: string) {
    const filename = this.filename(vault, id);
    if (!existsSync(filename)) throw new HttpError(404, 'Image not found in this vault');
    return filename;
  }
  add(vault: string, bytes: Buffer) {
    if (!bytes.length) throw new HttpError(400, 'Image is empty');
    if (bytes.length > maxImageBytes) throw new HttpError(413, 'Images must be 20 MB or smaller');
    const ext = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png'
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg'
      : /^GIF8[79]a$/.test(bytes.toString('ascii',0,6)) ? 'gif'
      : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' ? 'webp' : undefined;
    if (!ext) throw new HttpError(415, 'Choose a PNG, JPEG, GIF, or WebP image');
    const id = randomUUID() + '.' + ext, filename = this.filename(vault,id);
    mkdirSync(path.dirname(filename), {recursive:true});
    writeFileSync(filename,bytes,{flag:'wx', mode:0o600});
    return {id};
  }
  // Includes notes in Trash: only actual row deletion releases their references.
  cleanup(vault?: string, candidates?: string[], clock = Date.now()) {
    if(!this.persistent || candidates?.length === 0) return 0;
    const vaults = vault ? [vault] : this.store.all<{id:string}>('SELECT id FROM vaults').map(row => row.id);
    let removed=0;
    for(const scope of vaults) {
      const referenced=new Set<string>();
      for(const page of this.store.all<{blocks:string;featured_image_id:string|null}>('SELECT blocks,featured_image_id FROM pages WHERE vault_id=?',scope)) {
        if(page.featured_image_id)referenced.add(page.featured_image_id);
        const blocks=JSON.parse(page.blocks) as {type:string; imageId?:string}[];
        for(const block of blocks) if(block.type === 'image' && block.imageId) referenced.add(block.imageId);
      }
      // Indexed references avoid reparsing every immutable snapshot on each autosave.
      for(const row of this.store.all<{image_id:string}>('SELECT DISTINCT i.image_id FROM page_version_images i JOIN page_versions v ON v.id=i.version_id WHERE v.vault_id=?',scope))referenced.add(row.image_id);
      const directory=path.dirname(this.filename(scope,'00000000-0000-4000-8000-000000000000.png'));
      if(!existsSync(directory)) continue;
      for(const id of candidates ? new Set(candidates) : readdirSync(directory)) {
        if(!imageId.test(id) || referenced.has(id)) continue;
        const filename=this.filename(scope,id);
        try {
          const stat=lstatSync(filename);
          if(!stat.isFile() || (!candidates && clock-stat.mtimeMs < imageUploadGraceMs)) continue;
          unlinkSync(filename); removed++;
        } catch(error) {
          // A failed removal is retried by the next sweep; never fail a committed note save.
          if((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Image cleanup could not remove a file');
        }
      }
    }
    return removed;
  }
  // Used only to roll back files written for a newly imported vault.
  remove(vault: string, id: string) {
    try {unlinkSync(this.filename(vault,id));}
    catch(error) {if((error as NodeJS.ErrnoException).code !== 'ENOENT')throw error;}
  }
  get(vault: string, id: string) {
    return {bytes:readFileSync(this.require(vault,id)), mime:mime[id.split('.').at(-1)!]!};
  }
}
