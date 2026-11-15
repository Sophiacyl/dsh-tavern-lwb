// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
import { readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
export const ROOT = path.resolve(new URL('../', import.meta.url).pathname);
const entries = ['package.json', 'index.mjs', 'host', 'core/index.mjs', 'core/README.md', 'memory', 'vendor', 'client.js', 'locale', 'icon.svg', 'README.md', 'LICENSE.md', 'PROVENANCE.md', 'NOTICE', 'licenses', 'CHANGELOG.md'];
export async function releaseFiles() {
  const out = [];
  async function walk(relative) {
    const full = path.join(ROOT, relative), info = await lstat(full);
    if (info.isSymbolicLink()) throw new Error('Release refuses symlink: ' + relative);
    if (info.isDirectory()) { for (const name of (await readdir(full)).sort()) { if (name.startsWith('.')) throw new Error('Hidden release entry: ' + relative + '/' + name); await walk(relative + '/' + name); } }
    else if (info.isFile()) out.push(relative);
    else throw new Error('Invalid release entry: ' + relative);
  }
  for (const name of entries) await walk(name);
  return [...new Set(out)].sort();
}
