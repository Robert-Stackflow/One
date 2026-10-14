/** One-native project identities. Readers retain explicitly supported earlier versions. */
export const IMAGE_PROJECT_FORMAT = {
  id: 'one-image',
  extension: '.oneimage',
  magic: 'ONEIMAGE',
  version: 2,
} as const;

export const RECORDING_PROJECT_FORMAT = {
  id: 'one-recording',
  extension: '.onerec',
  magic: 'ONERECRD',
  version: 1,
} as const;
