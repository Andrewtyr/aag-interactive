# Запуск ААГ Интерактив на своём сервере

Это краткий маршрут для VPS с Ubuntu, публичным IP и доменом. Подробные команды для резервных копий, восстановления и обновления находятся в [deploy/README.md](deploy/README.md).

## Что подготовить

1. Поддомен, например `interactive.example.org`, направленный на IP сервера.
2. Доступ по SSH и открытые порты 80 и 443 для сайта.
3. Установленные Docker Engine и Docker Compose по [инструкции Docker для Ubuntu](https://docs.docker.com/engine/install/ubuntu/).

## 1. Упаковать проект на компьютере

В PowerShell откройте `D:\prezentacia\aag-interactive` и выполните:

```powershell
pwsh -NoProfile -File .\scripts\package-server.ps1
```

Скрипт создаст `D:\prezentacia\aag-server-<дата>.zip`. В архив не входят локальная база, пароли, загруженные файлы и `node_modules`.

## 2. Передать архив и настроить домен

Подставьте своё имя пользователя, IP и фактическое имя архива:

```powershell
scp "D:\prezentacia\aag-server-<дата>.zip" user@SERVER_IP:~/
```

Зайдите на VPS по SSH и выполните:

```sh
mkdir -p ~/aag-interactive
unzip ~/aag-server-<дата>.zip -d ~/aag-interactive
cd ~/aag-interactive/deploy
cp .env.server.example .env.server
nano .env.server
```

Укажите в `.env.server` свой `DOMAIN`. Не меняйте `COMPOSE_PROJECT_NAME=aag` при последующих обновлениях: от него зависит имя тома с данными.

## 3. Запустить и создать администратора

```sh
docker compose --env-file .env.server config --quiet
docker compose --env-file .env.server up -d --build
docker compose --env-file .env.server ps
docker compose --env-file .env.server exec app npm --workspace @aag/api run bootstrap-admin -- admin "Администратор"
```

Последняя команда нужна только на новой пустой базе. Пароль задаётся вами в терминале. После запуска проверьте `https://ВАШ-ДОМЕН/api/health` и откройте `https://ВАШ-ДОМЕН/` на телефоне через мобильную сеть.

## Где находятся материалы и запрещённые слова

На сервере база пользователей и материалов, загруженные файлы и список запрещённых слов находятся в закрытом Docker-томе `aag_aag_data`, внутри контейнера — в `/data`. Этот каталог не публикуется как сайт. Список для облака тегов: `/data/word-cloud-blocklist.txt`; по одному слову или выражению на строке, строки с `#` — комментарии. Изменения читаются без перезапуска. Как передать новый файл в контейнер, описано в [подробной инструкции](deploy/README.md).

Перед обновлением сделайте резервную копию командой `sh ./backup-server.sh` из каталога `deploy`. Не используйте `docker compose down -v`: это удалит том с базой и материалами. Подробности восстановления и обновления также находятся в [deploy/README.md](deploy/README.md).
