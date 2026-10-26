/** The explicit async entrypoint also works in Electron utility processes, whose event loop stays alive. */
export function automationRunnerSource(file: string): string {
  return `const finish = (code) => {
    process.stdout.write('', () => process.stderr.write('', () => process.exit(code)));
  };
  Promise.resolve().then(async () => {
    const run = require(${JSON.stringify(file)});
    if (typeof run !== 'function') throw new Error('Script must export an async function: module.exports = async function () { ... }');
    await run();
    if (process.exitCode) throw new Error('Script set a failing exit code: ' + process.exitCode);
  }).then(() => finish(0), error => { console.error(error?.stack || String(error)); finish(1); });\n`
}
