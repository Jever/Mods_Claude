#!/bin/bash
input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name')
CURRENT_DIR=$(echo "$input" | jq -r '.workspace.current_dir')
SESSION_ID=$(echo "$input" | jq -r '.session_id')
COST_FILE="$HOME/.claude/mods-state/cost-$SESSION_ID.json"
COST=$(jq -r 'if (.usd | type) == "number" then .usd else empty end' "$COST_FILE" 2>/dev/null)
if [ -z "$COST" ]; then
    COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
fi
UNKNOWN=$(jq -r 'if ((.unknown // []) | length) > 0 then " ⚠" else "" end' "$COST_FILE" 2>/dev/null)
PERCENT_USED=$(echo "$input" | jq -r '.context_window.used_percentage // 0')
DURATION_MS=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')
# ANSI colors
ORANGE='\033[38;5;208m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
CYAN='\033[36m'
RESET='\033[0m'
# Color context percentage based on usage
PERCENT_INT=$(printf '%.0f' "$PERCENT_USED")
if [ "$PERCENT_INT" -lt 50 ]; then
    CTX_COLOR=$GREEN
elif [ "$PERCENT_INT" -lt 80 ]; then
    CTX_COLOR=$YELLOW
else
    CTX_COLOR=$RED
fi
# Format session duration
DURATION_SEC=$(( DURATION_MS / 1000 ))
DURATION_MIN=$(( DURATION_SEC / 60 ))
DURATION_HR=$(( DURATION_MIN / 60 ))
if [ "$DURATION_HR" -gt 0 ]; then
    DURATION_FMT="${DURATION_HR}h$((DURATION_MIN % 60))m"
else
    DURATION_FMT="${DURATION_MIN}m$((DURATION_SEC % 60))s"
fi
COST_FMT=$(printf '%.2f' "$COST")
# Git branch (only if inside a git repo)
GIT_BRANCH=$(git -C "$CURRENT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ -n "$GIT_BRANCH" ]; then
    BRANCH_PART=" 🌿 ${GREEN}${GIT_BRANCH}${RESET}"
else
    BRANCH_PART=""
fi
PERCENT_AVAIL=$(( 100 - PERCENT_INT ))
echo -e "📁 ${CURRENT_DIR##*/}${BRANCH_PART} 💰 ${CYAN}\$${COST_FMT}${RESET}${UNKNOWN} ⏱️ ${DURATION_FMT} ${CTX_COLOR}🧠 ${PERCENT_INT}%↑/${PERCENT_AVAIL}%↓${RESET} 🤖 ${ORANGE}[$MODEL]${RESET}"
