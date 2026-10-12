declare module 'gifenc' {
  export function quantize(rgba: Uint8Array, colors: number): number[][];
  export function applyPalette(rgba: Uint8Array, palette: number[][]): Uint8Array;
  export function GIFEncoder(options?: { auto?: boolean }): {
    writeHeader(): void;
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options: {
        first?: boolean;
        palette: number[][];
        delay: number;
        repeat: number;
        colorDepth?: number;
      },
    ): void;
    finish(): void;
    bytesView(): Uint8Array;
  };
}
