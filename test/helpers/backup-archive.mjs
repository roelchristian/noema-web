import {gzipSync,gunzipSync} from 'node:zlib';

/** Decode a fresh archive so corruption cases never mutate their shared export. */
export function readBackupArchive(bytes) {
  return JSON.parse(gunzipSync(bytes).toString('utf8'));
}

/** Preserve the production gzip/JSON transport while changing one fixture archive. */
export function rewriteBackupArchive(bytes,change) {
  const archive=readBackupArchive(bytes);
  change(archive);
  return gzipSync(JSON.stringify(archive));
}
