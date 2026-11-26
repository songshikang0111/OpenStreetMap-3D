// `city tiles serve`: loopback-only static server with range requests, gzip and CORS, for local preview only.
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createGzip } from 'node:zlib';

const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.c3t': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

export interface TileServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

export async function serveTiles(dir: string, { port = 4181, host = '127.0.0.1' } = {}): Promise<TileServer> {
  if (!['127.0.0.1', '::1', 'localhost'].includes(host))
    throw Object.assign(new Error('city tiles serve only binds to a loopback address.'), {
      code: 'SERVE_LOOPBACK_ONLY',
    });
  const root = await realpath(dir);
  const server: Server = createServer(async (req, res) => {
    try {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
      if (req.method === 'OPTIONS') return void res.writeHead(204).end();
      if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405).end();
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname);
      const file = await realpath(path.resolve(root, '.' + pathname)).catch(() => null);
      if (!file) return void res.writeHead(404).end();
      if (!file.startsWith(root + path.sep) && file !== root) return void res.writeHead(403).end();
      if (file.split(path.sep).includes('.build')) return void res.writeHead(404).end();
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) return void res.writeHead(404).end();
      res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-cache');
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
      if (req.headers.range && (!range || (!range[1] && !range[2]))) {
        return void res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end();
      }
      if (range) {
        const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
        if (start > end || start >= info.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end();
          return;
        }
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${info.size}`,
          'Content-Length': end - start + 1,
        });
        if (req.method === 'HEAD') return void res.end();
        await pipeline(createReadStream(file, { start, end }), res);
        return;
      }
      res.setHeader('Vary', 'Accept-Encoding');
      if (path.extname(file) !== '.archive' && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
        res.writeHead(200, { 'Content-Encoding': 'gzip' });
        if (req.method === 'HEAD') return void res.end();
        await pipeline(createReadStream(file), createGzip({ level: 6 }), res);
        return;
      }
      res.writeHead(200, { 'Content-Length': info.size });
      if (req.method === 'HEAD') return void res.end();
      await pipeline(createReadStream(file), res);
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const address = server.address();
  const actual = typeof address === 'object' && address ? address.port : port;
  return {
    url: `http://${host.includes(':') ? `[${host}]` : host}:${actual}`,
    port: actual,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
