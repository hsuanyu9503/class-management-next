#!/usr/bin/env node
/** Stage 0 環境自查：不讀取使用者資料、不連網、不安裝工具。 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const probes = [
  ['node', ['--version'], true],
  ['npm', ['--version'], true],
  ['git', ['--version'], true],
  ['java', ['-version'], false],
  ['firebase', ['--version'], false],
  ['supabase', ['--version'], false],
  ['docker', ['--version'], false],
  ['gh', ['--version'], false]
];
function probe([name, args, baselineRequired]) {
  try {
    // Windows npm is shipped as npm.cmd. Use cmd.exe only for this fixed internal probe.
    // All arguments below are trusted hardcoded tool-version flags, never user input.
    const isWindowsNpm = process.platform === 'win32' && name === 'npm';
    const command = isWindowsNpm ? (process.env.ComSpec || 'cmd.exe') : name;
    const commandArgs = isWindowsNpm ? ['/d', '/c', 'npm.cmd', ...args] : args;
    const res = spawnSync(command, commandArgs, { encoding: 'utf8', timeout: 6000, windowsHide: true, shell: false, env: process.env });
    if (res.error || res.status !== 0) return {tool:name, status:'NOT_AVAILABLE_OR_ERROR', baselineRequired, detail:res.error?.code ?? `exit_${res.status}`};
    return {tool:name, status:'AVAILABLE', baselineRequired, version:(res.stdout || res.stderr || '').split(/\r?\n/)[0].slice(0,120)};
  } catch (error) { return {tool:name, status:'NOT_AVAILABLE_OR_ERROR', baselineRequired, detail:error?.code ?? 'execution_failed'}; }
}
const results=probes.map(probe);
const nodeMajor=Number.parseInt(process.version.slice(1).split('.')[0],10);
const baseline=results.filter(x=>x.baselineRequired).every(x=>x.status==='AVAILABLE') && nodeMajor>=22;
const optional=results.filter(x=>!x.baselineRequired && x.tool!=='java');
const report={schemaVersion:'1.0', inspectionScope:'ONLY_THIS_PROCESS_ENVIRONMENT_NOT_USER_DEVICE', timeUtc:new Date().toISOString(), platform:os.platform(), arch:os.arch(), baselineReady:baseline, adapterCliReadiness:optional.every(x=>x.status==='AVAILABLE'), tools:results, safety:{cloudProjectsCreated:false,secretsRead:false,studentDataRead:false,externalInstallAttempted:false,emulatorsStarted:false}, next:'確認 Windows 本機 CLI 與 Docker；Stage 1 之前不執行任何後端測試'};
if (process.argv.includes('--write')) {
  mkdirSync(path.join(root,'reports'),{recursive:true});
  const target=path.join(root,'reports','stage0-environment-local.json');
  writeFileSync(target,JSON.stringify(report,null,2)+'\n');
  console.log('報告已建立：reports/stage0-environment-local.json');
}
console.log(JSON.stringify(report,null,2));
// 缺少選用 CLI 不讓 stage0 腳本失敗；由驗收報告區分基準與後端就緒度。
if(!baseline) process.exitCode=2;
