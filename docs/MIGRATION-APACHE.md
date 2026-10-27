# Перенос ААГ на другой сервер с Apache

Эта инструкция устанавливает **только ААГ Интерактив** рядом со старым сайтом. До проверки новой версии старый сайт, его база и Apache не меняются. Код лежит в публичном репозитории; база, пользователи, ответы и загруженные файлы передаются **отдельным закрытым архивом**.

## 1. Получить свежую копию с действующего сервера

На действующем сервере:

```sh
cd /opt/is-2612-group
sudo sh scripts/export-aag-only.sh
```

Команда покажет два пути: `Archive:` и `Checksum:`. Оба файла нужно перенести на свой компьютер, затем на новый сервер по SSH/SCP. Пример (подставьте **свои** имена файлов, сервер и пользователя):

```sh
scp USER@SOURCE:/home/USER/is2612-transfer/aag-only-YYYYMMDDTHHMMSSZ.tar.gz .
scp USER@SOURCE:/home/USER/is2612-transfer/aag-only-YYYYMMDDTHHMMSSZ.tar.gz.sha256 .
scp aag-only-YYYYMMDDTHHMMSSZ.tar.gz* USER@TARGET:/home/USER/
```

Архив включает текущую SQLite-базу ААГ, импортированные презентации, медиа и список запрещённых слов. Он содержит личные данные и доступы пользователей: **не загружайте его в GitHub, не пересылайте в чат, храните с ограниченным доступом**. Старую копию, сделанную ранее, можно использовать для репетиции, а непосредственно перед переносом создайте новую.

## 2. Установить код отдельно от старого сайта

На новом сервере нужны Docker Engine с Compose, Git и работающий Apache с HTTPS. Подключитесь к серверу и проверьте свободный локальный порт:

```sh
sudo ss -ltnp | grep ':4280 ' || true
sudo apache2ctl -S
```

Если порт 4280 занят, выберите другой в `deploy/.env.apache`. Клонируйте репозиторий **в новую папку**, не поверх старой распаковки:

```sh
cd /opt
sudo git clone https://github.com/Andrewtyr/aag-interactive.git aag-interactive
sudo chown -R "$(id -un):$(id -gn)" /opt/aag-interactive
cd /opt/aag-interactive
cp deploy/example.env deploy/.env.apache
nano deploy/.env.apache
```

В `AAG_PUBLIC_BASE_URL` укажите окончательный HTTPS-адрес с `/aag/` в конце. `AAG_LISTEN_PORT` должен быть свободен. Файл `deploy/.env.apache` не добавляется в Git. Новый Compose-проект называется `aag-independent` и создаёт собственный том `aag-independent_aag_data`; он не использует старый том или базу.

## 3. Проверить архив и восстановить базу

Скопируйте два файла архива в закрытую папку на новом сервере. Находясь в `/opt/aag-interactive`, выполните:

```sh
sh scripts/restore-aag-data.sh /home/USER/aag-only-YYYYMMDDTHHMMSSZ.tar.gz --check-only
docker compose --env-file deploy/.env.apache -f deploy/compose.apache.yaml build app
sh scripts/restore-aag-data.sh /home/USER/aag-only-YYYYMMDDTHHMMSSZ.tar.gz
docker compose --env-file deploy/.env.apache -f deploy/compose.apache.yaml up -d app
docker compose --env-file deploy/.env.apache -f deploy/compose.apache.yaml ps
curl -fsS http://127.0.0.1:4280/api/health
```

Подставьте выбранный порт вместо 4280. В ответе `/api/health` ожидается `{"ok":true}`. Скрипт проверяет SHA-256, структуру архива и `PRAGMA integrity_check` базы. Если в новом томе уже есть `aag.sqlite`, восстановление останавливается и **не перезаписывает** его. Для повторной попытки сначала разберите причину ошибки и сохраните имеющийся том; команду `down -v` не используйте.

## 4. Подключить Apache после проверки

Откройте конфигурацию **действующего HTTPS VirtualHost**. Поставьте эти правила **перед** общим `ProxyPass / ...` (если он есть):

```apache
ProxyPreserveHost On
RequestHeader set X-Forwarded-Proto "https"
ProxyPass        /aag/ http://127.0.0.1:4280/
ProxyPassReverse /aag/ http://127.0.0.1:4280/
```

Включите модули `proxy`, `proxy_http`, `headers`, проверьте конфигурацию и только затем перечитайте Apache:

```sh
sudo a2enmod proxy proxy_http headers
sudo apache2ctl configtest
sudo systemctl reload apache2
curl -fsS https://YOUR-DOMAIN/aag/api/health
```

Проверьте вход администратора, библиотеку, показ с QR, ответ с телефона, отчёт и импорт PPTX/PDF. Если старая версия ААГ уже была опубликована на `/aag/`, замените только её старые правила прокси после проверки нового контейнера. Пути и настройки других разделов сайта не трогайте. Если при предыдущей распаковке что-то сломалось, не распаковывайте архив поверх той папки; сохраните её для диагностики.

## Обновление и резервные копии

Для обновления кода: `git pull --ff-only`, затем `docker compose --env-file deploy/.env.apache -f deploy/compose.apache.yaml up -d --build app`. Постоянный том с данными сохраняется. Перед обновлением сделайте резервную копию через `docker compose --env-file deploy/.env.apache -f deploy/compose.apache.yaml exec -T app npm --workspace @aag/api run backup`. Копия сохраняется внутри тома `/data/backups`; для защиты от потери сервера копируйте её и `/data/uploads` за пределы VPS.
