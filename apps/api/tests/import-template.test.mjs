import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createImportStore } from '../src/import-store.mjs';

test('a saved question template can use only its uploader’s imported pages', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aag-template-import-'));
  const store = createImportStore(join(directory, 'imports.sqlite'), join(directory, 'uploads'), async ({ outputDir }) => {
    writeFileSync(join(outputDir, 'slide-1.png'), Buffer.from('89504e470d0a1a0a00', 'hex'));
    return 1;
  });
  try {
    const contents = Buffer.from('%PDF-1.4\n');
    const req = Readable.from([contents]);
    req.headers = { 'content-type': 'application/pdf', 'content-length': String(contents.length) };
    const imported = await store.importDocument(req, 7, 'Шаблон.pdf', 'application/pdf');
    const question = { type: 'poll', template: { importId: imported.id, page: 1 } };
    assert.equal(store.list(7)[0].name, 'Шаблон.pdf');
    assert.deepEqual(store.list(8), []);
    assert.doesNotThrow(() => store.verifySlides([question], 7));
    assert.throws(() => store.verifySlides([question], 8), /недоступен/);
    assert.throws(() => store.verifySlides([{ ...question, template: { ...question.template, page: 2 } }], 7), /недоступен/);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
