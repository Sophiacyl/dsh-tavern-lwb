// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
// Test-only public source pins. Importing this module never downloads anything.
import { execFile } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const references = new URL('../tests/.references/', import.meta.url);
const repository = 'https://github.com/flizzywine/dsh-tavern.git';
export const referenceCommits = Object.freeze({
  api7: 'a3fe308af0271010cff9eff00eac72ec4e3eaad0',
  api8: 'babcf0a33ee08a4914cc5270d8aec98ff5621088',
});

export function referenceRoot(api) {
  if (!Object.hasOwn(referenceCommits, api)) throw new Error(`Unknown Tavern reference: ${api}`);
  const override = process.env[`LWB_${api.toUpperCase()}_ROOT`];
  return override ? path.resolve(override) : fileURLToPath(new URL(`${api}/`, references));
}

export function referenceModule(api, module) {
  return pathToFileURL(path.join(referenceRoot(api), 'tavern-plugin/lib', module));
}

async function git(args) {
  const { stdout } = await exec('git', ['-c', 'credential.helper=', ...args], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

async function exists(file) {
  try { await access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function prepareReferences() {
  for (const [api, commit] of Object.entries(referenceCommits)) {
    const root = referenceRoot(api);
    if (!await exists(root)) {
      if (process.env[`LWB_${api.toUpperCase()}_ROOT`]) throw new Error(`${api}: override directory does not exist: ${root}; overrides are never created or modified`);
      await mkdir(fileURLToPath(references), { recursive: true });
      console.log(`${api}: cloning public Tavern source into ${root}`);
      await git(['clone', '--no-checkout', '--filter=blob:none', '--', repository, root]);
      await git(['-C', root, 'checkout', '--detach', commit]);
    }
    if (!await exists(path.join(root, '.git'))) throw new Error(`${api}: not a checkout: ${root}; existing directories are never overwritten`);
    const head = await git(['-C', root, 'rev-parse', 'HEAD']);
    if (head !== commit) throw new Error(`${api}: expected HEAD ${commit}, found ${head}; checkout left unchanged: ${root}`);
    const dirty = await git(['-C', root, 'status', '--porcelain', '--untracked-files=all']);
    if (dirty) throw new Error(`${api}: checkout is not clean; left unchanged: ${root}\n${dirty}`);
    await access(path.join(root, 'tavern-plugin/lib/plugin-api.js'));
    console.log(`${api}: verified clean HEAD ${commit}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareReferences().catch(error => { console.error(error.message); process.exitCode = 1; });
}
