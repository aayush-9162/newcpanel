#!/usr/bin/env node
// Usage: node crawl.js [startUrl] [outDir]
// Defaults: startUrl=http://192.168.68.8:3000/auth/cpanel, outDir=dump

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const START = process.argv[2] || 'http://192.168.68.8:3000/auth/cpanel';
const OUT = process.argv[3] || 'dump';
const MAX_PAGES = parseInt(process.env.MAX_PAGES || '1000', 10);
const DELAY_MS = parseInt(process.env.DELAY_MS || '50', 10);

const startUrl = new URL(START);
const ORIGIN = startUrl.origin;

const visited = new Map();
const queue = [START];
const inQueue = new Set([START]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function safeFilename(u, contentType) {
  const url = new URL(u);
  let p = url.pathname;
  if (p === '' || p === '/') p = '/index';
  if (p.endsWith('/')) p += 'index';
  if (url.search) {
    const hash = crypto.createHash('md5').update(url.search).digest('hex').slice(0, 8);
    p += `__q_${hash}`;
  }
  p = p.replace(/[^a-zA-Z0-9._/\-]/g, '_');
  p = p.replace(/^\//, '');
  if (!/\.[a-z0-9]{1,6}$/i.test(p)) {
    const ct = (contentType || '').toLowerCase();
    if (ct.includes('html')) p += '.html';
    else if (ct.includes('javascript')) p += '.js';
    else if (ct.includes('css')) p += '.css';
    else if (ct.includes('json')) p += '.json';
    else if (ct.includes('svg')) p += '.svg';
    else if (ct.includes('png')) p += '.png';
    else if (ct.includes('jpeg')) p += '.jpg';
    else if (ct.includes('gif')) p += '.gif';
    else if (ct.includes('webp')) p += '.webp';
    else if (ct.includes('woff2')) p += '.woff2';
    else if (ct.includes('woff')) p += '.woff';
    else if (ct.includes('xml')) p += '.xml';
    else if (ct.includes('plain')) p += '.txt';
    else p += '.bin';
  }
  return p;
}

function extractLinks(html, baseUrl) {
  const links = new Set();
  const re = /(?:href|src|action|data-href|data-src)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const raw = m[1].trim();
    if (!raw) continue;
    if (/^(#|mailto:|tel:|javascript:|data:)/i.test(raw)) continue;
    try {
      const abs = new URL(raw, baseUrl).toString();
      links.add(abs.split('#')[0]);
    } catch {}
  }
  const cssUrlRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  while ((m = cssUrlRe.exec(html))) {
    const raw = m[1].trim();
    if (!raw || /^(data:)/i.test(raw)) continue;
    try {
      const abs = new URL(raw, baseUrl).toString();
      links.add(abs.split('#')[0]);
    } catch {}
  }
  return [...links];
}

async function fetchOne(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'local-crawler/1.0' },
    });
    const ct = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, contentType: ct, body: buf, finalUrl: res.url };
  } catch (e) {
    return { status: 0, error: e.message };
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`Crawling from ${START}`);
  console.log(`Origin: ${ORIGIN}  Out: ${OUT}  Max: ${MAX_PAGES}`);
  let count = 0;

  while (queue.length && count < MAX_PAGES) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    count++;
    const tag = `[${count}/${queue.length + count}]`;
    process.stdout.write(`${tag} ${url} ... `);
    const r = await fetchOne(url);
    if (r.error) {
      console.log(`ERR ${r.error}`);
      visited.set(url, { status: 0, error: r.error });
      continue;
    }
    const rel = safeFilename(url, r.contentType);
    const filePath = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, r.body);
    console.log(`${r.status} ${(r.contentType.split(';')[0] || '').padEnd(24)} -> ${rel}`);
    visited.set(url, {
      status: r.status,
      contentType: r.contentType,
      file: rel,
      bytes: r.body.length,
    });

    const ct = r.contentType.toLowerCase();
    const isText = ct.includes('html') || ct.includes('css') || ct.includes('javascript');
    if (isText) {
      const text = r.body.toString('utf8');
      const links = extractLinks(text, r.finalUrl || url);
      for (const l of links) {
        try {
          const u = new URL(l);
          if (u.origin !== ORIGIN) continue;
          const clean = u.toString().split('#')[0];
          if (!visited.has(clean) && !inQueue.has(clean)) {
            queue.push(clean);
            inQueue.add(clean);
          }
        } catch {}
      }
    }
    if (DELAY_MS) await sleep(DELAY_MS);
  }

  const pagesObj = {};
  for (const [k, v] of visited) pagesObj[k] = v;
  const manifest = {
    start: START,
    origin: ORIGIN,
    crawledAt: new Date().toISOString(),
    urlCount: visited.size,
    pages: pagesObj,
  };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const byType = {};
  for (const v of visited.values()) {
    const t = (v.contentType || 'error').split(';')[0].trim() || 'error';
    byType[t] = (byType[t] || 0) + 1;
  }
  console.log(`\nDone. ${visited.size} URLs saved to ${OUT}/`);
  console.log('By content-type:');
  for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(4)}  ${t}`);
  }
})();
