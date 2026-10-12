/** One-native project identities. Each schema starts at version 1 of the latest business model. */
export const IMAGE_PROJECT_FORMAT = {
  id: 'one-image',
  extension: '.oneimage',
  magic: 'ONEIMAGE',
  version: 1,
} as const;

export const RECORDING_PROJECT_FORMAT = {
  id: 'one-recording',
  extension: '.onerec',
  magic: 'ONERECRD',
  version: 1,
} as const;
