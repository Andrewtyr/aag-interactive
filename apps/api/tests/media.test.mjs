import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVideoUrl } from '../src/video-sources.mjs';
import { parseByteRange } from '../src/asset-response.mjs';
import { validateMaterial } from '../src/material-store.mjs';
import { createImportStore } from '../src/import-store.mjs';
import { createApiServer } from '../src/server.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('video links become canonical trusted embeds', () => {
  assert.equal(normalizeVideoUrl('https://youtu.be/dQw4w9WgXcQ').url, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(normalizeVideoUrl('https://rutube.ru/video/7716bd3e665725c3c008ae7ab4ff02e2/').provider, 'rutube');
  assert.equal(normalizeVideoUrl('https://vkvideo.ru/video-123_456').provider, 'vk');
  for (const url of ['javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ', 'https://user:password@youtube.com/watch?v=dQw4w9WgXcQ']) assert.throws(() => normalizeVideoUrl(url));
});

test('video byte ranges support seeking and reject invalid ranges', () => {
  assert.deepEqual(parseByteRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(parseByteRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseByteRange('bytes=50-', 100), { start: 50, end: 99 });
  assert.throws(() => parseByteRange('bytes=100-200', 100));
  assert.throws(() => parseByteRange('bytes=0-1,3-4', 100));
});

test('media editing properties survive material validation', () => {
  const media = { type: 'video', url: 'https://youtu.be/dQw4w9WgXcQ', x: 10, y: 20, w: 60, h: 60, rotation: 15, fit: 'cover', focalX: 20, focalY: 70, lockAspect: true, autoplay: false, muted: true, loop: false, startTime: 5 };
  const result = validateMaterial({ title: 'Медиа', slides: [{ type: 'content', title: 'Ролик', bullets: [], elements: [media] }] });
  assert.equal(result.slides[0].elements[0].provider, 'youtube');
  assert.equal(result.slides[0].elements[0].fit, 'cover');
  assert.equal(result.slides[0].elements[0].startTime, 5);
  const question = validateMaterial({ title: 'Вопрос', slides: [{ type: 'poll', title: 'Что показано?', options: ['А', 'Б'], elements: [media] }] });
  assert.equal(question.slides[0].options.length, 2);
  assert.equal(question.slides[0].elements[0].provider, 'youtube');
});

test('uploaded videos require ownership and support authenticated range playback', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aag-video-'));
  const imports = createImportStore(join(directory, 'data.sqlite'), join(directory, 'uploads'));
  const store = { getSession: (token) => token === 'test' ? { user: { id: 1, role: 'host' }, csrf: 'csrf' } : null };
  const server = createApiServer({ store, importStore: imports, webRoot: directory });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const bytes = Buffer.concat([Buffer.from('000000186674797069736F6D', 'hex'), Buffer.alloc(100)]);
    const upload = await fetch(`${base}/api/assets`, { method: 'POST', headers: { cookie: 'aag_session=test', 'x-csrf-token': 'csrf', 'content-type': 'video/mp4' }, body: bytes });
    assert.equal(upload.status, 201);
    const { asset } = await upload.json();
    assert.throws(() => imports.verifyAssets([{ elements: [{ type: 'video', assetId: asset.id }] }], 2));
    assert.throws(() => imports.verifyAssets([{ elements: [{ type: 'image', assetId: asset.id }] }], 1));
    const denied = await fetch(`${base}/api/assets/${asset.id}`); assert.equal(denied.status, 403);
    const partial = await fetch(`${base}/api/assets/${asset.id}`, { headers: { cookie: 'aag_session=test', range: 'bytes=4-11' } });
    assert.equal(partial.status, 206); assert.equal(partial.headers.get('content-type'), 'video/mp4');
    assert.equal(Buffer.from(await partial.arrayBuffer()).toString(), 'ftypisom');
    const invalid = await fetch(`${base}/api/assets`, { method: 'POST', headers: { cookie: 'aag_session=test', 'x-csrf-token': 'csrf', 'content-type': 'video/mp4' }, body: 'not a video' });
    assert.equal(invalid.status, 400);
  } finally { await new Promise((resolve) => server.close(resolve)); imports.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
