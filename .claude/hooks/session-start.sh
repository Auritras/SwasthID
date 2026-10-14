#!/bin/bash
# Claude Code on the web: install the agent skills used for design work on
# SwasthID. The skills come from their own GitHub repositories each time a
# fresh container starts; they are not committed here (see .gitignore).
# Safe to run more than once: a skill that is already installed is skipped.
# A failed download only prints a warning, so it never blocks the session.
set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
export DO_NOT_TRACK=1

# repository|skill names
SKILLS=(
  "https://github.com/emilkowalski/skills|apple-design"
  "https://github.com/pbakaus/impeccable|impeccable"
  "https://github.com/Leonxlnx/taste-skill|design-taste-frontend redesign-existing-projects high-end-visual-design minimalist-ui"
)

for entry in "${SKILLS[@]}"; do
  repo=${entry%%|*}
  missing=()
  for skill in ${entry#*|}; do
    [ -f ".agents/skills/$skill/SKILL.md" ] || missing+=("$skill")
  done
  [ ${#missing[@]} -eq 0 ] && continue
  args=()
  for skill in "${missing[@]}"; do args+=(--skill "$skill"); done
  if ! timeout 180 npx --yes skills add "$repo" "${args[@]}" -y </dev/null >/dev/null 2>&1; then
    echo "session-start: could not install ${missing[*]} from $repo" >&2
  fi
done

exit 0
