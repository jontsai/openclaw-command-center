#!/usr/bin/env bash
# Non-publishing release preflight. Version bumps belong in reviewed PRs.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "Usage: scripts/release.sh VERSION [--stage NEW_DIRECTORY]"
  echo "Checks metadata; optionally exports committed files. Never commits, tags, pushes or publishes."
  echo "See docs/releases/README.md for the separate publication procedure."
  exit 0
fi
if [[ "${1:-}" == "--current" ]]; then
  if [[ -f "$ROOT/VERSION" ]]; then cat "$ROOT/VERSION"; else node -p "require(process.argv[1]).version" "$ROOT/package.json"; fi
  exit 0
fi
exec node "$ROOT/scripts/release-check.js" "$@"
