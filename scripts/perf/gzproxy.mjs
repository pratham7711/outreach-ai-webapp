/**
 * A compressing reverse proxy in front of `next start`.
 *
 *   node scripts/perf/gzproxy.mjs <listen-port> <target-port>
 *
 * `next start` serves bodies uncompressed; Vercel's edge serves them brotli.
 * Benchmarked straight against `next start` under a 10 Mbps profile, the JS
 * transfer alone put LCP 300-600ms behind what production would show, so the
 * bench goes through this instead. Brotli quality 4 is roughly what an edge
 * applies on the fly.
 */
import http from "node:http";
import zlib from "node:zlib";

const [, , listen, target] = process.argv;
if (!listen || !target) {
  console.error("usage: node scripts/perf/gzproxy.mjs <listen-port> <target-port>");
  process.exit(2);
}

http
  .createServer((req, res) => {
    const accepts = String(req.headers["accept-encoding"] || "");
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: target,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `localhost:${listen}`, "accept-encoding": "identity" },
      },
      (u) => {
        const type = String(u.headers["content-type"] || "");
        const headers = { ...u.headers };
        const compressible =
          /json|javascript|text\/|css|svg|x-component/.test(type) && !u.headers["content-encoding"] && u.statusCode !== 304;
        if (compressible && /\bbr\b/.test(accepts)) {
          delete headers["content-length"];
          headers["content-encoding"] = "br";
          headers["vary"] = "Accept-Encoding";
          res.writeHead(u.statusCode, headers);
          u.pipe(
            zlib.createBrotliCompress({
              params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
              flush: zlib.constants.BROTLI_OPERATION_FLUSH,
            }),
          ).pipe(res);
        } else if (compressible && /gzip/.test(accepts)) {
          delete headers["content-length"];
          headers["content-encoding"] = "gzip";
          res.writeHead(u.statusCode, headers);
          u.pipe(zlib.createGzip({ flush: zlib.constants.Z_SYNC_FLUSH })).pipe(res);
        } else {
          res.writeHead(u.statusCode, headers);
          u.pipe(res);
        }
      },
    );
    upstream.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  })
  .listen(Number(listen));
