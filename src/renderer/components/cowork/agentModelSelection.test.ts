import { describe, expect, test } from 'vitest';
import type { Model } from '../../store/slices/modelSlice';
import { resolveAgentModelSelection } from './agentModelSelection';

const models: Model[] = [
  { id: 'gpt-4o', name: 'GPT-4o', providerKey: 'openai' },
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', providerKey: 'anthropic' },
];

describe('resolveAgentModelSelection', () => {
  test('uses explicit agent model when present', () => {
    const result = resolveAgentModelSelection({
      agentModel: 'claude-sonnet-4',
      availableModels: models,
      fallbackModel: models[0],
      engine: 'openclaw',
    });

    expect(result.selectedModel?.id).toBe('claude-sonnet-4');
    expect(result.usesFallback).toBe(false);
  });

  test('supports provider-prefixed agent model identity', () => {
    const result = resolveAgentModelSelection({
      agentModel: 'openai/gpt-4o',
      availableModels: models,
      fallbackModel: models[1],
      engine: 'openclaw',
    });

    expect(result.selectedModel?.id).toBe('gpt-4o');
    expect(result.selectedModel?.providerKey).toBe('openai');
    expect(result.usesFallback).toBe(false);
  });

  test('falls back to global model when explicit model is missing', () => {
    const result = resolveAgentModelSelection({
      agentModel: 'unknown-model',
      availableModels: models,
      fallbackModel: models[0],
      engine: 'openclaw',
    });

    expect(result.selectedModel?.id).toBe('gpt-4o');
    expect(result.usesFallback).toBe(true);
  });
});
