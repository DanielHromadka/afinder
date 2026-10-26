import type { AutomationDraft } from './automation'

/** An audited starting point: content sync, no deletions, independently verified. */
export function syncAutomation(source: string, destination: string, minutes: number): AutomationDraft {
  const common = `const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const source = ${JSON.stringify(source)};
const destination = ${JSON.stringify(destination)};
async function hash(file) {
  const sum = createHash('sha256');
  for await (const chunk of createReadStream(file)) sum.update(chunk);
  return sum.digest('hex');
}
async function directory(p) {
  const st = await fs.lstat(p);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Not a real directory: ' + p);
}
async function roots() {
  if (!path.isAbsolute(source) || !path.isAbsolute(destination)) throw new Error('Use absolute folder paths');
  // Both roots must already exist. Never recreate a missing disk mount.
  await directory(source); await directory(destination);
  const src = await fs.realpath(source), dst = await fs.realpath(destination);
  const inside = (a,b) => { const r = path.relative(a,b); return !r || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r)); };
  if (inside(src,dst) || inside(dst,src)) throw new Error('Source and destination must not overlap');
}
async function* walk(dir, relative = '') {
  for (const entry of (await fs.readdir(dir, {withFileTypes:true})).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const file = path.join(dir, entry.name), rel = path.join(relative, entry.name);
    const st = await fs.lstat(file);
    if (st.isSymbolicLink()) throw new Error('Symlinks are not supported: ' + file);
    if (st.isDirectory()) { yield {rel, dir:true}; yield* walk(file, rel); }
    else if (st.isFile()) yield {rel, dir:false};
    else throw new Error('Unsupported file: ' + file);
  }
}
async function existing(file) {
  try { return await fs.lstat(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function same(file, expected) {
  const st = await existing(file);
  if (st && (st.isSymbolicLink() || !st.isFile())) throw new Error('Destination is not a regular file: ' + file);
  return !!st && await hash(file) === expected;
}
`;
  return {
    name: 'Folder sync · SHA-256', description: `Sync ${source} → ${destination}. Preserve extra destination files; verify every source file.`,
    trigger: { kind: 'interval', minutes }, workflow: ['Check that both folders exist and do not overlap.', 'Copy new and changed files through temporary files; preserve extra destination files.', 'Verify every source file with SHA-256.'],
    outcome: 'Every source file and directory exists at the destination; file contents match SHA-256. Extra destination files are preserved.', timeoutSeconds: 3600,
    script: common + `module.exports = async function main() {
  await roots();
  let copied = 0;
  for await (const item of walk(source)) {
    const from = path.join(source,item.rel), to = path.join(destination,item.rel);
    if (item.dir) {
      const st = await existing(to);
      if (!st) await fs.mkdir(to);
      await directory(to);
      continue;
    }
    const before = await fs.stat(from);
    const expected = await hash(from);
    if (!(await same(to,expected))) {
      const temporary = to + '.afinder-' + require('node:crypto').randomUUID() + '.tmp';
      try {
        await fs.copyFile(from,temporary,require('node:fs').constants.COPYFILE_EXCL);
        if (await hash(temporary) !== expected) throw new Error('Source changed while copying: ' + from);
        await fs.rename(temporary,to);
      } finally { await fs.rm(temporary,{force:true}); }
      copied++; console.log('Copied: ' + item.rel);
    }
    const after = await fs.stat(from);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Source changed during sync: ' + from);
  }
  console.log('Copied files: ' + copied);
};`,
    verificationScript: common + `module.exports = async function main() {
  await roots();
  let verified = 0;
  for await (const item of walk(source)) {
    const from = path.join(source,item.rel), to = path.join(destination,item.rel);
    if (item.dir) { await directory(to); continue; }
    const before = await fs.stat(from);
    if (!(await same(to,await hash(from)))) throw new Error('Verification failed: ' + item.rel);
    const after = await fs.stat(from);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Source changed during verification: ' + from);
    verified++;
  }
  console.log('SHA-256 verified files: ' + verified);
};`
  }
}
