#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  MEM0_CONFIG_FILE,
  loadEnvIntoProcess,
  interpolateEnvPlaceholders,
} = require('./mem0-env-utils.cjs');

loadEnvIntoProcess();

const MEM0_BASE_URL = (process.env.MEM0_BASE_URL || 'http://localhost:8888').trim().replace(/\/$/, '');
const MEM0_API_KEY = (process.env.MEM0_API_KEY || '').trim();
const DRY_RUN = process.argv.includes('--dry-run');

function buildHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (MEM0_API_KEY) {
    headers['X-API-Key'] = MEM0_API_KEY;
  }
  return headers;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('mem0 configure payload must be an object');
  }
  const vectorStore = payload.vector_store;
  if (!vectorStore || typeof vectorStore !== 'object') {
    throw new Error('vector_store is required');
  }
  const provider = String(vectorStore.provider || '').trim();
  if (!provider) {
    throw new Error('vector_store.provider is required');
  }

  if (provider === 'qdrant') {
    const config = vectorStore.config && typeof vectorStore.config === 'object'
      ? vectorStore.config
      : {};
    if (!String(config.host || '').trim()) {
      throw new Error('qdrant config host is required');
    }
    if (!Number.isFinite(Number(config.port))) {
      throw new Error('qdrant config port must be a finite number');
    }
  }

  const llm = payload.llm && typeof payload.llm === 'object' ? payload.llm : null;
  if (!llm || !String(llm.provider || '').trim()) {
    throw new Error('llm.provider is required');
  }

  const embedder = payload.embedder && typeof payload.embedder === 'object' ? payload.embedder : null;
  if (!embedder || !String(embedder.provider || '').trim()) {
    throw new Error('embedder.provider is required');
  }
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function buildPayloadFromEnv() {
  const qdrantHost = (process.env.QDRANT_HOST || 'qdrant').trim();
  const qdrantPort = Number(process.env.QDRANT_PORT || 6333);
  const qdrantApiKey = (process.env.QDRANT_API_KEY || '').trim();
  const qdrantCollectionName = (process.env.QDRANT_COLLECTION_NAME || 'mem0').trim();

  const llmProvider = (process.env.MEM0_LLM_PROVIDER || 'openai').trim();
  const llmModel = (process.env.MEM0_LLM_MODEL || 'gpt-4.1-nano-2025-04-14').trim();
  const llmApiKey = (process.env.MEM0_LLM_API_KEY || process.env.OPENAI_API_KEY || '').trim();

  const embedderProvider = (process.env.MEM0_EMBEDDER_PROVIDER || 'openai').trim();
  const embedderModel = (process.env.MEM0_EMBEDDER_MODEL || 'text-embedding-3-small').trim();
  const embedderApiKey = (process.env.MEM0_EMBEDDER_API_KEY || process.env.OPENAI_API_KEY || '').trim();

  const vectorConfig = {
    host: qdrantHost,
    port: qdrantPort,
    collection_name: qdrantCollectionName,
  };
  if (qdrantApiKey) {
    vectorConfig.api_key = qdrantApiKey;
  }

  const llmConfig = {
    model: llmModel,
    temperature: 0.2,
  };
  if (llmApiKey) {
    llmConfig.api_key = llmApiKey;
  }

  const embedderConfig = {
    model: embedderModel,
  };
  if (embedderApiKey) {
    embedderConfig.api_key = embedderApiKey;
  }

  return {
    version: 'v1.1',
    vector_store: {
      provider: 'qdrant',
      config: vectorConfig,
    },
    llm: {
      provider: llmProvider,
      config: llmConfig,
    },
    embedder: {
      provider: embedderProvider,
      config: embedderConfig,
    },
  };
}

function resolvePayload() {
  const envFile = (process.env.MEM0_CONFIG_FILE || '').trim();
  const configPath = envFile ? path.resolve(process.cwd(), envFile) : MEM0_CONFIG_FILE;
  if (fs.existsSync(configPath)) {
    const parsed = readJsonFile(configPath);
    return interpolateEnvPlaceholders(parsed);
  }
  return buildPayloadFromEnv();
}

async function main() {
  const payload = resolvePayload();
  validatePayload(payload);

  if (DRY_RUN) {
    console.log('[mem0-configure] dry-run payload:');
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const url = `${MEM0_BASE_URL}/configure`;
  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`mem0 configure failed (${response.status}): ${text.slice(0, 500)}`);
  }

  console.log('[mem0-configure] configured mem0 successfully');
  if (text.trim()) {
    console.log(`[mem0-configure] response: ${text.trim()}`);
  }
}

main().catch((error) => {
  console.error('[mem0-configure] failed to configure mem0:', error);
  process.exitCode = 1;
});
