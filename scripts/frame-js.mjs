// Evaluate JavaScript in the frame's WebView over the Chrome DevTools Protocol (debug builds).
//   node scripts/frame-js.mjs "document.title"
//   node scripts/frame-js.mjs --body "const x = 1; return x + 1;"
//   node scripts/frame-js.mjs --file some-snippet.js      (file is a function body: use return)
// Expressions and bodies may use await. Needs adb (ADB env var or the default platform-tools path).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const adb = process.env.ADB || join(homedir(), 'Downloads', 'platform-tools-latest-windows', 'platform-tools', 'adb.exe');
const serial = process.env.OPENFRAME_SERIAL || ''; // empty: the one device adb sees
const PORT = 9223;

const args = process.argv.slice(2);
const isBody = args[0] === '--file' || args[0] === '--body';
const source = args[0] === '--file' ? readFileSync(args[1], 'utf8') : (isBody ? args.slice(1) : args).join(' ');
const expression = isBody ? source : `return (${source});`;
if (!source) {
  console.error('usage: node scripts/frame-js.mjs "<expression>" | --file <file.js>');
  process.exit(2);
}

const run = (...a) => execFileSync(adb, [...(serial ? ['-s', serial] : []), ...a], { encoding: 'utf8' }).trim();
const pid = run('shell', 'pidof', 'app.openframe');
if (!pid) throw new Error('app.openframe is not running');
run('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('http://127.0.0.1:8080'));
if (!page) throw new Error(`no OpenFrame page among ${targets.map((t) => t.url).join(', ')}`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const result = await new Promise((resolve) => {
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id === 1) resolve(msg);
  };
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression: `(async () => { ${expression}
})()`, awaitPromise: true, returnByValue: true },
  }));
});
ws.close();

if (result.error || result.result.exceptionDetails) {
  console.error(JSON.stringify(result.error || result.result.exceptionDetails, null, 2));
  process.exit(1);
}
const value = result.result.result.value;
console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
