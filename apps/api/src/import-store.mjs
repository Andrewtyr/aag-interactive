import { DatabaseSync } from 'node:sqlite';
import { mkdir, open, rm, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { renderDocument } from './import-renderer.mjs';

const maxUploadBytes = 50 * 1024 * 1024;
const fail = (status, message) => { const issue = new Error(message); issue.status = status; throw issue; };
const fileType = (name, contentType) => {
  const extension = extname(name).toLowerCase();
  if (extension === '.pdf' && contentType === 'application/pdf') return extension;
  if (extension === '.pptx' && contentType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') return extension;
  fail(400, 'Загрузите файл PDF или PPTX с правильным типом.');
};

export function createImportStore(dbPath, uploadRoot, renderer = renderDocument) {
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS imports (id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, original_name TEXT NOT NULL, extension TEXT NOT NULL, slide_count INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS imports_owner_idx ON imports(owner_id);
    CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, extension TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS assets_owner_idx ON assets(owner_id);`);
  const get = (id) => db.prepare('SELECT * FROM imports WHERE id=?').get(id);
  return {
    close: () => db.close(),
    owns(id, ownerId) { return get(id)?.owner_id === ownerId; },
    list(ownerId) { return db.prepare('SELECT id,original_name AS name,slide_count AS slideCount FROM imports WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT 50').all(ownerId); },
    ownsAsset(id, ownerId) { return db.prepare('SELECT owner_id FROM assets WHERE id=?').get(id)?.owner_id === ownerId; },
    verifyAssets(slides, ownerId) {
      for (const slide of slides ?? []) for (const element of slide.elements ?? []) if (['image', 'video'].includes(element.type) && !(element.type === 'video' && element.url)) {
        const asset = db.prepare('SELECT owner_id,extension FROM assets WHERE id=?').get(element.assetId);
        if (!asset || asset.owner_id !== ownerId || (element.type === 'video') !== ['.mp4', '.webm'].includes(asset.extension)) fail(403, 'Медиафайл недоступен или имеет другой формат.');
      }
    },
    verifySlides(slides, ownerId) {
      for (const slide of slides ?? []) for (const reference of [slide.type === 'imported' ? { importId: slide.importId, page: slide.page } : null, slide.template].filter(Boolean)) {
        const record = get(reference.importId);
        if (!record || record.owner_id !== ownerId || reference.page < 1 || reference.page > record.slide_count) fail(403, 'Импортированный слайд недоступен.');
      }
    },
    async importDocument(req, ownerId, rawName, contentType) {
      let name;
      try { name = basename(decodeURIComponent(String(rawName ?? ''))); } catch { fail(400, 'Некорректное имя файла.'); }
      if (!name || name.length > 200) fail(400, 'Укажите имя файла до 200 символов.');
      const extension = fileType(name, contentType);
      if (Number(req.headers['content-length']) > maxUploadBytes) fail(413, 'Файл больше 50 МБ.');
      const id = randomUUID();
      const directory = join(uploadRoot, id);
      const sourcePath = join(directory, `original${extension}`);
      await mkdir(directory, { recursive: true });
      try {
        const output = await open(sourcePath, 'wx');
        let size = 0;
        try {
          for await (const chunk of req) {
            size += chunk.length;
            if (size > maxUploadBytes) fail(413, 'Файл больше 50 МБ.');
            let offset = 0;
            while (offset < chunk.length) offset += (await output.write(chunk, offset, chunk.length - offset)).bytesWritten;
          }
        } finally { await output.close(); }
        if (size < 8) fail(400, 'Файл пустой или повреждён.');
        const source = await open(sourcePath, 'r');
        const header = Buffer.alloc(8);
        try { await source.read(header, 0, 8, 0); } finally { await source.close(); }
        if (extension === '.pdf' && header.subarray(0, 5).toString() !== '%PDF-') fail(400, 'Неверный формат PDF.');
        if (extension === '.pptx' && header.subarray(0, 4).toString('hex') !== '504b0304') fail(400, 'Неверный формат PPTX.');
        const slideCount = await renderer({ sourcePath, extension, outputDir: directory });
        if (!Number.isInteger(slideCount) || slideCount < 1 || slideCount > 100) fail(400, 'В файле должно быть от 1 до 100 слайдов.');
        for (let page = 1; page <= slideCount; page++) {
          const pagePath = join(directory, `slide-${page}.png`);
          const image = await stat(pagePath);
          const file = await open(pagePath, 'r');
          const signature = Buffer.alloc(8);
          try { await file.read(signature, 0, 8, 0); } finally { await file.close(); }
          if (image.size < 8 || image.size > 10 * 1024 * 1024 || signature.toString('hex') !== '89504e470d0a1a0a') fail(400, `Не удалось проверить слайд ${page}.`);
        }
        db.prepare('INSERT INTO imports(id,owner_id,original_name,extension,slide_count,created_at) VALUES(?,?,?,?,?,?)').run(id, ownerId, name, extension, slideCount, new Date().toISOString());
        return { id, name, slideCount, slides: Array.from({ length: slideCount }, (_, index) => ({ type: 'imported', title: `Слайд ${index + 1}`, importId: id, page: index + 1 })) };
      } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
    },
    pagePath(id, page) {
      const record = get(id);
      if (!record || !Number.isInteger(page) || page < 1 || page > record.slide_count) fail(404, 'Слайд не найден.');
      return join(uploadRoot, id, `slide-${page}.png`);
    },
    async uploadAsset(req, ownerId) {
      const type = req.headers['content-type'];
      const extension = { 'image/png': '.png', 'image/jpeg': '.jpg', 'video/mp4': '.mp4', 'video/webm': '.webm' }[type];
      if (!extension) fail(400, 'Поддерживаются PNG, JPEG, MP4 и WebM.');
      const video = type.startsWith('video/');
      const max = (video ? 100 : 10) * 1024 * 1024;
      if (Number(req.headers['content-length']) > max) fail(413, `Файл больше ${video ? 100 : 10} МБ.`);
      const id = randomUUID();
      const directory = join(uploadRoot, 'assets');
      const path = join(directory, id + extension);
      await mkdir(directory, { recursive: true });
      try {
        const file = await open(path, 'wx');
        let size = 0;
        try {
          for await (const chunk of req) {
            size += chunk.length;
            if (size > max) fail(413, `Файл больше ${video ? 100 : 10} МБ.`);
            let offset = 0;
            while (offset < chunk.length) offset += (await file.write(chunk, offset, chunk.length - offset)).bytesWritten;
          }
        } finally { await file.close(); }
        if (size < 8) fail(400, 'Медиафайл повреждён.');
        const source = await open(path, 'r'); const header = Buffer.alloc(16);
        try { await source.read(header, 0, 16, 0); } finally { await source.close(); }
        const valid = extension === '.png' ? header.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' : extension === '.jpg' ? header.subarray(0, 3).toString('hex') === 'ffd8ff' : extension === '.mp4' ? size >= 12 && header.toString('ascii', 4, 8) === 'ftyp' : header.subarray(0, 4).toString('hex') === '1a45dfa3';
        if (!valid) fail(400, 'Формат медиафайла не соответствует файлу.');
        db.prepare('INSERT INTO assets(id,owner_id,extension,created_at) VALUES(?,?,?,?)').run(id, ownerId, extension, new Date().toISOString());
        return { id };
      } catch (error) { await rm(path, { force: true }); throw error; }
    },
    assetPath(id) {
      const row = db.prepare('SELECT extension FROM assets WHERE id=?').get(id);
      if (!row) fail(404, 'Изображение не найдено.');
      return join(uploadRoot, 'assets', id + row.extension);
    },
  };
}
