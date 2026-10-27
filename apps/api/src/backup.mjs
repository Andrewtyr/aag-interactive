import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function backupDatabase(source, destination) {
  source = resolve(source); destination = resolve(destination);
  if (!existsSync(source)) throw new Error('Файл базы данных не найден.');
  if (existsSync(destination)) throw new Error('Файл резервной копии уже существует.');
  mkdirSync(dirname(destination), { recursive: true });
  const db = new DatabaseSync(source);
  try { db.prepare('VACUUM INTO ?').run(destination); }
  finally { db.close(); }
  const copy = new DatabaseSync(destination);
  try { if (Object.values(copy.prepare('PRAGMA integrity_check').get())[0] !== 'ok') throw new Error('Проверка резервной копии не прошла.'); }
  finally { copy.close(); }
  return destination;
}

export function backupApplication(source, uploads, destinationDirectory, bannedWordsPath = process.env.AAG_WORD_BLOCKLIST_PATH ?? resolve(dirname(source), 'word-cloud-blocklist.txt')) {
  destinationDirectory = resolve(destinationDirectory);
  if (existsSync(destinationDirectory)) throw new Error('Каталог резервной копии уже существует.');
  mkdirSync(destinationDirectory, { recursive: true });
  const marker = join(destinationDirectory, 'НЕЗАВЕРШЕНО.txt');
  writeFileSync(marker, 'Резервная копия не завершена. Не используйте её для восстановления.');
  const databaseCopy = backupDatabase(source, join(destinationDirectory, 'aag.sqlite'));
  if (existsSync(bannedWordsPath)) copyFileSync(bannedWordsPath, join(destinationDirectory, 'word-cloud-blocklist.txt'));
  const copy = new DatabaseSync(databaseCopy);
  try {
    const hasImports = copy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='imports'").get();
    if (hasImports) for (const record of copy.prepare('SELECT id,extension,slide_count FROM imports').all()) {
      if (!/^[a-f0-9-]{36}$/.test(record.id) || !['.pdf', '.pptx'].includes(record.extension)) throw new Error('Некорректная запись импортированного файла.');
      const sourceDirectory = resolve(uploads, record.id);
      const targetDirectory = join(destinationDirectory, 'uploads', record.id);
      mkdirSync(targetDirectory, { recursive: true });
      for (const name of [`original${record.extension}`, ...Array.from({ length: record.slide_count }, (_, index) => `slide-${index + 1}.png`)]) copyFileSync(join(sourceDirectory, name), join(targetDirectory, name));
    }
    const hasAssets = copy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='assets'").get();
    if (hasAssets) for (const asset of copy.prepare('SELECT id,extension FROM assets').all()) {
      if (!/^[a-f0-9-]{36}$/.test(asset.id) || !['.png', '.jpg', '.mp4', '.webm'].includes(asset.extension)) throw new Error('Некорректная запись медиафайла.');
      const targetDirectory = join(destinationDirectory, 'uploads', 'assets');
      mkdirSync(targetDirectory, { recursive: true });
      copyFileSync(join(uploads, 'assets', asset.id + asset.extension), join(targetDirectory, asset.id + asset.extension));
    }
  } finally { copy.close(); }
  unlinkSync(marker);
  return destinationDirectory;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = process.env.AAG_DB_PATH ?? './data/aag.sqlite';
  const uploads = process.env.AAG_UPLOAD_DIR ?? './data/uploads';
  const directory = process.env.AAG_BACKUP_DIR ?? './backups';
  const folder = `aag-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`;
  try { console.log(`Копия создана: ${backupApplication(source, uploads, resolve(directory, folder))}`); }
  catch (issue) { console.error(issue.message); process.exitCode = 1; }
}
