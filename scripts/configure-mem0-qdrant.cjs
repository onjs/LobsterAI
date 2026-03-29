#!/usr/bin/env node

const MEM0_BASE_URL = (process.env.MEM0_BASE_URL || 'http://localhost:8888').trim().replace(/\/$/, '');
const MEM0_API_KEY = (process.env.MEM0_API_KEY || '').trim();

const QDRANT_HOST = (process.env.QDRANT_HOST || 'qdrant').trim();
const QDRANT_PORT = Number(process.env.QDRANT_PORT || 6333);
const QDRANT_API_KEY = (process.env.QDRANT_API_KEY || '').trim();
const QDRANT_COLLECTION_NAME = (process.env.QDRANT_COLLECTION_NAME || 'mem0').trim();

const LLM_PROVIDER = (process.env.MEM0_LLM_PROVIDER || 'openai').trim();
const LLM_MODEL = (process.env.MEM0_LLM_MODEL || 'gpt-4.1-nano-2025-04-14').trim();
const LLM_API_KEY = (process.env.MEM0_LLM_API_KEY || process.env.OPENAI_API_KEY || '').trim();

const EMBEDDER_PROVIDER = (process.env.MEM0_EMBEDDER_PROVIDER || 'openai').trim();
const EMBEDDER_MODEL = (process.env.MEM0_EMBEDDER_MODEL || 'text-embedding-3-small').trim();
const EMBEDDER_API_KEY = (process.env.MEM0_EMBEDDER_API_KEY || process.env.OPENAI_API_KEY || '').trim();

function buildHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (MEM0_API_KEY) {
    headers['X-API-Key'] = MEM0_API_KEY;
  }
  return headers;
}

function buildConfigPayload() {
  const vectorConfig = {
    host: QDRANT_HOST,
    port: QDRANT_PORT,
    collection_name: QDRANT_COLLECTION_NAME,
  };
  if (QDRANT_API_KEY) {
    vectorConfig.api_key = QDRANT_API_KEY;
  }

  const llmConfig = {
    model: LLM_MODEL,
    temperature: 0.2,
  };
  if (LLM_API_KEY) {
    llmConfig.api_key = LLM_API_KEY;
  }

  const embedderConfig = {
    model: EMBEDDER_MODEL,
  };
  if (EMBEDDER_API_KEY) {
    embedderConfig.api_key = EMBEDDER_API_KEY;
  }

  return {
    version: 'v1.1',
    vector_store: {
      provider: 'qdrant',
      config: vectorConfig,
    },
    llm: {
      provider: LLM_PROVIDER,
      config: llmConfig,
    },
    embedder: {
      provider: EMBEDDER_PROVIDER,
      config: embedderConfig,
    },
  };
}

async function main() {
  const payload = buildConfigPayload();
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

  console.log('[mem0-configure] configured mem0 vector_store=qdrant successfully');
  if (text.trim()) {
    console.log(`[mem0-configure] response: ${text.trim()}`);
  }
}

main().catch((error) => {
  console.error('[mem0-configure] failed to configure mem0:', error);
  process.exitCode = 1;
});
