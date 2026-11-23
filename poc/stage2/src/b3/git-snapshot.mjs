/** Git commit snapshot without tar (TRUSTED TOOLCHAIN, C-2 Windows compatibility).
 *  The first CLI version extracted `git archive` output with the system `tar`. On Windows, bsdtar (tar.exe) could not
 *  extract the repository's UTF-8 file names (poc/stage1/docs/*.md: "Invalid empty pathname"), so every local
 *  verification stopped before `gh attestation verify` ran.
 *
 *  This module reads the commit straight from Git's object database and writes every file with the verifier's own code:
 *   - `git ls-tree -r -z --full-tree <commit>`: raw (NUL-terminated, unquoted) UTF-8 paths, modes and blob IDs;
 *   - `git cat-file --batch`: the raw blob bytes (no checkout, so no autocrlf / filters / attributes are applied);
 *   - every blob is re-hashed (sha1 over "blob <size>\0<bytes>", or sha256 for SHA-256 repositories) and must equal its
 *     Git object ID, so the bytes written are exactly the committed bytes on every platform.
 *  Nothing from the commit is executed.
 *
 *  Fail closed, with a SnapshotError that names the stage and the path. It is an environment / repository-shape
 *  problem, never a policy decision:
 *   - symbolic links, submodules and any other non-regular entry;
 *   - paths that are not valid UTF-8, are absolute, or contain empty, '.' or '..' segments, backslashes, control
 *     characters, Windows-reserved characters (<>:"|?*) or names (CON, NUL, COM1 …), or segments ending in '.' or ' ';
 *   - two paths that would collide on a case-insensitive or Unicode-normalising file system (Windows, macOS).
 *  The same rules apply on every platform, so a snapshot that works on Linux also works on Windows (and vice versa). */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const SNAPSHOT_VERSION = 's2-git-snapshot-v1';
export class SnapshotError extends Error {
  constructor(stage, detail) { super(`SNAPSHOT_FAILED[${stage}]: ${detail}`); this.name = 'SnapshotError'; this.stage = stage; this.detail = detail; }
}
const OID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
const BAD_CHARS = /[\u0000-\u001f\u007f<>:"|?*\\]/;
const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Same rules on every platform. @returns null when acceptable, otherwise the reason */
export function pathProblem(p) {
  if (typeof p !== 'string' || p.length === 0) return 'empty';
  if (p.startsWith('/')) return 'absolute';
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') return `segment "${seg}"`;
    if (BAD_CHARS.test(seg)) return 'reserved or control character';
    if (RESERVED.test(seg)) return `reserved name "${seg}"`;
    if (/[. ]$/.test(seg)) return 'segment ends in "." or " "';
  }
  return null;
}

/** @returns [{ mode, type, oid, path }] of the commit's whole tree (validated) */
export function listTree(repoDir, commit) {
  if (!/^[0-9a-f]{40}$/.test(String(commit))) throw new SnapshotError('commit', `not a full commit SHA: ${String(commit).slice(0, 80)}`);
  let raw;
  try { raw = execFileSync('git', ['-C', repoDir, 'ls-tree', '-r', '-z', '--full-tree', `${commit}^{commit}`], { maxBuffer: 256 << 20 }); }
  catch (e) { throw new SnapshotError('ls-tree', `git ls-tree failed for ${commit}: ${String(e.stderr || e.message).trim().slice(0, 300)}`); }
  const out = []; const seenFold = new Map();
  let i = 0;
  while (i < raw.length) {
    const end = raw.indexOf(0, i); if (end < 0) throw new SnapshotError('ls-tree', 'unterminated entry');
    const rec = raw.subarray(i, end); i = end + 1;
    const tab = rec.indexOf(9); if (tab < 0) throw new SnapshotError('ls-tree', 'malformed entry');
    const [mode, type, oid] = rec.subarray(0, tab).toString('latin1').split(' ');
    let p; try { p = utf8.decode(rec.subarray(tab + 1)); } catch { throw new SnapshotError('path', `not valid UTF-8: ${rec.subarray(tab + 1).toString('hex').slice(0, 120)}`); }
    if (type !== 'blob' || (mode !== '100644' && mode !== '100755')) throw new SnapshotError('entry', `${p}: mode ${mode} type ${type} (only regular files are supported; symbolic links and submodules fail closed)`);
    if (!OID.test(oid)) throw new SnapshotError('entry', `${p}: bad object id`);
    const why = pathProblem(p); if (why) throw new SnapshotError('path', `${p}: ${why}`);
    const fold = p.normalize('NFC').toLowerCase();
    if (seenFold.has(fold)) throw new SnapshotError('path', `${p} collides with ${seenFold.get(fold)} on a case-insensitive / normalising file system`);
    seenFold.set(fold, p);
    out.push({ mode, type, oid, path: p });
  }
  if (!out.length) throw new SnapshotError('ls-tree', `empty tree at ${commit}`);
  return out;
}

/** Reads all blobs with ONE `git cat-file --batch` and checks every object ID. @returns Map(oid → Buffer) */
export function readBlobs(repoDir, oids) {
  const uniq = [...new Set(oids)];
  let raw;
  try { raw = execFileSync('git', ['-C', repoDir, 'cat-file', '--batch'], { input: uniq.join('\n') + '\n', maxBuffer: 1 << 30 }); }
  catch (e) { throw new SnapshotError('cat-file', `git cat-file failed: ${String(e.stderr || e.message).trim().slice(0, 300)}`); }
  return parseBatch(raw, uniq);
}

/** Parses `git cat-file --batch` output for exactly these object IDs, re-hashing every blob. @returns Map(oid → Buffer) */
export function parseBatch(raw, uniq) {
  const out = new Map(); let i = 0;
  for (const want of uniq) {
    const nl = raw.indexOf(10, i); if (nl < 0) throw new SnapshotError('cat-file', `truncated output before ${want}`);
    const [oid, type, sizeS] = raw.subarray(i, nl).toString('latin1').split(' ');
    const size = Number(sizeS);
    if (oid !== want || type !== 'blob' || !Number.isSafeInteger(size)) throw new SnapshotError('cat-file', `unexpected header for ${want}: ${raw.subarray(i, nl).toString('latin1').slice(0, 120)}`);
    const body = raw.subarray(nl + 1, nl + 1 + size);
    if (body.length !== size || raw[nl + 1 + size] !== 10) throw new SnapshotError('cat-file', `truncated blob ${want}`);
    const algo = want.length === 64 ? 'sha256' : 'sha1';
    const got = createHash(algo).update(Buffer.concat([Buffer.from(`blob ${size}\0`, 'latin1'), body])).digest('hex');
    if (got !== want) throw new SnapshotError('integrity', `blob ${want} re-hashes to ${got}`);
    out.set(oid, Buffer.from(body)); i = nl + 1 + size + 1;
  }
  return out;
}

/** Writes the commit's tree into destDir (must not exist or be empty). @returns { commit, files, bytes } */
export function materializeCommit(repoDir, commit, destDir) {
  const entries = listTree(repoDir, commit);
  const blobs = readBlobs(repoDir, entries.map((e) => e.oid));
  if (existsSync(destDir) && readdirSync(destDir).length) throw new SnapshotError('write', `destination not empty: ${destDir}`);
  mkdirSync(destDir, { recursive: true });
  let bytes = 0;
  for (const e of entries) {
    const target = path.join(destDir, ...e.path.split('/'));
    try { mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, blobs.get(e.oid), { flag: 'wx' }); }
    catch (err) { throw new SnapshotError('write', `${e.path}: ${err.code || err.message}`); }
    bytes += blobs.get(e.oid).length;
  }
  return { version: SNAPSHOT_VERSION, commit, files: entries.length, bytes };
}
