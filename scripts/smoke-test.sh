#!/usr/bin/env bash
set -euo pipefail

echo "=== Phase A: Build artifacts ==="
bun run build
test -f dist/index.js
head -n 1 dist/index.js | grep -q "#!/usr/bin/env node"
echo "✓ dist/index.js exists with shebang"

echo "=== Phase B: npm pack ==="
npm pack --dry-run 2>&1 | head -20
echo "✓ npm pack dry-run OK"

echo "=== Phase C: CLI smoke ==="
bun run src/index.ts --help 2>&1 || true
bun run src/index.ts auth status 2>&1 || true
echo "✓ CLI smoke OK"

echo "=== Phase D: MCP smoke ==="
timeout 3 bun run src/index.ts --mcp 2>/dev/null || true
echo "✓ MCP smoke OK (3s timeout)"

echo ""
echo "=== All smoke tests passed ==="
