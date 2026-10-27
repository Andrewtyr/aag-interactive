import { spawn } from 'node:child_process';
import { readdir, rename } from 'node:fs/promises';
import { basename, join } from 'node:path';

const fail = (message) => { const issue = new Error(message); issue.status = 400; throw issue; };
const run = (command, args, timeoutMs = 120_000) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const collect = (chunk) => { if (output.length < 16_000) output += chunk.toString(); };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  const timer = setTimeout(() => child.kill(), timeoutMs);
  child.once('error', (error) => { clearTimeout(timer); reject(error); });
  child.once('exit', (code) => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`${command}: ${output.slice(-1000)}`)); });
});

async function renderPdf(sourcePath, outputDir) {
  const info = await run(process.env.PDFINFO_PATH || 'pdfinfo', [sourcePath], 15_000);
  const count = Number(/^Pages:\s+(\d+)\s*$/m.exec(info)?.[1]);
  if (!Number.isInteger(count) || count < 1 || count > 100) fail('PDF должен содержать от 1 до 100 страниц.');
  await run(process.env.PDFTOPPM_PATH || 'pdftoppm', ['-f', '1', '-l', String(count), '-png', '-scale-to', '1600', sourcePath, join(outputDir, 'page')]);
  const pages = (await readdir(outputDir)).map((file) => ({ file, number: Number(/^page-(\d+)\.png$/i.exec(file)?.[1]) })).filter((item) => Number.isInteger(item.number)).sort((a, b) => a.number - b.number);
  if (pages.length !== count) fail('Не удалось преобразовать все страницы PDF.');
  for (let i = 0; i < pages.length; i++) await rename(join(outputDir, pages[i].file), join(outputDir, `slide-${i + 1}.png`));
  return count;
}

export async function renderDocument({ sourcePath, extension, outputDir }) {
  try {
    if (extension === '.pdf') return await renderPdf(sourcePath, outputDir);
    if (extension !== '.pptx') fail('Поддерживаются только PDF и PPTX.');
    if (process.platform === 'win32') {
      const script = new URL('../../../scripts/export-pptx.ps1', import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '');
      const count = Number((await run(process.env.POWERSHELL_PATH || 'pwsh', ['-NoProfile', '-NonInteractive', '-File', decodeURIComponent(script), sourcePath, outputDir])).trim().split(/\r?\n/).at(-1));
      if (!Number.isInteger(count) || count < 1 || count > 100) fail('PowerPoint должен содержать от 1 до 100 слайдов.');
      return count;
    }
    await run(process.env.SOFFICE_PATH || 'soffice', ['-env:UserInstallation=file:///tmp/aag-office-' + basename(outputDir), '--headless', '--convert-to', 'pdf', '--outdir', outputDir, sourcePath]);
    return await renderPdf(join(outputDir, basename(sourcePath, '.pptx') + '.pdf'), outputDir);
  } catch (error) {
    if (error.status) throw error;
    fail('Не удалось обработать презентацию. Проверьте файл или доступность конвертера на сервере.');
  }
}
