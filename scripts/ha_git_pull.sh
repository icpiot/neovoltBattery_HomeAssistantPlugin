#!/bin/bash

cd /config || exit 1

TOKEN_FILE="/config/.github_pat"
LOG_DIR="/config/www/ha-git"
LOG="$LOG_DIR/neovolt_git_last.txt"
SCRIPT_BUILD="2026-07-12.01"
REPO_URL="github.com/icpiot/neovoltBattery_HomeAssistantPlugin.git"
REPO_DIR="/config/repos/neovoltBattery_HomeAssistantPlugin"
SOURCE_CARD_DIR="$REPO_DIR/examples/www"
SOURCE_COMPONENT_DIR="$REPO_DIR/custom_components/bytewatt"
DEPLOY_CARD_DIR="/config/www/community/bytewatt-card"
DEPLOY_COMPONENT_DIR="/config/custom_components/bytewatt"
BRANCH="${BYTEWATT_GIT_BRANCH:-codex/provider-abstraction-refactor}"

mkdir -p "$LOG_DIR"

report_build_from_file() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "missing"
    return
  fi

  local line
  line="$(grep -m1 'BYTEWATT_REPORT_CARD_BUILD' "$file" 2>/dev/null || true)"
  if [ -n "$line" ]; then
    echo "$line" | sed -E 's/.*"([0-9]+)".*/\1/'
    return
  fi

  echo "error"
}

report_build_from_marker_file() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "missing"
    return
  fi

  local line
  line="$(tr -d '\r' < "$file" 2>/dev/null | head -n 1 || true)"
  if [ -n "$line" ] && [[ "$line" =~ ^[0-9]+$ ]]; then
    echo "$line"
    return
  fi

  line="$(grep -m1 'bytewatt-report-card.js?v=' "$file" 2>/dev/null || true)"
  if [ -n "$line" ]; then
    echo "$line" | sed -E 's/.*[?]v=([0-9]+).*/\1/'
    return
  fi

  echo "error"
}

debug_build_from_file() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "missing"
    return
  fi

  local line
  line="$(grep -m1 'BYTEWATT_DEBUG_CARD_BUILD' "$file" 2>/dev/null || true)"
  if [ -n "$line" ]; then
    echo "$line" | sed -E 's/.*"([0-9]+)".*/\1/'
    return
  fi

  echo "unknown"
}

integration_version_from_manifest() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "missing"
    return
  fi

  local line
  line="$(grep -m1 '"version"' "$file" 2>/dev/null || true)"
  if [ -n "$line" ]; then
    echo "$line" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
    return
  fi

  echo "unknown"
}

deploy_repo_to_ha() {
  echo ""
  echo "Deploying ByteWatt integration and cards into Home Assistant..."

  if [ ! -f "$SOURCE_CARD_DIR/bytewatt-policy-card.js" ]; then
    echo "ERROR: Missing source file: $SOURCE_CARD_DIR/bytewatt-policy-card.js"
    exit 1
  fi

  if [ ! -f "$SOURCE_CARD_DIR/bytewatt-report-card.js" ]; then
    echo "ERROR: Missing source file: $SOURCE_CARD_DIR/bytewatt-report-card.js"
    exit 1
  fi

  if [ ! -f "$SOURCE_CARD_DIR/bytewatt-debug-card.js" ]; then
    echo "ERROR: Missing source file: $SOURCE_CARD_DIR/bytewatt-debug-card.js"
    exit 1
  fi

  if [ ! -f "$SOURCE_COMPONENT_DIR/manifest.json" ]; then
    echo "ERROR: Missing integration manifest: $SOURCE_COMPONENT_DIR/manifest.json"
    exit 1
  fi

  mkdir -p "$DEPLOY_CARD_DIR"
  mkdir -p "$DEPLOY_COMPONENT_DIR"

  SOURCE_REPORT_BUILD="$(report_build_from_marker_file "$SOURCE_CARD_DIR/LATEST_REPORT_BUILD.txt")"
  if [ "$SOURCE_REPORT_BUILD" = "error" ] || [ "$SOURCE_REPORT_BUILD" = "missing" ]; then
    SOURCE_REPORT_BUILD="$(report_build_from_file "$SOURCE_CARD_DIR/bytewatt-report-card.js")"
  fi
  SOURCE_DEBUG_BUILD="$(debug_build_from_file "$SOURCE_CARD_DIR/bytewatt-debug-card.js")"
  DEPLOY_REPORT_BEFORE="$(report_build_from_marker_file "$REPO_DIR/examples/www/LATEST_REPORT_BUILD.txt")"
  if [ "$DEPLOY_REPORT_BEFORE" = "error" ] || [ "$DEPLOY_REPORT_BEFORE" = "missing" ]; then
    DEPLOY_REPORT_BEFORE="$(report_build_from_file "$DEPLOY_CARD_DIR/bytewatt-report-card.js")"
  fi
  DEPLOY_DEBUG_BEFORE="$(debug_build_from_file "$DEPLOY_CARD_DIR/bytewatt-debug-card.js")"
  SOURCE_COMPONENT_VERSION="$(integration_version_from_manifest "$SOURCE_COMPONENT_DIR/manifest.json")"
  DEPLOY_COMPONENT_VERSION_BEFORE="$(integration_version_from_manifest "$DEPLOY_COMPONENT_DIR/manifest.json")"

  echo "Report build (source): $SOURCE_REPORT_BUILD"
  echo "Report build (deploy before): $DEPLOY_REPORT_BEFORE"
  echo "Debug build (source): $SOURCE_DEBUG_BUILD"
  echo "Debug build (deploy before): $DEPLOY_DEBUG_BEFORE"
  echo "Integration version (source): $SOURCE_COMPONENT_VERSION"
  echo "Integration version (deploy before): $DEPLOY_COMPONENT_VERSION_BEFORE"

  cp -f "$SOURCE_CARD_DIR/bytewatt-policy-card.js" "$DEPLOY_CARD_DIR/bytewatt-policy-card.js"
  cp -f "$SOURCE_CARD_DIR/bytewatt-report-card.js" "$DEPLOY_CARD_DIR/bytewatt-report-card.js"
  cp -f "$SOURCE_CARD_DIR/bytewatt-debug-card.js" "$DEPLOY_CARD_DIR/bytewatt-debug-card.js"
  cp -a "$SOURCE_COMPONENT_DIR/." "$DEPLOY_COMPONENT_DIR/"

  DEPLOY_REPORT_AFTER="$(report_build_from_marker_file "$REPO_DIR/examples/www/LATEST_REPORT_BUILD.txt")"
  if [ "$DEPLOY_REPORT_AFTER" = "error" ] || [ "$DEPLOY_REPORT_AFTER" = "missing" ]; then
    DEPLOY_REPORT_AFTER="$(report_build_from_file "$DEPLOY_CARD_DIR/bytewatt-report-card.js")"
  fi
  DEPLOY_DEBUG_AFTER="$(debug_build_from_file "$DEPLOY_CARD_DIR/bytewatt-debug-card.js")"
  DEPLOY_COMPONENT_VERSION_AFTER="$(integration_version_from_manifest "$DEPLOY_COMPONENT_DIR/manifest.json")"

  if [ "$SOURCE_REPORT_BUILD" = "error" ] || [ "$SOURCE_REPORT_BUILD" = "missing" ] || [ "$DEPLOY_REPORT_BEFORE" = "error" ] || [ "$DEPLOY_REPORT_BEFORE" = "missing" ] || [ "$DEPLOY_REPORT_AFTER" = "error" ] || [ "$DEPLOY_REPORT_AFTER" = "missing" ]; then
    echo "ERROR: Unable to determine report build number."
    exit 1
  fi

  echo ""
  echo "Deployed files:"
  echo "  $SOURCE_CARD_DIR/bytewatt-policy-card.js -> $DEPLOY_CARD_DIR/bytewatt-policy-card.js"
  echo "  $SOURCE_CARD_DIR/bytewatt-report-card.js -> $DEPLOY_CARD_DIR/bytewatt-report-card.js"
  echo "  $SOURCE_CARD_DIR/bytewatt-debug-card.js -> $DEPLOY_CARD_DIR/bytewatt-debug-card.js"
  echo "  $SOURCE_COMPONENT_DIR -> $DEPLOY_COMPONENT_DIR"
  echo "Report build (deploy after): $DEPLOY_REPORT_AFTER"
  echo "Debug build (deploy after): $DEPLOY_DEBUG_AFTER"
  echo "Integration version (deploy after): $DEPLOY_COMPONENT_VERSION_AFTER"
  echo "VISIBLE UPDATE SUMMARY: HA report card now shows v${DEPLOY_REPORT_AFTER}, debug card v${DEPLOY_DEBUG_AFTER}, and backend version ${DEPLOY_COMPONENT_VERSION_AFTER}"
}

{
  echo "=============================="
  echo "Neovolt Git Pull"
  echo "Started: $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "Repo: $REPO_DIR"
  echo "Script Build: $SCRIPT_BUILD"
  echo "Auth: HTTPS token file"
  echo "Mode: current branch"
  echo "Log: $LOG"
  echo "=============================="
  echo ""
  echo "VISIBLE UPDATE SUMMARY: this log shows both frontend and backend deploy versions."
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
  echo "Checking tracked files..."
  if [ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ]; then
    echo "ERROR: Tracked files have local changes. Pull cancelled."
    echo ""
    git -C "$REPO_DIR" status --short --untracked-files=no
    exit 1
  fi

  echo "No tracked file changes found. Untracked files are ignored."
  echo ""
  echo "Fetching via HTTPS token..."
  git -C "$REPO_DIR" fetch "$AUTH_REMOTE" "$BRANCH" || exit 1

  echo "Checking out target branch..."
  git -C "$REPO_DIR" checkout -B "$BRANCH" FETCH_HEAD || exit 1

  LOCAL=$(git -C "$REPO_DIR" rev-parse HEAD)
  REMOTE=$(git -C "$REPO_DIR" rev-parse FETCH_HEAD)

  echo "Local:  $LOCAL"
  echo "Remote: $REMOTE"
  echo ""

  if [ "$LOCAL" = "$REMOTE" ]; then
    echo "Already up to date."
    deploy_repo_to_ha
    exit 0
  fi

  echo "Incoming commits:"
  git -C "$REPO_DIR" log --oneline HEAD..FETCH_HEAD
  echo ""

  echo "Pull complete."
  deploy_repo_to_ha
  echo "Finished: $(date '+%Y-%m-%d %H:%M:%S %Z')"
} > "$LOG" 2>&1

cat "$LOG"
