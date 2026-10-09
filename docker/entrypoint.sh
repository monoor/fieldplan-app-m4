#!/bin/sh
# Runs the server as PUID:PGID (Unraid: 99:100) and makes sure it owns the data directory.
# If the container is already started as a non-root user (docker run --user …), it just runs the command.
set -eu
DATA_DIR="${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-1000}"; PGID="${PGID:-1000}"
  case "$PUID$PGID" in *[!0-9]*) echo "PUID and PGID must be numbers" >&2; exit 1;; esac
  if [ "$PUID" = "0" ]; then echo "Refusing to run as root (PUID=0). Use 99/100 on Unraid." >&2; exit 1; fi
  mkdir -p "$DATA_DIR"
  if [ "$(stat -c %u:%g "$DATA_DIR")" != "$PUID:$PGID" ]; then
    echo "Setting owner of $DATA_DIR to $PUID:$PGID"
    chown -R "$PUID:$PGID" "$DATA_DIR"
  fi
  exec su-exec "$PUID:$PGID" "$@"
fi
exec "$@"
