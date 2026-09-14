#!/bin/sh
# Entrypoint for the FANUC backend container.
#
# Docker creates bind-mounted volumes owned by root, but the server runs as the
# unprivileged "app" user (UID 10001). This script fixes ownership of the
# writable paths and then drops privileges via su-exec so the application
# process itself never runs as root.
#
# If the chown fails (e.g. a read-only mount or an NFS volume with root squash)
# we log a warning and continue: refusing to start would be worse than running
# with the previous ownership, and root-owned storage is already the status quo.
set -e

APP_UID="${APP_UID:-10001}"
APP_GID="${APP_GID:-10001}"

# /app/uploads is the only bind mount the server writes to; the backup endpoints
# stream through os.CreateTemp (/tmp, world-writable).
APP_WRITABLE_DIRS="/app/uploads"

for dir in $APP_WRITABLE_DIRS; do
    if [ -d "$dir" ]; then
        if ! chown -R "$APP_UID:$APP_GID" "$dir" 2>/dev/null; then
            echo "warning: could not chown $dir to $APP_UID:$APP_GID; uploads may fail if the volume is not writable by that uid" >&2
        fi
    fi
done

# Already running as non-root (e.g. docker run --user): nothing to drop.
if [ "$(id -u)" != "0" ]; then
    exec "$@"
fi

exec su-exec "$APP_UID:$APP_GID" "$@"
