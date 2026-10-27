import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupApplication } from '../src/backup.mjs';

test('backup includes uploaded video assets', () => {
  const root = mkdtempSync(join(tmpdir(), 'aag-backup-'));
  try {
    const database = join(root, 'aag.sqlite');
    const uploads = join(root, 'uploads');
    const id = '11111111-1111-4111-8111-111111111111';
    mkdirSync(join(uploads, 'assets'), { recursive: true });
    writeFileSync(join(uploads, 'assets', `${id}.mp4`), 'video');
    const db = new DatabaseSync(database);
    db.exec('CREATE TABLE assets (id TEXT, extension TEXT)');
    db.prepare('INSERT INTO assets (id, extension) VALUES (?, ?)').run(id, '.mp4');
    db.close();

    const destination = join(root, 'backup');
    backupApplication(database, uploads, destination);
    assert.equal(existsSync(join(destination, 'uploads', 'assets', `${id}.mp4`)), true);
    assert.equal(existsSync(join(destination, 'НЕЗАВЕРШЕНО.txt')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
