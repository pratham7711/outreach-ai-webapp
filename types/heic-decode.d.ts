declare module "heic-decode" {
  interface DecodeResult {
    width: number;
    height: number;
    /** RGBA, 4 bytes per pixel. */
    data: Uint8Array;
  }
  function decode(options: { buffer: Buffer | Uint8Array }): Promise<DecodeResult>;
  export default decode;
}
