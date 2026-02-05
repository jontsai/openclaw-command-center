#!/bin/bash
#
# verify.sh - Quick dashboard verification script
#
# Checks that all APIs return data and the dashboard is responsive.
#
# Usage: ./scripts/verify.sh [--url URL]
#

set -euo pipefail

DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3333}"

# Parse args
while [[ $# -gt 0 ]]; do
    case "$1" in
        --url) DASHBOARD_URL="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: verify.sh [--url URL]"
            echo "  --url URL    Dashboard URL (default: http://localhost:3333)"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

echo "🔍 Verifying dashboard at $DASHBOARD_URL..."
echo ""

# Track failures
FAILURES=0

# Check server responds
echo -n "📡 Server response... "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$DASHBOARD_URL" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]]; then
    echo "✅ OK (HTTP $HTTP_CODE)"
else
    echo "❌ FAILED (HTTP $HTTP_CODE)"
    ((FAILURES++))
fi

# Check each API endpoint
ENDPOINTS=(
    "vitals:vitals"
    "operators:operators"
    "llm-usage:claude"
    "memory:memory"
    "cerebro:topics"
    "cron:cron"
)

echo ""
echo "📊 API Endpoints:"

for entry in "${ENDPOINTS[@]}"; do
    endpoint="${entry%%:*}"
    key="${entry##*:}"
    
    echo -n "   /api/$endpoint... "
    response=$(curl -s --max-time 5 "$DASHBOARD_URL/api/$endpoint" 2>/dev/null || echo "")
    
    if [[ -z "$response" ]]; then
        echo "❌ No response"
        ((FAILURES++))
    elif echo "$response" | grep -q "\"$key\""; then
        echo "✅ OK"
    elif echo "$response" | grep -q "error"; then
        echo "⚠️  Error in response"
        ((FAILURES++))
    else
        echo "⚠️  Unexpected format"
    fi
done

echo ""

# Summary
if [[ $FAILURES -eq 0 ]]; then
    echo "✅ All checks passed!"
    exit 0
else
    echo "❌ $FAILURES check(s) failed"
    exit 1
fi
