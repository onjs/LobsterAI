export const CoworkIpcChannel = {
  ConfigGet: 'cowork:config:get',
  ConfigSet: 'cowork:config:set',
  CapabilitiesGet: 'cowork:capabilities:get',
} as const;

export type CoworkIpcChannel = typeof CoworkIpcChannel[keyof typeof CoworkIpcChannel];
