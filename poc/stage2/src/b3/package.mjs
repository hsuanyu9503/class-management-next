/** Sealed evidence package (TRUSTED TOOLCHAIN, B3a). Plan v0.3 §3.4 / §7.4.
 *  - writePackage(): reproducible POSIX ustar — manifest.json first, then payload sorted by UTF-8 bytes;
 *    mtime 0, uid/gid 0, empty user/group names, mode 0644, no extended headers, uncompressed.
 *    manifest.json lists PAYLOAD only (never itself, the package, statement or signing records).
 *  - readPackageSafe(): parses untrusted bytes WITHOUT touching the filesystem; enforces path rules,
 *    entry types (regular files only), duplicates, case/NFC collisions, counts and sizes, and that the
 *    package holds exactly manifest.json + the payload it lists.
 *    The bytes must equal the canonical re-serialisation of the payload (B3A-N5: ARTIFACT_NONCANONICAL).
 *  - parseStrictJson(): rejects duplicate keys, the key "__proto__" (B3A-N2), depth > 64, non-finite numbers,
 *    unsafe integers; properties are defined as OWN data properties (never through the prototype setter). */
import { createHash } from 'node:crypto';

export const LIMITS = Object.freeze({ maxFiles: 2000, maxFileBytes: 16 * 1024 * 1024, maxPackageBytes: 256 * 1024 * 1024, maxJsonDepth: 64 });
export const PATH_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}(\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}){0,7}$/;
const sha = (b) => createHash('sha256').update(b).digest('hex');

export class PackageError extends Error { constructor(code, detail) { super(`${code}: ${detail}`); this.code = code; } }
const fail = (code, d) => { throw new PackageError(code, d); };

function header(name, size, typeflag = '0') {
  const h = Buffer.alloc(512, 0);
  if (Buffer.byteLength(name) > 100) fail('ARTIFACT_PATH_INVALID', `name too long for ustar: ${name}`);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136);
  h.write('        ', 148); h.write(typeflag, 156); h.write('ustar\0', 257); h.write('00', 263);
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

/** @param files {[relPath]: Buffer|string} payload only. @returns {packageBytes, manifestBytes, packageSha256, manifestSha256} */
export function writePackage(files) {
  const entries = Object.entries(files).map(([p, c]) => [p, Buffer.isBuffer(c) ? c : Buffer.from(c, 'utf8')]);
  for (const [p] of entries) if (!PATH_RE.test(p) || p === 'manifest.json') fail('ARTIFACT_PATH_INVALID', p);
  entries.sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const manifest = { manifestVersion: 's2-package-manifest-v1', files: entries.map(([p, b]) => ({ path: p, bytes: b.length, sha256: sha(b) })) };
  const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  const parts = [];
  for (const [p, b] of [['manifest.json', manifestBytes], ...entries]) { parts.push(header(p, b.length), b, Buffer.alloc((512 - (b.length % 512)) % 512, 0)); }
  parts.push(Buffer.alloc(1024, 0));
  const packageBytes = Buffer.concat(parts);
  return { packageBytes, manifestBytes, packageSha256: sha(packageBytes), manifestSha256: sha(manifestBytes) };
}

/** Low-level ustar walk with arbitrary entries (used by tests to build hostile packages). */
export function rawTar(entries) {
  const parts = [];
  for (const e of entries) { const b = Buffer.from(e.content ?? '', 'utf8'); parts.push(header(e.name, e.type === '0' || !e.type ? b.length : 0, e.type || '0')); if (!e.type || e.type === '0') parts.push(b, Buffer.alloc((512 - (b.length % 512)) % 512, 0)); }
  parts.push(Buffer.alloc(1024, 0));
  return Buffer.concat(parts);
}

export function readPackageSafe(bytes) {
  if (!Buffer.isBuffer(bytes)) fail('ARTIFACT_FORMAT', 'not bytes');
  if (bytes.length > LIMITS.maxPackageBytes) fail('ARTIFACT_LIMIT', 'package too large');
  const files = new Map(); const folded = new Set(); let off = 0; let count = 0;
  while (off + 512 <= bytes.length) {
    const h = bytes.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    let sum = 0; for (let i = 0; i < 512; i++) sum += (i >= 148 && i < 156) ? 32 : h[i];
    if (parseInt(h.subarray(148, 156).toString('ascii').replace(/[\0 ]/g, ''), 8) !== sum) fail('ARTIFACT_FORMAT', 'bad header checksum');
    const name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const prefix = h.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
    const type = String.fromCharCode(h[156] || 48);
    const size = parseInt(h.subarray(124, 136).toString('ascii').replace(/[\0 ]/g, '') || '0', 8);
    if (prefix) fail('ARTIFACT_PATH_INVALID', 'ustar prefix not allowed');
    if (type !== '0') fail('ARTIFACT_ENTRY_TYPE', `${name}: type ${type}`);
    if (!PATH_RE.test(name)) fail('ARTIFACT_PATH_INVALID', name);
    if (!Number.isSafeInteger(size) || size < 0 || size > LIMITS.maxFileBytes) fail('ARTIFACT_LIMIT', `${name}: size`);
    if (++count > LIMITS.maxFiles + 1) fail('ARTIFACT_LIMIT', 'too many files');
    if (files.has(name)) fail('ARTIFACT_DUPLICATE', name);
    const key = name.normalize('NFC').toLowerCase();
    if (folded.has(key)) fail('ARTIFACT_PATH_COLLISION', name);
    folded.add(key);
    const start = off + 512; const end = start + size;
    if (end > bytes.length) fail('ARTIFACT_FORMAT', 'truncated');
    files.set(name, bytes.subarray(start, end));
    off = start + Math.ceil(size / 512) * 512;
  }
  if (!files.has('manifest.json')) fail('ARTIFACT_MANIFEST', 'manifest.json missing');
  const manifestBytes = files.get('manifest.json');
  const manifest = parseStrictJson(manifestBytes.toString('utf8'));
  const listed = new Set();
  for (const f of manifest.files || []) {
    if (!PATH_RE.test(f.path) || f.path === 'manifest.json') fail('ARTIFACT_MANIFEST', `bad listed path ${f.path}`);
    const b = files.get(f.path);
    if (!b) fail('ARTIFACT_MANIFEST', `listed file missing ${f.path}`);
    if (b.length !== f.bytes || sha(b) !== f.sha256) fail('ARTIFACT_MANIFEST', `digest mismatch ${f.path}`);
    listed.add(f.path);
  }
  for (const n of files.keys()) if (n !== 'manifest.json' && !listed.has(n)) fail('ARTIFACT_MANIFEST', `unlisted file ${n}`);
  // B3A-N5: the package must be the ONE canonical serialisation of its payload — re-serialising with
  // writePackage() must give identical bytes (entry order, headers, padding, manifest text, end-of-archive
  // marker, and nothing after it). Anything else (trailing data, odd headers, re-ordered entries) is refused.
  const canon = writePackage(Object.fromEntries([...files].filter(([n]) => n !== 'manifest.json')));
  if (!canon.manifestBytes.equals(manifestBytes)) fail('ARTIFACT_NONCANONICAL', 'manifest is not the canonical serialisation');
  if (!canon.packageBytes.equals(bytes)) fail('ARTIFACT_NONCANONICAL', 'package bytes are not the canonical serialisation');
  return { files, manifest, manifestSha256: sha(manifestBytes), packageSha256: sha(bytes) };
}

/** Strict JSON: standard grammar, plus duplicate-key and depth rejection. */
export function parseStrictJson(text) {
  let i = 0;
  const err = (m) => fail('ARTIFACT_JSON_INVALID', `${m} at ${i}`);
  const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i++; };
  const str = () => {
    if (text[i] !== '"') err('expected string'); i++; let out = '';
    while (true) {
      if (i >= text.length) err('unterminated string');
      const c = text[i++];
      if (c === '"') return out;
      if (c === '\\') { const e = text[i++]; const map = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (e === 'u') { const h = text.slice(i, i + 4); if (!/^[0-9a-fA-F]{4}$/.test(h)) err('bad unicode escape'); out += String.fromCharCode(parseInt(h, 16)); i += 4; } else if (e in map) out += map[e]; else err('bad escape'); }
      else if (c < ' ') err('control char in string'); else out += c;
    }
  };
  const val = (depth) => {
    if (depth > LIMITS.maxJsonDepth) err('too deep');
    ws(); const c = text[i];
    if (c === '{') { i++; const o = {}; const seen = new Set(); ws(); if (text[i] === '}') { i++; return o; }
      while (true) { ws(); const k = str(); if (seen.has(k)) fail('ARTIFACT_JSON_INVALID', `duplicate key ${k}`); seen.add(k); ws(); if (text[i++] !== ':') err('expected :'); if (k === '__proto__') fail('ARTIFACT_JSON_INVALID', 'key __proto__ not allowed'); Object.defineProperty(o, k, { value: val(depth + 1), enumerable: true, writable: true, configurable: true }); ws(); const d = text[i++]; if (d === '}') return o; if (d !== ',') err('expected , or }'); } }
    if (c === '[') { i++; const a = []; ws(); if (text[i] === ']') { i++; return a; }
      while (true) { a.push(val(depth + 1)); ws(); const d = text[i++]; if (d === ']') return a; if (d !== ',') err('expected , or ]'); } }
    if (c === '"') return str();
    const m = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(text.slice(i));
    if (m) { i += m[0].length; const n = Number(m[0]); if (!Number.isFinite(n) || (!m[2] && !m[3] && !Number.isSafeInteger(n))) err('unsafe number'); return n; }
    for (const [lit, v] of [['true', true], ['false', false], ['null', null]]) if (text.startsWith(lit, i)) { i += lit.length; return v; }
    err('unexpected token');
  };
  const v = val(0); ws(); if (i !== text.length) err('trailing data');
  return v;
}
