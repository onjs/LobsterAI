import path from 'path';
import type { CoworkConfig } from '../coworkStore';

const trimWorkingDirectory = (workingDirectory?: string): string => {
  return (workingDirectory || '').trim();
};

/**
 * Resolve the shared OpenClaw workspace path used for AGENTS.md and MEMORY.md sync.
 *
 * When OpenClaw is not the active cowork engine, keep OpenClaw artifacts under
 * ~/.openclaw/workspace so yd_cowork workspace files stay untouched.
 */
export const resolveOpenClawWorkspaceDir = (
  coworkConfig: Pick<CoworkConfig, 'agentEngine' | 'workingDirectory'>,
  homeDir: string,
): string => {
  const workspaceDir = trimWorkingDirectory(coworkConfig.workingDirectory);
  if (coworkConfig.agentEngine === 'openclaw' && workspaceDir) {
    return path.resolve(workspaceDir);
  }
  return path.join(homeDir, '.openclaw', 'workspace');
};

/**
 * Resolve the OpenClaw main-agent workspace override for openclaw.json.
 *
 * Only set `agents.defaults.workspace` when OpenClaw is the active engine.
 * Otherwise OpenClaw should use its own default workspace under ~/.openclaw.
 */
export const resolveOpenClawMainAgentWorkspace = (
  coworkConfig: Pick<CoworkConfig, 'agentEngine' | 'workingDirectory'>,
): string | undefined => {
  const workspaceDir = trimWorkingDirectory(coworkConfig.workingDirectory);
  if (coworkConfig.agentEngine === 'openclaw' && workspaceDir) {
    return path.resolve(workspaceDir);
  }
  return undefined;
};
