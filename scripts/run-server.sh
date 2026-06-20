#!/bin/bash
# Wrapper script to ensure PATH includes system directories.
# Put ~/.local/bin first so LaunchAgent-launched instances use the source-built
# OpenClaw wrapper instead of an older npm-global binary from an nvm bin dir.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Find node - prefer nvm if available, and honor this repo's pinned version.
if [ -f "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh"
fi

cd "$(dirname "$0")/.."
if command -v nvm >/dev/null 2>&1 && [ -f .nvmrc ]; then
    nvm use --silent >/dev/null
fi
export PATH="$HOME/.local/bin:$PATH"

exec node lib/server.js
