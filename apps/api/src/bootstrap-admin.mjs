import { resolve } from 'node:path';
import { createStore, bootstrapAdmin } from './store.mjs';

const [login, displayName] = process.argv.slice(2);
if (!login || !displayName) {
  console.error('Использование: npm run bootstrap-admin -- <логин> "Имя администратора"');
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error('Для безопасного ввода пароля нужен интерактивный терминал.');
  process.exit(1);
}
const store = createStore(resolve(process.env.AAG_DB_PATH ?? './data/aag.sqlite'));
try {
  process.stdout.write('Пароль (не отображается): ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let password = '';
  await new Promise((done) => { const onData = (chunk) => {
    const input = chunk.toString();
    if (input === '\r' || input === '\n') { process.stdin.off('data', onData); return done(); }
    if (input === '\u0003') process.exit(130);
    if (input === '\u007f' || input === '\b') password = password.slice(0, -1);
    else password += input;
  }; process.stdin.on('data', onData); });
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write('\n');
  const admin = bootstrapAdmin(store, { login, displayName, password });
  console.log(`Создан администратор: ${admin.login}`);
} catch (issue) {
  console.error(issue.message);
  process.exitCode = 1;
} finally {
  store.close();
}
