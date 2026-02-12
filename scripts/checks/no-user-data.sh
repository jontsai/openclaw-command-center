#!/usr/bin/env bash
#
# Check: No User Data
# Ensures user-specific data files are not staged for commit
#
# Rule: public/data/AGENTS.md - never commit operators.json or privacy-settings.json
#

REPO_ROOT="${1:-.}"

# Check if any user data files are staged
STAGED_FILES=$(git diff --cached --name-only 2>/dev/null || echo "")

USER_DATA_FILES=(
    "public/data/operators.json"
    "public/data/privacy-settings.json"
)

FOUND_USER_DATA=0

for file in "${USER_DATA_FILES[@]}"; do
    if echo "$STAGED_FILES" | grep -q "^$file$"; then
        echo "  ⚠️  User data file staged: $file"
        echo "      This file contains user-specific data and should not be committed."
        echo "      Use 'git reset HEAD $file' to unstage."
        FOUND_USER_DATA=1
    fi
done

if [[ $FOUND_USER_DATA -eq 1 ]]; then
    exit 1
fi

exit 0
