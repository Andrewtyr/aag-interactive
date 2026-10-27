#!/bin/sh
# Restore a private export from is-2612-group into the independent AAG volume.
set -eu
umask 077

usage() {
  echo 'Usage: sh scripts/restore-aag-data.sh ARCHIVE.tar.gz [--check-only]' >&2
  exit 2
}

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || usage
archive=$1
check_only=${2:-}
[ -z "$check_only" ] || [ "$check_only" = --check-only ] || usage
[ -s "$archive" ] || { echo 'Archive is missing or empty.' >&2; exit 1; }
checksum_file="$archive.sha256"
[ -s "$checksum_file" ] || { echo 'Checksum file is missing.' >&2; exit 1; }

expected=$(awk 'NR == 1 { print $1 }' "$checksum_file")
actual=$(sha256sum "$archive" | awk '{ print $1 }')
[ "$expected" = "$actual" ] || { echo 'Archive checksum does not match.' >&2; exit 1; }

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT HUP INT TERM
tar -tzf "$archive" > "$stage/members"
if ! awk '
  /^\.\// && $0 !~ /(^|\/)\.\.($|\/)$/ { next }
  { bad = 1 }
  END { exit bad }
' "$stage/members"; then
  echo 'Archive contains an unsafe path.' >&2
  exit 1
fi
if tar -tvzf "$archive" | awk '{ kind = substr($1, 1, 1); if (kind != "-" && kind != "d") bad = 1 } END { exit bad }'; then
  :
else
  echo 'Archive contains a link or an unsupported file type.' >&2
  exit 1
fi
tar -xzf "$archive" -C "$stage" --no-same-owner ./data
[ -s "$stage/data/aag.sqlite" ] || { echo 'AAG database is missing.' >&2; exit 1; }
[ ! -e "$stage/data/НЕЗАВЕРШЕНО.txt" ] || { echo 'The AAG backup is incomplete.' >&2; exit 1; }
echo 'Archive checksum and structure: OK'
[ "$check_only" = --check-only ] && exit 0

env_file="$root/deploy/.env.apache"
[ -s "$env_file" ] || { echo 'Create deploy/.env.apache from deploy/example.env first.' >&2; exit 1; }
docker compose --env-file "$env_file" -f "$root/deploy/compose.apache.yaml" run --rm --no-deps \
  --user root -v "$stage/data:/restore:ro" app sh -ec '
    if [ -e /data/aag.sqlite ]; then
      echo "Target database already exists. No data were changed." >&2
      exit 1
    fi
    node --input-type=module -e '\''
      import { DatabaseSync } from "node:sqlite";
      const db = new DatabaseSync("/restore/aag.sqlite", { readOnly: true });
      try {
        const result = Object.values(db.prepare("PRAGMA integrity_check").get())[0];
        if (result !== "ok") throw new Error("SQLite integrity_check failed: " + result);
      } finally { db.close(); }
    '\''
    mkdir -p /data/uploads
    if [ -d /restore/uploads ]; then cp -a /restore/uploads/. /data/uploads/; fi
    if [ -f /restore/word-cloud-blocklist.txt ]; then cp /restore/word-cloud-blocklist.txt /data/; fi
    cp /restore/aag.sqlite /data/aag.sqlite
    chown -R node:node /data
    echo "AAG data restored into independent volume."
  '
