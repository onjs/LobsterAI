#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  MEM0_DEPLOY_DIR,
  MEM0_ENV_FILE,
  MEM0_ENV_EXAMPLE_FILE,
  MEM0_CONFIG_EXAMPLE_FILE,
  MEM0_CONFIG_FILE,
} = require('./mem0-env-utils.cjs');

function copyIfMissing(sourcePath, targetPath) {
  if (fs.existsSync(targetPath)) {
    return false;
  }
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

function main() {
  if (!fs.existsSync(MEM0_DEPLOY_DIR)) {
    throw new Error(`deploy directory not found: ${MEM0_DEPLOY_DIR}`);
  }

  const envCreated = copyIfMissing(MEM0_ENV_EXAMPLE_FILE, MEM0_ENV_FILE);
  const configCreated = copyIfMissing(MEM0_CONFIG_EXAMPLE_FILE, MEM0_CONFIG_FILE);

  if (envCreated) {
    console.log(`[mem0-init] created ${path.relative(process.cwd(), MEM0_ENV_FILE)}`);
  } else {
    console.log('[mem0-init] .env already exists, keep current values');
  }

  if (configCreated) {
    console.log(`[mem0-init] created ${path.relative(process.cwd(), MEM0_CONFIG_FILE)}`);
  } else {
    console.log('[mem0-init] config.qdrant.json already exists, keep current values');
  }

  console.log('[mem0-init] next step: set OPENAI_API_KEY (+ OPENAI_BASE_URL for compatibility APIs), then run npm run mem0:stack:up');
}

try {
  main();
} catch (error) {
  console.error('[mem0-init] failed:', error);
  process.exitCode = 1;
}
