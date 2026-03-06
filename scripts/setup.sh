#!/bin/bash
# OpenClaw Command Center - First-time setup
# Creates necessary directories and config file

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_DIR="$PROJECT_DIR/config"

echo "🦞 OpenClaw Command Center Setup"
echo "================================="
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 20+ first."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "⚠️  Node.js version $NODE_VERSION detected. Version 20+ recommended."
fi

# Install dependencies
echo "📦 Installing dependencies..."
cd "$PROJECT_DIR"
npm install --silent

# Create config if not exists
if [ ! -f "$CONFIG_DIR/dashboard.json" ]; then
    echo ""
    echo "📝 Creating configuration file..."
    cp "$CONFIG_DIR/dashboard.example.json" "$CONFIG_DIR/dashboard.json"
    echo "   Created: config/dashboard.json"
    echo ""
    echo "   Edit this file to customize your dashboard."
else
    echo "   Config file already exists: config/dashboard.json"
fi

# Create log directory
LOG_DIR="$HOME/.openclaw-command-center/logs"
mkdir -p "$LOG_DIR"
echo "   Log directory: $LOG_DIR"

# Detect workspace
echo ""
echo "🔍 Detecting OpenClaw workspace..."

DETECTED_WORKSPACE=""
for candidate in \
    "$OPENCLAW_WORKSPACE" \
    "$HOME/openclaw-workspace" \
    "$HOME/.openclaw-workspace" \
    "$HOME/molty" \
    "$HOME/clawd" \
    "$HOME/moltbot"; do
    if [ -n "$candidate" ] && [ -d "$candidate" ]; then
        if [ -d "$candidate/memory" ] || [ -d "$candidate/state" ]; then
            DETECTED_WORKSPACE="$candidate"
            break
        fi
    fi
done

if [ -n "$DETECTED_WORKSPACE" ]; then
    echo "   ✅ Found workspace: $DETECTED_WORKSPACE"
else
    echo "   ⚠️  No existing workspace found."
    echo "   The dashboard will create ~/.openclaw-workspace on first run,"
    echo "   or you can set OPENCLAW_WORKSPACE environment variable."
fi

# Create Makefile.local if not exists
if [ ! -f "$PROJECT_DIR/Makefile.local" ]; then
    echo ""
    echo "📝 Creating Makefile.local with 'lfg' command..."
    cat > "$PROJECT_DIR/Makefile.local" << 'EOF'
# Private Makefile overrides (not tracked in git)

.PHONY: lfg

lfg: ## Start dashboard and drop into cockpit
	@$(MAKE) ensure
	@$(MAKE) attach
EOF
    echo "   Created: Makefile.local"
fi

# Check optional system dependencies
echo ""
echo "🔍 Checking optional system dependencies..."

OS_TYPE="$(uname -s)"
OPT_MISSING=0

if [ "$OS_TYPE" = "Linux" ]; then
    if command -v iostat &> /dev/null; then
        echo "   ✅ sysstat (iostat) — disk I/O vitals"
    else
        echo "   💡 sysstat — install for disk I/O vitals: sudo apt install sysstat"
        OPT_MISSING=$((OPT_MISSING + 1))
    fi
    if command -v sensors &> /dev/null; then
        echo "   ✅ lm-sensors — temperature sensors"
    else
        echo "   💡 lm-sensors — install for temperature sensors: sudo apt install lm-sensors"
        OPT_MISSING=$((OPT_MISSING + 1))
    fi
elif [ "$OS_TYPE" = "Darwin" ]; then
    # Check for Apple Silicon vs Intel
    CHIP="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "")"
    if echo "$CHIP" | grep -qi "apple"; then
        if sudo -n true 2>/dev/null; then
            echo "   ✅ passwordless sudo — Apple Silicon CPU temperature"
        else
            echo "   💡 passwordless sudo — configure for CPU temperature via powermetrics"
        fi
    else
        if command -v osx-cpu-temp &> /dev/null || [ -x "$HOME/bin/osx-cpu-temp" ]; then
            echo "   ✅ osx-cpu-temp — Intel Mac CPU temperature"
        else
            echo "   💡 osx-cpu-temp — install for CPU temperature: https://github.com/lavoiesl/osx-cpu-temp"
            OPT_MISSING=$((OPT_MISSING + 1))
        fi
    fi
fi

if [ "$OPT_MISSING" -eq 0 ]; then
    echo "   All optional dependencies available!"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Quick start:"
echo "  cd $PROJECT_DIR"
echo "  make start        # Start dashboard"
echo "  make lfg          # Start and attach to tmux"
echo ""
echo "Dashboard will be available at: http://localhost:3333"
