#!/bin/bash
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: ./scripts/restore.sh <backup.tar.gz>"
  exit 1
fi

BACKUP_FILE="$1"
if [ ! -f "$BACKUP_FILE" ]; then
  echo "Backup file not found: $BACKUP_FILE"
  exit 1
fi

RESTORE_DIR="./backups/restore_$(date +"%Y%m%d_%H%M%S")"
POSTGRES_USER="${POSTGRES_USER:-work_ai}"
POSTGRES_DB="${POSTGRES_DB:-work_ai}"
COMPOSE_PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$PWD")}"

mkdir -p "$RESTORE_DIR"
tar -xzf "$BACKUP_FILE" -C "$RESTORE_DIR" --strip-components=1

echo "Restoring PostgreSQL database..."
docker compose exec -T postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker compose exec -T postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB" < "${RESTORE_DIR}/database.sql"

echo "Restoring private storage volume..."
docker run --rm \
  -v "${COMPOSE_PROJECT}_app_storage:/data" \
  -v "$PWD/${RESTORE_DIR}:/backup:ro" \
  alpine:3.20 sh -c "rm -rf /data/* && tar -xzf /backup/storage.tar.gz -C /data"

rm -rf "$RESTORE_DIR"
echo "Restore completed. Restart the stack with: docker compose restart"
