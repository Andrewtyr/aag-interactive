# Как разместить ААГ Интерактив на сервере

Инструкция рассчитана на VPS с Ubuntu, публичным IP, доменом и доступом по SSH. Приложение и обработчик презентаций работают в одном контейнере; Caddy принимает запросы по HTTPS. Внешний порт приложения 4180 не открывается. База, загруженные презентации и резервные копии хранятся в постоянном Docker-томе.

## 1. Подготовьте сервер и домен

1. Создайте A-запись поддомена, например interactive.example.org, с публичным IP VPS. Если есть AAAA-запись, она тоже должна указывать на этот сервер.
2. Откройте входящие TCP-порты 80 и 443, UDP-порт 443 и SSH-порт 22. Для публичного сертификата Caddy нужны корректный DNS и доступ к 80/443. [Условия Caddy](https://caddyserver.com/docs/automatic-https).
3. Установите Docker Engine и Compose по [официальной инструкции для Ubuntu](https://docs.docker.com/engine/install/ubuntu/). Проверьте команды docker compose version и docker info.

QR-коды публичного сервиса должны содержать домен, а не IP компьютера в аудитории.

Материалы, база пользователей, загруженные файлы и список запрещённых слов хранятся в закрытом томе `/data`, который не публикуется напрямую. Администратор видит материалы каждого пользователя в своей панели и может отправить их в архив или восстановить. Файл `/data/word-cloud-blocklist.txt` содержит по одному запрещённому слову или выражению на строке; строка с `#` в начале — комментарий. Для изменения подготовьте текстовый файл на VPS и передайте его в контейнер командой `docker compose --env-file .env.server exec -T app sh -c 'cat > /data/word-cloud-blocklist.txt' < ~/word-cloud-blocklist.txt`. Перезапуск не нужен.

## 2. Соберите и передайте код

На компьютере с проектом откройте PowerShell в каталоге aag-interactive:

~~~powershell
pwsh -NoProfile -File .\scripts\package-server.ps1
~~~

Команда создаст рядом с проектом архив aag-server-<дата>.zip. В нём нет локальной базы, паролей, загруженных файлов и node_modules. Передайте архив на VPS по SSH, заменив имя файла, пользователя и адрес:

~~~powershell
scp "D:\prezentacia\aag-server-<дата>.zip" user@SERVER_IP:~/
~~~

На VPS:

~~~sh
mkdir -p ~/aag-interactive
unzip ~/aag-server-<дата>.zip -d ~/aag-interactive
cd ~/aag-interactive/deploy
cp .env.server.example .env.server
nano .env.server
~~~

Замените DOMAIN=interactive.example.org на настоящий домен. Оставьте COMPOSE_PROJECT_NAME=aag: постоянный том сохранит одинаковое имя при обновлениях. Compose [читает указанный файл через --env-file](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).

## 3. Запустите сайт

Из каталога ~/aag-interactive/deploy:

~~~sh
docker compose --env-file .env.server config --quiet
docker compose --env-file .env.server up -d --build
docker compose --env-file .env.server ps
docker compose --env-file .env.server logs --tail=100 app caddy
~~~

Первую сборку увеличивает установка LibreOffice и Poppler для PPTX/PDF. Дождитесь состояния healthy у приложения. Затем создайте первого администратора:

~~~sh
docker compose --env-file .env.server exec app npm --workspace @aag/api run bootstrap-admin -- admin "Администратор"
~~~

Пароль вводится в терминале без отображения. В исходном коде готового пароля нет. Если переносите существующую базу с компьютера, нового администратора создавать не нужно: используйте прежний аккаунт после восстановления данных.

Проверьте https://ВАШ-ДОМЕН/api/health: ожидается {"ok":true}. Откройте сайт, войдите в библиотеку. На телефоне с мобильным интернетом проверьте QR-ссылку, вход и ответ. QR должен вести на https://ВАШ-ДОМЕН/participant.html?code=....

## 4. Резервная копия и восстановление

Для ручной копии из каталога deploy:

~~~sh
sh ./backup-server.sh
~~~

Скрипт создаёт согласованную копию базы, файлов завершённых импортов и списка запрещённых слов облака в Docker-томе, затем копирует её в ~/aag-backups/aag-<дата>/ на VPS. В каталоге должны быть aag.sqlite, word-cloud-blocklist.txt и, если были импорты, uploads/. Наличие НЕЗАВЕРШЕНО.txt означает неудачную копию. Для защиты от потери VPS перенесите эту папку также на другое хранилище.

Для ежедневного запуска добавьте в crontab -e строку, заменив USER:

~~~cron
0 3 * * * cd /home/USER/aag-interactive/deploy && /bin/sh ./backup-server.sh >> /home/USER/aag-backup.log 2>&1
~~~

Проверьте появление новой папки в ~/aag-backups и её копирование за пределы VPS. Автоматическая очистка старых копий не включена: срок хранения следует утвердить до удаления.

Для пробного восстановления используйте отдельный тестовый VPS. Для восстановления на основном сервере сначала остановите приложение и сделайте ещё одну копию текущего тома. Положите нужную копию в ~/aag-restore так, чтобы существовал путь ~/aag-restore/aag.sqlite. Затем из deploy выполните:

~~~sh
docker compose --env-file .env.server stop app
docker compose --env-file .env.server run --rm --no-deps --user root -v "$HOME/aag-restore:/restore:ro" app sh -c 'cp /restore/aag.sqlite /data/aag.sqlite && rm -f /data/aag.sqlite-wal /data/aag.sqlite-shm && if [ -d /restore/uploads ]; then cp -a /restore/uploads/. /data/uploads/; fi && if [ -f /restore/word-cloud-blocklist.txt ]; then cp /restore/word-cloud-blocklist.txt /data/word-cloud-blocklist.txt; fi && chown -R node:node /data'
docker compose --env-file .env.server up -d
~~~

Проверьте /api/health, вход, материал с импортированным слайдом и отчёт. Локальный тест восстановления базы и слайдов есть в наборе тестов проекта; на выбранном VPS процедуру нужно повторить отдельно.

Если хотите перенести пользователей и материалы с текущего компьютера, выполните в apps/api команду npm run backup, передайте полученный каталог на VPS по защищённому SSH, поместите его содержимое в ~/aag-restore и примените ту же процедуру восстановления до создания нового администратора.

## 5. Обновление

Перед обновлением запустите sh ./backup-server.sh. Передайте новый архив и распакуйте его поверх каталога проекта. Файл deploy/.env.server в архив не включён. Затем из deploy:

~~~sh
docker compose --env-file .env.server up -d --build
docker compose --env-file .env.server ps
docker compose --env-file .env.server logs --tail=100 app caddy
~~~

Данные остаются в томе aag_aag_data. Команду docker compose down -v не применяйте: она удаляет том с данными. После обновления проверьте вход, материалы, импорт PDF/PPTX и QR.

## 6. Проверка нагрузки

Результат на компьютере разработчика приведён [в отчёте](../docs/load-test-2026-09-29.md). Он не определяет вместимость VPS. До большого мероприятия проведите отдельную проверку на выбранном сервере и сети, начиная с 50 участников на сессию, и зафиксируйте p95 ответов, число ошибок и влияние обработки презентаций. Docker-сборка и импорт PPTX ещё не проверены на вашем будущем VPS: до мероприятия обязательна пробная загрузка типовой презентации.
