#!/usr/bin/env bash
#
# Check: No Secrets
# Basic check for accidentally committed secrets
#
# Rule: AGENTS.md - never commit secrets, API keys, or credentials
#

REPO_ROOT="${1:-.}"

# Patterns that might indicate secrets
SECRET_PATTERNS=(
    'sk-[a-zA-Z0-9]{20,}'           # OpenAI API keys
    'xoxb-[0-9]+-[0-9]+-[a-zA-Z0-9]+' # Slack bot tokens
    'xoxp-[0-9]+-[0-9]+-[a-zA-Z0-9]+' # Slack user tokens
    'ghp_[a-zA-Z0-9]{36}'           # GitHub personal access tokens
    'gho_[a-zA-Z0-9]{36}'           # GitHub OAuth tokens
    'AKIA[0-9A-Z]{16}'              # AWS access key IDs
    'password\s*[=:]\s*["\047][^"\047]{8,}' # Hardcoded passwords
)

# Get staged file contents (only added/modified lines)
STAGED_DIFF=$(git diff --cached --diff-filter=AM 2>/dev/null || echo "")

FOUND_SECRETS=0

for pattern in "${SECRET_PATTERNS[@]}"; do
    if echo "$STAGED_DIFF" | grep -qE "$pattern"; then
        echo "  ⚠️  Potential secret detected matching pattern: $pattern"
        FOUND_SECRETS=1
    fi
done

if [[ $FOUND_SECRETS -eq 1 ]]; then
    echo "      Review staged changes and remove any secrets before committing."
    exit 1
fi

exit 0
