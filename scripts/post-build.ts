import { existsSync, readFileSync, writeFileSync } from "node:fs";

const cliPath = "dist/index.js";

if (!existsSync(cliPath)) {
  console.error(`[post-build] ${cliPath} not found — skipping shebang injection`);
  process.exit(0);
}

const content = readFileSync(cliPath, "utf-8");

if (!content.startsWith("#!/")) {
  writeFileSync(cliPath, `#!/usr/bin/env node\n${content}`);
  console.log("[post-build] shebang added to dist/index.js");
} else {
  console.log("[post-build] shebang already present — skipping");
}
