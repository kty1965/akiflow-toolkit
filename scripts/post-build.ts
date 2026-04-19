import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Rewrite the bundled CLI entry's shebang to #!/usr/bin/env node so the
// published npm tarball is runnable in plain-Node environments. The source
// uses `#!/usr/bin/env bun` which is fine for `bun run` but breaks CDN
// installs where only Node is available.

const cliPath = "dist/af.js";
const NODE_SHEBANG = "#!/usr/bin/env node";
const BUN_SHEBANG = "#!/usr/bin/env bun";

if (!existsSync(cliPath)) {
  console.error(`[post-build] ${cliPath} not found — skipping shebang injection`);
  process.exit(0);
}

const content = readFileSync(cliPath, "utf-8");

if (content.startsWith(NODE_SHEBANG)) {
  console.log("[post-build] node shebang already present — skipping");
} else if (content.startsWith(BUN_SHEBANG)) {
  writeFileSync(cliPath, `${NODE_SHEBANG}${content.slice(BUN_SHEBANG.length)}`);
  console.log("[post-build] replaced bun shebang with node shebang");
} else if (!content.startsWith("#!/")) {
  writeFileSync(cliPath, `${NODE_SHEBANG}\n${content}`);
  console.log("[post-build] shebang prepended to dist/af.js");
} else {
  const firstLine = content.split("\n", 1)[0];
  console.warn(`[post-build] unexpected shebang '${firstLine}' — leaving untouched`);
}
