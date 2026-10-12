/** Native source tracks share the screen's pause-free 48 kHz stereo sample clock. */
export function validateAudioSource(header: Buffer, bytes: number, samples: number) {
  if (
    header.length < 44 ||
    !Number.isSafeInteger(samples) ||
    samples < 1 ||
    samples > 48000 * 3601 ||
    bytes !== 44 + samples * 4 ||
    header.toString('ascii', 0, 4) !== 'RIFF' ||
    header.readUInt32LE(4) !== bytes - 8 ||
    header.toString('ascii', 8, 16) !== 'WAVEfmt ' ||
    header.readUInt32LE(16) !== 16 ||
    header.readUInt16LE(20) !== 1 ||
    header.readUInt16LE(22) !== 2 ||
    header.readUInt32LE(24) !== 48000 ||
    header.readUInt32LE(28) !== 192000 ||
    header.readUInt16LE(32) !== 4 ||
    header.readUInt16LE(34) !== 16 ||
    header.toString('ascii', 36, 40) !== 'data' ||
    header.readUInt32LE(40) !== bytes - 44
  )
    throw Error('独立声源格式或时长无效');
}
