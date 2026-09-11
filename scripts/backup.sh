#!/bin/bash
set -euo pipefail

BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
WORK_DIR="${BACKUP_DIR}/work_ai_backup_${TIMESTAMP}"
BACKUP_FILE="${BACKUP_DIR}/work_ai_backup_${TIMESTAMP}.tar.gz"

mkdir -p "$WORK_DIR"

POSTGRES_USER="${POSTGRES_USER:-work_ai}"
POSTGRES_DB="${POSTGRES_DB:-work_ai}"
COMPOSE_PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$PWD")}"

echo "Backing up PostgreSQL database..."
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "${WORK_DIR}/database.sql"

echo "Backing up private storage volume..."
docker run --rm \
  -v "${COMPOSE_PROJECT}_app_storage:/data:ro" \
  -v "$PWD/${WORK_DIR}:/backup" \
  alpine:3.20 sh -c "cd /data && tar -czf /backup/storage.tar.gz ."

tar -czf "$BACKUP_FILE" -C "$BACKUP_DIR" "$(basename "$WORK_DIR")"
rm -rf "$WORK_DIR"

find "$BACKUP_DIR" -type f -name "work_ai_backup_*.tar.gz" -mtime +14 -delete

echo "Backup created: $BACKUP_FILE"
