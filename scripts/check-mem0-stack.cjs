#!/usr/bin/env node

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

async function checkMem0() {
  const url = `${MEM0_BASE_URL}/docs`;
  const response = await fetch(url, {
    method: 'GET',
    headers: buildMem0Headers(),
    redirect: 'manual',
  });

  if (response.status >= 200 && response.status < 400) {
    return {
      ok: true,
      status: response.status,
      target: url,
    };
  }

  const text = await response.text();
  return {
    ok: false,
    status: response.status,
    target: url,
    detail: text.slice(0, 200),
  };
}

async function checkQdrant() {
  const url = `${QDRANT_BASE_URL}/readyz`;
  const response = await fetch(url, {
    method: 'GET',
  });

  const text = (await response.text()).trim();
  if (response.ok) {
    return {
      ok: true,
      status: response.status,
      target: url,
      detail: text || 'ok',
    };
  }

  return {
    ok: false,
    status: response.status,
    target: url,
    detail: text.slice(0, 200),
  };
}

async function main() {
  const [mem0, qdrant] = await Promise.all([
    checkMem0().catch((error) => ({
      ok: false,
      status: 0,
      target: `${MEM0_BASE_URL}/docs`,
      detail: error instanceof Error ? error.message : String(error),
    })),
    checkQdrant().catch((error) => ({
      ok: false,
      status: 0,
      target: `${QDRANT_BASE_URL}/readyz`,
      detail: error instanceof Error ? error.message : String(error),
    })),
  ]);

  console.log('[mem0-health] mem0:', JSON.stringify(mem0));
  console.log('[mem0-health] qdrant:', JSON.stringify(qdrant));

  if (!mem0.ok || !qdrant.ok) {
    process.exitCode = 1;
    return;
  }

  console.log('[mem0-health] stack is healthy');
}

main().catch((error) => {
  console.error('[mem0-health] unexpected failure:', error);
  process.exitCode = 1;
});
