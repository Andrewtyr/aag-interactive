#!/bin/sh
set -eu
PATH=/usr/local/bin:/usr/bin:/bin
cd "$(dirname "$0")"
destination="${AAG_OFFSITE_STAGE:-$HOME/aag-backups}"
mkdir -p "$destination"
result="$(docker compose --env-file .env.server exec -T app npm --workspace @aag/api run backup)"
printf '%s\n' "$result"
backup_path="$(printf '%s\n' "$result" | sed -n 's/^Копия создана: //p' | tail -n 1)"
if [ -z "$backup_path" ]; then echo 'Не найден путь резервной копии.' >&2; exit 1; fi
container="$(docker compose --env-file .env.server ps -q app)"
if [ -z "$container" ]; then echo 'Контейнер приложения не найден.' >&2; exit 1; fi
docker cp "$container:$backup_path" "$destination/"
echo "Копия также сохранена на хосте: $destination"
