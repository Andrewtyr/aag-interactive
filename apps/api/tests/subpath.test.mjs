import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiServer } from '../src/server.mjs';

test('AAG works behind /aag with isolated login and participant links', async () => {
  const user = { id: 1, role: 'admin', displayName: 'Test' };
  const store = {
    authenticate: () => user,
    createSession: () => ({ token: 'test-token', csrf: 'test-csrf' }),
    getSession: (token) => token === 'test-token' ? { user, csrf: 'test-csrf' } : null,
  };
  const liveStore = { getHost: () => ({ event: { id: 7, code: 'АБ 12' } }) };
  const server = createApiServer({ store, liveStore, webRoot: new URL('../../web/', import.meta.url).pathname, publicBaseUrl: 'https://is2612.ru/aag/' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { origin: 'https://is2612.ru', 'content-type': 'application/json' }, body: JSON.stringify({ login: 'admin', password: 'test' }) });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /Path=\/aag;/);
    const host = await fetch(`${base}/api/live/7/host`, { headers: { cookie: 'aag_session=test-token', origin: 'https://is2612.ru' } });
    assert.equal(host.status, 200);
    assert.equal((await host.json()).joinUrl, 'https://is2612.ru/aag/participant.html?code=%D0%90%D0%91%2012');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('participants can load only the template page used by their current question', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'aag-question-template-'));
  const image = join(directory, 'template.png'); writeFileSync(image, 'image');
  const importId = '123e4567-e89b-42d3-a456-426614174000';
  const server = createApiServer({
    store: { getSession: () => null },
    liveStore: { getParticipant: () => ({ slide: { type: 'poll', template: { importId, page: 2 } } }) },
    importStore: { pagePath: () => image, owns: () => false },
    webRoot: new URL('../../web/', import.meta.url).pathname,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const allowed = await fetch(`${base}/api/imports/${importId}/pages/2?event=7`, { headers: { 'x-participant-token': 'participant-token' } });
    assert.equal(allowed.status, 200);
    const denied = await fetch(`${base}/api/imports/${importId}/pages/1?event=7`, { headers: { 'x-participant-token': 'participant-token' } });
    assert.equal(denied.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
