import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const privatePath = resolve(import.meta.dirname, '../apps/api/src/hospitality-standards.private.json');
const publicPath = resolve(import.meta.dirname, '../apps/web/public/materials/hospitality-standards.json');
const original = JSON.parse(await readFile(privatePath, 'utf8'));
const preview = {
  ...original,
  slides: original.slides.map(({ correctIndex, correctIndices, note, ...slide }) => slide),
};
await writeFile(publicPath, `${JSON.stringify(preview, null, 2)}\n`, 'utf8');
