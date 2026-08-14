#!/usr/bin/env bash
#
# Copy the clips somewhere that isn't this box.
#
# The clips are the only copy that ever existed — the full-rate video was
# never written, so there is no re-render if this disk dies, only loss. This
# runs daily from truman-backup.timer and is a no-op (with a reminder in the
# journal) until TRUMAN_BACKUP_DEST is set in /etc/truman/box.env.
#
# rsync -a and nothing cleverer: clips are append-only and tiny (a 12-hour
# day is ~20 MB), so "copy what's new" is the whole job. Deletions do NOT
# propagate — a backup that mirrors deletes isn't a backup, it's a second
# place to lose things. If the owner deletes an episode on the site, the
# backup keeps its copy until someone removes it by hand, deliberately.
#
set -euo pipefail

[[ -n "${TRUMAN_BOX_KEY:-}" ]] || source /etc/truman/box.env

CLIPS="${TRUMAN_CLIPS:-/var/lib/truman/clips}"
DEST="${TRUMAN_BACKUP_DEST:-}"

if [[ -z "$DEST" ]]; then
  echo "TRUMAN_BACKUP_DEST is unset — the clips exist on this disk and nowhere else."
  exit 0
fi

rsync -a --partial "$CLIPS/" "$DEST/"
echo "backed up $(find "$CLIPS" -name '*.mp4' | wc -l) clips to $DEST"
