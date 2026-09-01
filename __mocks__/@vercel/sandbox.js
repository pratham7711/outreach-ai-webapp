/**
 * @vercel/sandbox is published as ESM only, and jest's transform does not reach
 * into node_modules, so merely importing a module that imports it fails the
 * whole suite at load time with "Unexpected token 'export'". That failure looks
 * like a broken test rather than a missing mock, and it cost a suite twice.
 *
 * This root-level manual mock is picked up automatically for the node module, so
 * a file can import lib/platforms/tiktokProfileSandbox without ceremony.
 *
 * `create` rejects rather than returning a stub: a test must never boot a real
 * sandbox — it costs money and takes seconds — and a test that reaches this
 * should mock the fetcher it actually uses, not silently get an empty sandbox
 * that answers every read with nothing.
 */
class Sandbox {
  static async create() {
    throw new Error(
      "@vercel/sandbox is mocked in tests. Mock @/lib/platforms/tiktokProfileSandbox instead."
    );
  }
}

module.exports = { Sandbox };
