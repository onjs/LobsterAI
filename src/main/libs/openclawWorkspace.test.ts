import { describe, expect, test } from 'vitest';
import { resolveOpenClawMainAgentWorkspace, resolveOpenClawWorkspaceDir } from './openclawWorkspace';

describe('resolveOpenClawWorkspaceDir', () => {
  test('uses configured workspace when openclaw is active engine', () => {
    const workspace = resolveOpenClawWorkspaceDir(
      { agentEngine: 'openclaw', workingDirectory: '/tmp/project-a' },
      '/home/tester',
    );
    expect(workspace).toBe('/tmp/project-a');
  });

  test('falls back to ~/.openclaw/workspace when yd_cowork is active', () => {
    const workspace = resolveOpenClawWorkspaceDir(
      { agentEngine: 'yd_cowork', workingDirectory: '/tmp/project-b' },
      '/home/tester',
    );
    expect(workspace).toBe('/home/tester/.openclaw/workspace');
  });

  test('falls back to ~/.openclaw/workspace when workingDirectory is empty', () => {
    const workspace = resolveOpenClawWorkspaceDir(
      { agentEngine: 'openclaw', workingDirectory: '   ' },
      '/home/tester',
    );
    expect(workspace).toBe('/home/tester/.openclaw/workspace');
  });
});

describe('resolveOpenClawMainAgentWorkspace', () => {
  test('returns workspace override only when openclaw is active engine', () => {
    expect(
      resolveOpenClawMainAgentWorkspace({ agentEngine: 'openclaw', workingDirectory: '/tmp/project-c' }),
    ).toBe('/tmp/project-c');
  });

  test('returns undefined for yd_cowork engine', () => {
    expect(
      resolveOpenClawMainAgentWorkspace({ agentEngine: 'yd_cowork', workingDirectory: '/tmp/project-d' }),
    ).toBeUndefined();
  });
});
