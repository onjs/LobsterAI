import type { CoworkAgentEngine } from '../../types/cowork';
import type { Model } from '../../store/slices/modelSlice';

type ResolveAgentModelSelectionInput = {
  agentModel: string;
  availableModels: Model[];
  fallbackModel: Model | null;
  engine: CoworkAgentEngine;
};

type ResolveAgentModelSelectionResult = {
  selectedModel: Model | null;
  usesFallback: boolean;
};

export function resolveAgentModelSelection({
  agentModel,
  availableModels,
  fallbackModel,
  engine,
}: ResolveAgentModelSelectionInput): ResolveAgentModelSelectionResult {
  if (engine !== 'openclaw') {
    return { selectedModel: fallbackModel, usesFallback: false };
  }

  const normalizedAgentModel = agentModel.trim();
  if (normalizedAgentModel) {
    const explicitModel = availableModels.find((model) => model.id === normalizedAgentModel) ?? null;
    if (explicitModel) {
      return { selectedModel: explicitModel, usesFallback: false };
    }
  }

  return { selectedModel: fallbackModel, usesFallback: true };
}
