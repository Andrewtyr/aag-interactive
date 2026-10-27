# Перенос ААГ Интерактив на сервер с Apache

Эта инструкция описывает установку **только ААГ Интерактив** на другой сервер, где уже работает старая версия сайта. Новую установку нужно сначала запустить отдельно и проверить. Старый сайт, его базу и повреждённую распаковку архива не удалять.

## Что понадобится

1. Ссылку на публичный код: <https://github.com/Andrewtyr/aag-interactive>.
2. Закрытый архив `aag-only-20261027T134327Z.tar.gz`.
3. Его контрольную сумму `aag-only-20261027T134327Z.tar.gz.sha256`.
4. Домен сайта и доступ к новому серверу по SSH с правом выполнять `sudo`.

Архив содержит резервную копию базы SQLite `aag.sqlite` (пользователи, материалы, ответы), импортированные презентации, изображения, видео и список запрещённых слов облака тегов. Там есть и снимок кода, но для установки используйте **репозиторий GitHub**, а из архива восстанавливайте только папку `data`. Существующих пользователей и администратора повторно создавать не нужно.

**Время копии:** 27 октября 2026 года, 13:43 UTC. Если после этого на действующем сайте появились новые пользователи, материалы или ответы, перед окончательным переключением сделайте новый экспорт и передайте новую пару файлов. Поздние изменения иначе не попадут на новый сервер.

## Что должно быть на новом сервере

Linux, Git, Docker Engine с плагином Docker Compose, Apache с работающим HTTPS и доступный локальный порт (ниже используется 4280). Понадобится доступ к конфигурации действующего HTTPS `VirtualHost`. Если прежняя распаковка архива сломалась, не устанавливайте новую версию поверх неё: используйте отдельную папку `/opt/aag-interactive`.

В командах замените `USER@NEW-SERVER` на SSH-доступ нового сервера, а `ВАШ-ДОМЕН` на реальный домен. Команды в блоках `sh` выполняются **на новом сервере**; блок `cmd` — **на компьютере с архивом**.

## Шаг 1. Передать архив и контрольную сумму

Создайте закрытую папку на новом сервере:

```sh
mkdir -p "$HOME/aag-transfer"
chmod 700 "$HOME/aag-transfer"
```

С компьютера с архивом передайте оба файла через WinSCP или выполните в обычной Windows CMD:

```cmd
C:\Windows\System32\OpenSSH\scp.exe D:\is2612-backup\aag-only-20261027T134327Z.tar.gz USER@NEW-SERVER:~/aag-transfer/
C:\Windows\System32\OpenSSH\scp.exe D:\is2612-backup\aag-only-20261027T134327Z.tar.gz.sha256 USER@NEW-SERVER:~/aag-transfer/
```

На новом сервере:

```sh
ls -lh "$HOME/aag-transfer/"
chmod 600 "$HOME/aag-transfer/"*
```

Файл `.sha256` хранит прежний абсолютный путь к архиву. Поэтому обычная команда `sha256sum -c` после переноса может ошибиться из-за пути. Скрипт восстановления ниже сравнивает именно хеш файлов и работает в новом каталоге.

## Шаг 2. Установить код рядом со старым сайтом

Проверьте свободный локальный порт и активный HTTPS `VirtualHost`:

```sh
sudo ss -ltnp | grep ':4280 ' || true
sudo apache2ctl -S
```

Если первая команда ничего не вывела, порт 4280 свободен. Если занят, позже задайте другой порт в `deploy/.env.apache`. Клонируйте код в **новую папку**:

```sh
cd /opt
sudo git clone https://github.com/Andrewtyr/aag-interactive.git aag-interactive
sudo chown -R "$(id -un):$(id -gn)" /opt/aag-interactive
cd /opt/aag-interactive
cp deploy/example.env deploy/.env.apache
nano deploy/.env.apache
```

В файле укажите `AAG_PUBLIC_BASE_URL=https://ВАШ-ДОМЕН/aag/` и свободный `AAG_LISTEN_PORT=4280`. Завершающий `/` у адреса нужен. Эта установка создаёт отдельный Compose-проект `aag-independent` и том `aag-independent_aag_data`. Существующие контейнеры и базы старого сайта она не использует.

## Шаг 3. Проверить архив, восстановить базу, запустить ААГ

Из папки `/opt/aag-interactive` выполняйте команды **по очереди**:

```sh
sh scripts/restore-aag-data.sh "$HOME/aag-transfer/aag-only-20261027T134327Z.tar.gz" --check-only
sudo docker compose --env-file deploy/.env.apache -f deploy/compose.apache.yaml build app
sudo sh scripts/restore-aag-data.sh "$HOME/aag-transfer/aag-only-20261027T134327Z.tar.gz"
sudo docker compose --env-file deploy/.env.apache -f deploy/compose.apache.yaml up -d app
sudo docker compose --env-file deploy/.env.apache -f deploy/compose.apache.yaml ps
curl -fsS http://127.0.0.1:4280/api/health
```

Ожидаемые результаты: после первой команды — `Archive checksum and structure: OK`, после восстановления — `AAG data restored into independent volume.`, после `curl` — `{"ok":true}`. Если порт изменён, подставьте его в `curl`. Контейнер должен быть `healthy`. Скрипт проверяет SHA-256, состав архива и `PRAGMA integrity_check` SQLite. Если целевая база уже существует, он **откажется её перезаписывать**. Команду `down -v` не используйте.

Пока Apache не переключён, ААГ доступен только на `127.0.0.1:4280` самого нового сервера. Если хотя бы одна проверка не прошла, **Apache не меняйте**.

## Шаг 4. Переключить только `/aag/` в Apache

Найдите активный HTTPS `VirtualHost` нужного домена с помощью `sudo apache2ctl -S` и сделайте резервную копию его конфигурационного файла. Если в нём уже есть старые правила `/aag/`, замените **только их**. Добавьте внутрь `VirtualHost` следующий фрагмент **перед** общим `ProxyPass / ...`, если он есть:

```apache
ProxyPreserveHost On
RequestHeader set X-Forwarded-Proto "https"
RedirectMatch ^/aag$ /aag/
ProxyPass        /aag/ http://127.0.0.1:4280/
ProxyPassReverse /aag/ http://127.0.0.1:4280/
```

Если выбран другой порт, замените 4280 в обоих правилах. Не заменяйте весь действующий файл `VirtualHost` этим фрагментом. После правки:

```sh
sudo a2enmod proxy proxy_http headers
sudo apache2ctl configtest
sudo systemctl reload apache2
curl -fsS https://ВАШ-ДОМЕН/aag/api/health
```

`configtest` должен показать `Syntax OK`; при ошибке **не перечитывайте Apache**. Публичный `curl` должен вернуть `{"ok":true}`. Затем проверьте в браузере вход существующего администратора, библиотеку, импорт PPTX/PDF, показ с QR, подключение участника и отчёт. Остальные разделы старого сайта должны открываться как раньше.

## Если возникла ошибка

- Контрольная сумма не совпала: передайте архив и `.sha256` повторно. Не восстанавливайте повреждённый архив.
- `Target database already exists`: сохраните том и разберитесь, что осталось от предыдущей попытки. Скрипт существующую базу не заменил.
- Локальный `curl` не отвечает: проверьте `sudo docker compose --env-file deploy/.env.apache -f deploy/compose.apache.yaml ps` и `sudo docker compose --env-file deploy/.env.apache -f deploy/compose.apache.yaml logs --tail=100 app`. Apache пока не трогайте.
- Локальная проверка прошла, но публичный адрес не работает: проверьте порядок правил `ProxyPass`, порт и нужный HTTPS `VirtualHost`.
- После правки Apache возникла проблема: верните сохранённую конфигурацию `VirtualHost`, проверьте `sudo apache2ctl configtest` и только при `Syntax OK` выполните `sudo systemctl reload apache2`. Старую папку и базу до приёмки новой установки не удаляйте.

## Следующие обновления

Код обновляется в `/opt/aag-interactive`: `git pull --ff-only`, затем `sudo docker compose --env-file deploy/.env.apache -f deploy/compose.apache.yaml up -d --build app`. Данные находятся в постоянном томе. Перед обновлением создайте резервную копию: `sudo docker compose --env-file deploy/.env.apache -f deploy/compose.apache.yaml exec -T app npm --workspace @aag/api run backup`. Копию из `/data/backups` и медиа нужно регулярно сохранять **за пределами VPS**.
