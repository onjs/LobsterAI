#!/usr/bin/env node

const {
  loadEnvIntoProcess,
} = require('./mem0-env-utils.cjs');

loadEnvIntoProcess();

const MEM0_BASE_URL = (process.env.MEM0_BASE_URL || 'http://localhost:8888').trim().replace(/\/$/, '');
const MEM0_API_KEY = (process.env.MEM0_API_KEY || '').trim();
const QDRANT_BASE_URL = (process.env.QDRANT_BASE_URL || 'http://localhost:6333').trim().replace(/\/$/, '');

function buildMem0Headers() {
  const headers = {};
  if (MEM0_API_KEY) {
    headers['X-API-Key'] = MEM0_API_KEY;
  }
  return headers;
}

async function checkMem0Docs() {
  const url = `${MEM0_BASE_URL}/docs`;
  const response = await fetch(url, {
    method: 'GET',
    headers: buildMem0Headers(),
    redirect: 'manual',
  });
  const ok = response.status >= 200 && response.status < 400;
  return {
    ok,
    status: response.status,
    target: url,
    detail: ok ? 'reachable' : (await response.text()).slice(0, 200),
  };
}

async function checkMem0Search() {
  const url = `${MEM0_BASE_URL}/search`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...buildMem0Headers(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: 'health check',
      user_id: 'lobster-health-check',
      limit: 1,
    }),
  });

  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      target: url,
      detail: String(raw || '').slice(0, 200),
    };
  }

  return {
    ok: true,
    status: response.status,
    target: url,
    detail: Array.isArray(body?.results) ? `results=${body.results.length}` : 'ok',
  };
}

async function checkQdrantReady() {
  const url = `${QDRANT_BASE_URL}/readyz`;
  const response = await fetch(url, {
    method: 'GET',
  });

  const text = (await response.text()).trim();
  return {
    ok: response.ok,
    status: response.status,
    target: url,
    detail: text || (response.ok ? 'ok' : 'unhealthy'),
  };
}

async function main() {
  const [mem0Docs, mem0Search, qdrant] = await Promise.all([
    checkMem0Docs().catch((error) => ({
      ok: false,
      status: 0,
      target: `${MEM0_BASE_URL}/docs`,
      detail: error instanceof Error ? error.message : String(error),
    })),
    checkMem0Search().catch((error) => ({
      ok: false,
      status: 0,
      target: `${MEM0_BASE_URL}/search`,
      detail: error instanceof Error ? error.message : String(error),
    })),
    checkQdrantReady().catch((error) => ({
      ok: false,
      status: 0,
      target: `${QDRANT_BASE_URL}/readyz`,
      detail: error instanceof Error ? error.message : String(error),
    })),
  ]);

  console.log('[mem0-health] mem0-docs:', JSON.stringify(mem0Docs));
  console.log('[mem0-health] mem0-search:', JSON.stringify(mem0Search));
  console.log('[mem0-health] qdrant:', JSON.stringify(qdrant));

  if (!mem0Docs.ok || !mem0Search.ok || !qdrant.ok) {
    process.exitCode = 1;
    return;
  }

  console.log('[mem0-health] stack is healthy');
}

main().catch((error) => {
  console.error('[mem0-health] unexpected failure:', error);
  process.exitCode = 1;
});
