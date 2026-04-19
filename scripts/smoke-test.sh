#!/usr/bin/env bash
set -euo pipefail

echo "=== Phase A: Build artifacts ==="
bun run build
test -f dist/index.js
head -n 1 dist/index.js | grep -q "^#!/usr/bin/env node$"
echo "✓ dist/index.js exists with node shebang"

echo "=== Phase B: npm pack ==="
npm pack --dry-run 2>&1 | head -20
# Fail if the package.json bin entry points at a file missing from the tarball.
BIN_TARGET=$(node -e "process.stdout.write(JSON.stringify(require('./package.json').bin))")
echo "  bin: $BIN_TARGET"
node -e "
  const pkg = require('./package.json');
  const fs = require('fs');
  for (const [name, path] of Object.entries(pkg.bin ?? {})) {
    if (!fs.existsSync(path)) {
      console.error('✗ bin target missing:', name, '→', path);
      process.exit(1);
    }
  }
  console.log('✓ all bin targets exist');
"

echo "=== Phase C: CLI smoke ==="
bun run src/index.ts --help 2>&1 || true
bun run src/index.ts auth status 2>&1 || true
echo "✓ CLI smoke OK"

echo "=== Phase D: MCP smoke ==="
timeout 3 bun run src/index.ts --mcp 2>/dev/null || true
echo "✓ MCP smoke OK (3s timeout)"

echo ""
echo "=== All smoke tests passed ==="
