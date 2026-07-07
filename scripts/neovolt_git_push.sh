#!/bin/bash

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec "$SCRIPT_DIR/ha_git_push.sh" "$@"
