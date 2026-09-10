import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
}
const files = walk('scripts').filter(file => /\.[cm]?js$/.test(file));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
}
for (const file of ['module.json', ...walk('languages').filter(file => file.endsWith('.json'))]) {
  JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
const manifest = JSON.parse(readFileSync('module.json', 'utf8'));
for (const path of [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map(l => l.path)]) {
  if (!existsSync(path)) throw new Error(`Missing manifest file: ${path}`);
}
console.log(`Syntax: ${files.length} JavaScript files passed. Manifest paths and language JSON passed.`);
