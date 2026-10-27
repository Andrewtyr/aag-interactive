import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';

export function parseByteRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || '');
  const invalid = () => { const issue = new Error('Некорректный диапазон видео.'); issue.status = 416; throw issue; };
  if (!match || (!match[1] && !match[2])) return invalid();
  const suffix = !match[1];
  const start = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = suffix || !match[2] ? size - 1 : Math.min(size - 1, Number(match[2]));
  if (![start, end].every(Number.isSafeInteger) || start < 0 || start >= size || end < start) return invalid();
  return { start, end };
}

export async function sendAsset(req, res, file) {
  const { size } = await stat(file);
  const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm' }[extname(file)];
  const headers = { 'content-type': type, 'cache-control': 'private, max-age=300', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff' };
  let range;
  if (req.headers.range) {
    try { range = parseByteRange(req.headers.range, size); }
    catch { res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` }); return res.end(); }
  }
  res.writeHead(range ? 206 : 200, { ...headers, 'content-length': range ? range.end - range.start + 1 : size, ...(range ? { 'content-range': `bytes ${range.start}-${range.end}/${size}` } : {}) });
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(file, range);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  return stream.pipe(res);
}
