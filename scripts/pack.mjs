// LWB Bridge — Based on LittleWhiteBox by biex (LittleWhiteBox / 小白X).
// Original: https://github.com/RT15548/LittleWhiteBox ; derivative terms: LICENSE.md.
// Reproducible standard ZIP packer using only Node built-ins; no lifecycle scripts.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ROOT, releaseFiles } from './files.mjs';
const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json')));
const files = await releaseFiles();
const table = Array.from({ length: 256 }, (_, index) => { let value = index; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
function crc(data) { let value = 0xffffffff; for (const byte of data) value = table[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }
const local = [], central = [], manifest = [];
let offset = 0, expanded = 0;
for (const file of files) {
  const data = await readFile(path.join(ROOT, file));
  const name = Buffer.from(pkg.name + '/' + file);
  const compressed = deflateRawSync(data, { level: 9 });
  const payload = compressed.length < data.length ? compressed : data;
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
  header.writeUInt16LE(payload === compressed ? 8 : 0, 8); header.writeUInt16LE(0x21, 12);
  header.writeUInt32LE(crc(data), 14); header.writeUInt32LE(payload.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); header.copy(directory, 6, 4, 30); directory.writeUInt32LE(offset, 42);
  local.push(header, name, payload); central.push(directory, name);
  offset += header.length + name.length + payload.length; expanded += data.length;
  manifest.push({ path: file, size: data.length, sha256: createHash('sha256').update(data).digest('hex') });
}
const directory = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...local, directory, end]);
const name = pkg.name + '-' + pkg.version + '.zip';
const output = path.join(ROOT, 'dist'); await mkdir(output, { recursive: true });
const sha256 = createHash('sha256').update(archive).digest('hex');
await writeFile(path.join(output, name), archive);
await writeFile(path.join(output, name + '.sha256'), sha256 + '  ' + name + '\n');
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ name: pkg.name, version: pkg.version, bytes: archive.length, expandedBytes: expanded, sha256, files: manifest }, null, 2) + '\n');
console.log(JSON.stringify({ file: 'dist/' + name, bytes: archive.length, expandedBytes: expanded, sha256, files: files.length }, null, 2));
