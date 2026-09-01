#!/bin/bash
# Wrapper script to ensure PATH includes the local OpenClaw shim and system directories.
# nvm prepends its own bin directory when sourced, so set the final PATH after nvm loads.

# Find node - prefer nvm if available
if [ -f "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh"
fi

export PATH="$HOME/.local/bin:$HOME/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

cd "$(dirname "$0")/.."
exec node lib/server.js
