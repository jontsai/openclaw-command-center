#!/usr/bin/env bash
#
# release.sh - Create a versioned release with git tag and ClawHub publish
#
# Usage:
#   ./scripts/release.sh <version>           # Create tag + publish
#   ./scripts/release.sh <version> --tag-only # Create tag only
#   ./scripts/release.sh --current           # Show current version
#
# Examples:
#   ./scripts/release.sh 0.4.0
#   ./scripts/release.sh 1.0.0-beta.1
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_DIR"

# Get current version from latest tag
get_current_version() {
    git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo "0.0.0"
}

# Show help
show_help() {
    echo "Usage: release.sh <version> [--tag-only]"
    echo "       release.sh --current"
    echo ""
    echo "Options:"
    echo "  <version>     Semver version (e.g., 0.4.0, 1.0.0-beta.1)"
    echo "  --tag-only    Create git tag without ClawHub publish"
    echo "  --current     Show current version from git tags"
    echo "  -h, --help    Show this help"
}

# Parse args
if [[ $# -eq 0 ]]; then
    show_help
    exit 1
fi

TAG_ONLY=false
VERSION=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --current)
            echo "Current version: $(get_current_version)"
            exit 0
            ;;
        --tag-only)
            TAG_ONLY=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            VERSION="$1"
            shift
            ;;
    esac
done

if [[ -z "$VERSION" ]]; then
    echo "❌ Version required"
    show_help
    exit 1
fi

# Validate semver (basic check)
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
    echo "❌ Invalid semver: $VERSION"
    echo "   Expected format: X.Y.Z or X.Y.Z-prerelease"
    exit 1
fi

TAG="v$VERSION"
CURRENT=$(get_current_version)

echo "📦 Release: $CURRENT → $VERSION"
echo ""

# Check for uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "❌ Uncommitted changes detected. Commit or stash first."
    exit 1
fi

# Check if tag already exists
if git rev-parse "$TAG" >/dev/null 2>&1; then
    echo "❌ Tag $TAG already exists"
    exit 1
fi

# Update package.json version
if [[ -f package.json ]]; then
    # Use npm version without git tag (we do our own tagging)
    npm version "$VERSION" --no-git-tag-version
fi

# Update SKILL.md version if it exists
if [[ -f SKILL.md ]]; then
    sed -i '' "s/\*\*Version\*\* | \`[^\"]*\`/\*\*Version\*\* | \`$VERSION\`/" SKILL.md 2>/dev/null || \
    sed -i "s/\*\*Version\*\* | \`[^\"]*\`/\*\*Version\*\* | \`$VERSION\`/" SKILL.md
fi

# Commit version bump
git add package.json package-lock.json SKILL.md 2>/dev/null || true
git commit -m "chore: release v$VERSION" --allow-empty

# Create annotated tag
echo "🏷️  Creating tag $TAG..."
git tag -a "$TAG" -m "Release $VERSION"

# Push commit and tag
echo "⬆️  Pushing to origin..."
git push origin main
git push origin "$TAG"

echo ""
echo "✅ Tagged $TAG"

# Publish to ClawHub unless --tag-only
if [[ "$TAG_ONLY" == "false" ]]; then
    echo ""
    echo "📤 Publishing to ClawHub..."
    
    # Get changelog from CHANGELOG.md if available
    CHANGELOG=""
    if [[ -f CHANGELOG.md ]]; then
        CHANGELOG=$(awk '/^## \['"$VERSION"'\]/{found=1; next} /^## \[/{if(found) exit} found{print}' CHANGELOG.md | head -20)
    fi
    
    if command -v clawhub &>/dev/null; then
        if [[ -n "$CHANGELOG" ]]; then
            clawhub publish . --version "$VERSION" --changelog "$CHANGELOG"
        else
            clawhub publish . --version "$VERSION" --changelog "Release v$VERSION"
        fi
        echo ""
        echo "✅ Published to ClawHub: $VERSION"
    else
        echo "⚠️  clawhub CLI not found. Skipping ClawHub publish."
        echo "   Install: npm install -g clawhub"
    fi
fi

echo ""
echo "🎉 Release $VERSION complete!"
echo ""
echo "   Git tag: $TAG"
echo "   GitHub:  https://github.com/jontsai/openclaw-command-center/releases/tag/$TAG"
