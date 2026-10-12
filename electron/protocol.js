'use strict';

// app://local/            -> renderer bundle (dist/)
// app://local/__content/  -> cached/uploaded media in the data dir (with HTTP range support for video seeking)
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { protocol } = require('electron');

const SCHEME = 'app';
const HOST = 'local';
const ORIGIN = `${SCHEME}://${HOST}`;
const CONTENT_PREFIX = '/__content/';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.pdf': 'application/pdf',
  '.bcmap': 'application/octet-stream',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
    },
  ]);
}

const contentUrl = (name) => `${ORIGIN}${CONTENT_PREFIX}${encodeURIComponent(name)}`;
const isAppUrl = (url) => typeof url === 'string' && url.startsWith(`${ORIGIN}/`);

function resolveInside(base, rel) {
  const root = path.resolve(base);
  const full = path.resolve(root, String(rel).replace(/^[/\\]+/, ''));
  return full.startsWith(root + path.sep) ? full : null;
}

function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start;
  let end;
  if (m[1] === '') {
    const suffix = parseInt(m[2], 10);
    if (!suffix) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

async function serveFile(file, request, isUi) {
  if (!file) return new Response('Forbidden', { status: 403 });
  let stat;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  if (!stat.isFile()) return new Response('Not found', { status: 404 });

  const headers = {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };
  if (isUi) headers['Content-Security-Policy'] = CSP;

  const range = parseRange(request.headers.get('range'), stat.size);
  if (range === 'invalid') {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
  }
  if (range) {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
    headers['Content-Length'] = String(range.end - range.start + 1);
    return new Response(Readable.toWeb(fs.createReadStream(file, range)), { status: 206, headers });
  }
  headers['Content-Length'] = String(stat.size);
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers });
}

function registerAppProtocol({ distDir, contentDir }) {
  protocol.handle(SCHEME, (request) => {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    if (url.host !== HOST) return new Response('Not found', { status: 404 });
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith(CONTENT_PREFIX)) {
      return serveFile(resolveInside(contentDir, pathname.slice(CONTENT_PREFIX.length)), request, false);
    }
    const rel = pathname === '/' ? 'index.html' : pathname;
    return serveFile(resolveInside(distDir, rel), request, true);
  });
}

module.exports = { registerSchemes, registerAppProtocol, contentUrl, isAppUrl, resolveInside, ORIGIN };
