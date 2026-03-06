#!/bin/bash
#
# install-system-deps.sh - Install optional system dependencies
#
# Reads config/system-deps.json and installs missing packages
# using the detected package manager (apt, brew, dnf, etc.)
#
# Usage: ./scripts/install-system-deps.sh [--dry-run]
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DEPS_FILE="$PROJECT_DIR/config/system-deps.json"
DRY_RUN="${1:-}"

if [[ "$DRY_RUN" == "-h" || "$DRY_RUN" == "--help" ]]; then
    echo "Usage: install-system-deps.sh [--dry-run]"
    echo "  --dry-run    Show what would be installed without installing"
    exit 0
fi

if [[ ! -f "$DEPS_FILE" ]]; then
    echo "Error: $DEPS_FILE not found"
    exit 1
fi

echo "🦞 OpenClaw Command Center - System Dependencies"
echo "================================================="
echo ""

# Let node do all the heavy lifting — it parses the JSON, detects the
# platform/package-manager/chip, checks which binaries exist, and
# prints shell commands to stdout for us to eval.
node -e "
const { execSync } = require('child_process');
const os = require('os');
const deps = require('$DEPS_FILE');

const platform = process.platform === 'linux' ? 'linux' : process.platform === 'darwin' ? 'darwin' : null;
if (!platform) { console.log('echo \"Unsupported platform\"'); process.exit(0); }

// Detect package manager
const pmCandidates = platform === 'linux'
    ? ['apt', 'dnf', 'yum', 'pacman', 'apk']
    : ['brew'];
let pkgManager = null;
for (const pm of pmCandidates) {
    try { execSync('which ' + pm, { stdio: 'ignore' }); pkgManager = pm; break; } catch {}
}

console.log('Platform: ' + platform);
console.log('Package manager: ' + (pkgManager || 'none'));
console.log('');

if (!pkgManager) {
    console.log('No supported package manager found.');
    console.log('Supported: apt, dnf, yum, pacman, apk, brew');
    process.exit(1);
}

// Detect chip
let isAppleSilicon = false;
if (platform === 'darwin') {
    try {
        const chip = execSync('sysctl -n machdep.cpu.brand_string', { encoding: 'utf8' });
        isAppleSilicon = /apple/i.test(chip);
    } catch {}
}

const entries = deps[platform] || [];
let installed = 0, toInstall = 0;

for (const dep of entries) {
    if (dep.condition === 'intel' && isAppleSilicon) continue;
    const cmd = dep.install[pkgManager];
    if (!cmd) continue;

    let hasBinary = false;
    try { execSync('which ' + dep.binary, { stdio: 'ignore' }); hasBinary = true; } catch {}
    if (!hasBinary && dep.binary === 'osx-cpu-temp') {
        try { execSync('test -x ' + os.homedir() + '/bin/osx-cpu-temp', { stdio: 'ignore' }); hasBinary = true; } catch {}
    }

    if (hasBinary) {
        console.log('✅ ' + dep.name + ' — already installed (' + dep.purpose + ')');
        installed++;
    } else {
        toInstall++;
        if ('$DRY_RUN' === '--dry-run') {
            console.log('📦 ' + dep.name + ' — would install (' + dep.purpose + ')');
            console.log('   Command: ' + cmd);
        } else {
            console.log('📦 Installing ' + dep.name + ' — ' + dep.purpose + '...');
            console.log('   Running: ' + cmd);
            try {
                execSync(cmd, { stdio: 'inherit' });
                console.log('   ✅ Installed successfully');
            } catch (e) {
                console.log('   ⚠️  Install failed: ' + e.message);
            }
        }
    }
}

console.log('');
if ('$DRY_RUN' === '--dry-run') {
    console.log('Dry run complete. ' + installed + ' already installed, ' + toInstall + ' would be installed.');
} else {
    console.log('Done! ' + installed + ' already installed, ' + toInstall + ' newly installed.');
    if (toInstall > 0) {
        console.log('');
        console.log('Restart the Command Center to see enhanced vitals.');
    }
}
"
