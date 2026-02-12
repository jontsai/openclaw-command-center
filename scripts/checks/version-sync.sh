#!/usr/bin/env bash
#
# Check: Version Sync
# Ensures package.json and SKILL.md versions are in sync
#
# Rule: AGENTS.md / CONTRIBUTING.md - versions must match
#

REPO_ROOT="${1:-.}"

# Extract version from package.json
PKG_VERSION=$(grep -o '"version": *"[^"]*"' "$REPO_ROOT/package.json" | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')

# Extract version from SKILL.md frontmatter
SKILL_VERSION=$(grep -E '^version:' "$REPO_ROOT/SKILL.md" | head -1 | sed 's/version: *//')

if [[ -z "$PKG_VERSION" ]]; then
    echo "  ⚠️  Could not read version from package.json"
    exit 1
fi

if [[ -z "$SKILL_VERSION" ]]; then
    echo "  ⚠️  Could not read version from SKILL.md"
    exit 1
fi

if [[ "$PKG_VERSION" != "$SKILL_VERSION" ]]; then
    echo "  ⚠️  Version mismatch:"
    echo "      package.json: $PKG_VERSION"
    echo "      SKILL.md:     $SKILL_VERSION"
    echo "  → Both files must have the same version"
    exit 1
fi

exit 0
