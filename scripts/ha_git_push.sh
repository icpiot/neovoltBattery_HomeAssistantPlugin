#!/bin/bash

cd /config || exit 1

TOKEN_FILE="/config/.github_pat"
LOG_DIR="/config/www/ha-git"
LOG="$LOG_DIR/neovolt_git_last.txt"
SCRIPT_BUILD="2026-07-07.01"
REPO_URL="github.com/icpiot/neovoltBattery_HomeAssistantPlugin.git"
REPO_DIR="/config/repos/neovoltBattery_HomeAssistantPlugin"
BRANCH="${BYTEWATT_GIT_BRANCH:-codex/provider-abstraction-refactor}"

mkdir -p "$LOG_DIR"

{
  echo "=============================="
  echo "Neovolt Git Push"
  echo "Started: $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "Repo: $REPO_DIR"
  echo "Script Build: $SCRIPT_BUILD"
  echo "Auth: HTTPS token file"
  echo "Mode: current branch"
  echo "Log: $LOG"
  echo "=============================="
  echo ""

  if [ ! -d "$REPO_DIR/.git" ]; then
    echo "ERROR: repo clone not found: $REPO_DIR"
    exit 1
  fi

  if [ ! -f "$TOKEN_FILE" ]; then
    echo "ERROR: Token file missing: $TOKEN_FILE"
    exit 1
  fi

  TOKEN=$(tr -d '[:space:]' < "$TOKEN_FILE")
  if [ -z "$TOKEN" ]; then
    echo "ERROR: Token file is empty."
    exit 1
  fi

  AUTH_REMOTE="https://icpiot:${TOKEN}@${REPO_URL}"

  echo "Branch: $BRANCH"
  echo ""
  echo "Fetching remote branch..."
  git -C "$REPO_DIR" fetch "$AUTH_REMOTE" "$BRANCH" || exit 1

  echo "Checking out target branch..."
  git -C "$REPO_DIR" checkout -B "$BRANCH" FETCH_HEAD || exit 1

  LOCAL=$(git -C "$REPO_DIR" rev-parse HEAD)
  REMOTE=$(git -C "$REPO_DIR" rev-parse FETCH_HEAD)

  echo "Local:  $LOCAL"
  echo "Remote: $REMOTE"
  echo ""

  if [ "$LOCAL" != "$REMOTE" ]; then
    echo "ERROR: Local branch is not aligned with remote branch."
    echo "Run Git Pull first before pushing."
    exit 1
  fi

  echo "Checking for changes..."
  CHANGES=$(git -C "$REPO_DIR" status --porcelain)

  if [ -z "$CHANGES" ]; then
    echo "Nothing to commit. Working tree clean."
    exit 0
  fi

  echo "Changes found:"
  git -C "$REPO_DIR" status --short
  echo ""
  echo "Staging repo-managed ByteWatt files..."

  git -C "$REPO_DIR" add \
    README.md \
    examples/README_Bytewatt.md \
    scripts/ \
    custom_components/bytewatt/ \
    examples/www/bytewatt-policy-card.js \
    examples/www/bytewatt-report-card.js \
    examples/www/bytewatt-debug-card.js \
    examples/www/LATEST_BUILD.txt \
    examples/www/LATEST_REPORT_BUILD.txt \
    examples/www/LATEST_DEBUG_BUILD.txt \
    tests/ \
    2>/dev/null

  echo ""
  echo "Staged changes:"
  git -C "$REPO_DIR" diff --cached --name-status
  echo ""

  if [ -z "$(git -C "$REPO_DIR" diff --cached --name-only)" ]; then
    echo "No approved files were staged. Push cancelled."
    exit 1
  fi

  MSG="Neovolt repo-managed update $(date '+%Y-%m-%d %H:%M:%S %Z')"

  echo "Committing: $MSG"
  git -C "$REPO_DIR" commit -m "$MSG" || exit 1

  echo ""
  echo "Pushing to remote branch $BRANCH..."
  git -C "$REPO_DIR" push "$AUTH_REMOTE" "$BRANCH" || exit 1

  echo ""
  echo "Push complete."
  echo "Finished: $(date '+%Y-%m-%d %H:%M:%S %Z')"
} > "$LOG" 2>&1

cat "$LOG"
