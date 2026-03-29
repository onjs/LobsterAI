#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const MEM0_DEPLOY_DIR = path.resolve(process.cwd(), 'deploy', 'mem0-qdrant');
const MEM0_ENV_FILE = path.join(MEM0_DEPLOY_DIR, '.env');
const MEM0_ENV_EXAMPLE_FILE = path.join(MEM0_DEPLOY_DIR, '.env.example');
const MEM0_CONFIG_EXAMPLE_FILE = path.join(MEM0_DEPLOY_DIR, 'config.qdrant.example.json');
const MEM0_CONFIG_FILE = path.join(MEM0_DEPLOY_DIR, 'config.qdrant.json');

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEnvFile(content) {
  const parsed = {};
  const lines = content.split(/\r?\n/g);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = unquote(match[2]);
    parsed[key] = value;
  }
  return parsed;
}

function loadEnvIntoProcess(filePath = MEM0_ENV_FILE) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = parseEnvFile(content);
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  }
  return true;
}

function interpolateEnvPlaceholders(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_all, envKey) => process.env[envKey] || '');
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateEnvPlaceholders(item));
  }
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = interpolateEnvPlaceholders(item);
    }
    return result;
  }
  return value;
}

module.exports = {
  MEM0_DEPLOY_DIR,
  MEM0_ENV_FILE,
  MEM0_ENV_EXAMPLE_FILE,
  MEM0_CONFIG_EXAMPLE_FILE,
  MEM0_CONFIG_FILE,
  loadEnvIntoProcess,
  interpolateEnvPlaceholders,
};
