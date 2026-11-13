// Restores bundled artwork from the checked-in base64 sources.
//
// The three JPGs in src/assets/images are stored in the repository as
// *.jpg.b64 text files (the sync tooling used for this repo cannot carry
// binary files). This script decodes any JPG that is missing. It runs
// automatically before `dev` and `build` (predev/prebuild in package.json).
// Existing JPGs are never overwritten: to replace artwork, delete the JPG
// and update the .b64 file, or drop in a new JPG and regenerate the .b64
// with: base64 -w0 <file.jpg> > <file.jpg.b64>
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const imagesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'images');

let restored = 0;
for (const name of readdirSync(imagesDir)) {
  if (!name.endsWith('.jpg.b64')) continue;
  const jpgPath = join(imagesDir, name.slice(0, -4));
  if (existsSync(jpgPath)) continue;
  const b64 = readFileSync(join(imagesDir, name), 'utf8').replace(/\s+/g, '');
  writeFileSync(jpgPath, Buffer.from(b64, 'base64'));
  restored++;
  console.log(`decode-assets: restored ${name.slice(0, -4)}`);
}
if (restored === 0) console.log('decode-assets: all artwork present');
