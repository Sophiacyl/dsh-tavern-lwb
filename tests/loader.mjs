// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
// Test-only resolution. Production package has no external dependencies.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const local = createRequire(new URL('./runtime/package.json', import.meta.url));
const dependencies = new Set(Object.keys(local('./package.json').dependencies));
export async function resolve(specifier, context, nextResolve) {
  const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
  if (dependencies.has(packageName)) return { url: pathToFileURL(local.resolve(specifier)).href, shortCircuit: true };
  return nextResolve(specifier, context);
}
