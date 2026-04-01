/**
 * IM Gateway Module Index
 * Re-exports all IM gateway related modules
 */

export * from './types';
export { IMStore } from './imStore';
export { NimGateway } from './nimGateway';
export { YdFeishuGateway } from './ydFeishuGateway';
export { IMChatHandler } from './imChatHandler';
export { IMCoworkHandler, type IMCoworkHandlerOptions } from './imCoworkHandler';
export { IMGatewayManager, type IMGatewayManagerOptions } from './imGatewayManager';
export {
  IMGatewayProviderId,
  IMGatewayProviderSource,
  IMGatewayProviderEnvKey,
  resolveIMGatewayProvider,
} from './imGatewayProviderRouter';
export {
  createIMGatewayProvider,
  OpenClawManagedPlatform,
  type IManagedGatewayProvider,
  type IMGatewayProviderRuntimeDeps,
} from './imGatewayProviders';
export * from './imGatewayContracts';
export * from './gateway';
export { parseMediaMarkers, stripMediaMarkers } from './dingtalkMediaParser';
export { buildIMMediaInstruction } from './imMediaInstruction';
