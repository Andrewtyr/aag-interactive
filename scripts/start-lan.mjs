import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const apiRoot = resolve(projectRoot, 'apps/api');
const interfaces = Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
  (addresses ?? []).filter((item) => item.family === 'IPv4' && !item.internal).map((item) => ({ name, address: item.address }))
);
const addressOption = process.argv.indexOf('--address');
const requested = addressOption >= 0 ? process.argv[addressOption + 1] : undefined;
if (addressOption >= 0 && (!requested || requested.startsWith('--'))) {
  console.error('Укажите IP компьютера после --address.');
  process.exit(1);
}
if (requested && !interfaces.some((item) => item.address === requested)) {
  console.error(`Адрес ${requested} не назначен этому компьютеру. Доступные адреса: ${interfaces.map((item) => item.address).join(', ') || 'нет'}.`);
  process.exit(1);
}
const physical = interfaces.filter((item) => !/(?:tun|tap|vpn|docker|wsl|vethernet|virtual|loopback)/i.test(item.name));
const selected = requested ?? (physical.length === 1 ? physical[0].address : interfaces.length === 1 ? interfaces[0].address : null);
if (!selected) {
  console.error(`Не удалось однозначно выбрать сетевой адрес. Запустите npm run start:lan -- --address <IP>. Доступные: ${interfaces.map((item) => `${item.name}: ${item.address}`).join('; ') || 'нет'}.`);
  process.exit(1);
}
const port = Number(process.env.PORT ?? 4180);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT должен быть числом от 1 до 65535.');
  process.exit(1);
}
process.env.HOST = '0.0.0.0';
process.env.PORT = String(port);
process.env.PUBLIC_BASE_URL = `http://${selected}:${port}`;
process.chdir(apiRoot);
console.log(`Сайт для компьютера и телефона: ${process.env.PUBLIC_BASE_URL}`);
console.log('Телефон должен быть в той же сети Wi-Fi. Если страница не открывается, проверьте брандмауэр Windows и изоляцию клиентов Wi-Fi.');
await import('../apps/api/src/main.mjs');
