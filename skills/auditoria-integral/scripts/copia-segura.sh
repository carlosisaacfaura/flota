#!/usr/bin/env bash
# Copia del proyecto SIN secretos, SIN historial git y SIN datos locales, para que los agentes corran
# tests o reproduzcan bugs sin tocar llaves reales, bases de datos reales ni servicios de producción.
# Uso: copia-segura.sh <ruta_proyecto> <destino>
# - Excluye: .git, dependencias y builds (incluye .venv.* rotos y .claude/worktrees/), .env* (salvo .env.example), sesiones, tokens, credenciales,
#   llaves, bases de datos locales (*.db, *.sqlite*) y la carpeta data/.
# - node_modules se ENLAZA (symlink) desde el original para no reinstalar nada. Aviso: vitest/vite
#   pueden escribir su caché en node_modules/.vite del original (solo tiempos; git lo ignora).
# - Python: correr con el intérprete del .venv original desde DENTRO de la copia.
# Solo lee el original; nunca lo modifica.
set -euo pipefail
ORIG="$(cd "$1" && pwd)"
DEST="$2"
[ -e "$DEST" ] && { echo "ERROR: $DEST ya existe; usa una carpeta nueva" >&2; exit 1; }
mkdir -p "$DEST"
rsync -a \
  --include='.env.example' --include='.env.sample' --include='.env.template' \
  --exclude='.git' --exclude='node_modules' --exclude='.next' --exclude='.nuxt' --exclude='.venv' --exclude='.venv.*' --exclude='venv' \
  --exclude='/.claude/worktrees/' \
  --exclude='__pycache__' --exclude='.pytest_cache' --exclude='.mypy_cache' --exclude='dist' --exclude='build' \
  --exclude='.turbo' --exclude='.vercel' --exclude='.cache' --exclude='coverage' --exclude='.ua' \
  --exclude='.env' --exclude='.env.*' --exclude='*.session' --exclude='*.session-journal' --exclude='token.json' \
  --exclude='credentials*.json' --exclude='service-account*.json' --exclude='service_account*.json' \
  --exclude='*.pem' --exclude='*.key' --exclude='id_rsa*' --exclude='id_ed25519*' \
  --exclude='*.db' --exclude='*.sqlite' --exclude='*.sqlite3' --exclude='*.db-journal' --exclude='*.db-wal' \
  --exclude='/data/' --exclude='CLAUDE-SECURITY-*' --exclude='respaldo*/' --exclude='backup*/' \
  "$ORIG/" "$DEST/"
[ -d "$ORIG/node_modules" ] && ln -s "$ORIG/node_modules" "$DEST/node_modules"

# Verificación: ningún archivo de secretos debe haber llegado a la copia.
FUGAS=$(find "$DEST" -path "$DEST/node_modules" -prune -o -type f \( -name '.env' -o -name '.env.*' -o -name '*.session' \
  -o -name 'token.json' -o -name 'credentials*.json' -o -name '*.pem' -o -name '*.key' -o -name 'id_rsa*' \) -print \
  | grep -vE '\.env\.(example|sample|template)$' || true)
if [ -n "$FUGAS" ]; then
  echo "ERROR: quedaron archivos de secretos en la copia; se borra la copia" >&2
  rm -rf "$DEST"; exit 1
fi
echo "Copia segura lista: $DEST"
[ -x "$ORIG/.venv/bin/python" ] && echo "Python: usa $ORIG/.venv/bin/python desde dentro de la copia"
if grep -rqsE "load_dotenv|env_file|dotenv/config|from dotenv" --include='*.py' --include='*.ts' --include='*.js' "$DEST" 2>/dev/null; then
  echo "AVISO: el código carga .env. La copia no tiene .env, pero confirma que los imports se resuelven DENTRO de la copia (un paquete instalado en modo editable apunta al original)."
fi
