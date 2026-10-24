import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
const here = dirname(fileURLToPath(import.meta.url));
const browser = process.argv[2] || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const name = browser.toLowerCase().includes('msedge') ? 'edge' : 'chrome';
const profile = resolve(here, '.profiles', name);
await mkdir(profile, { recursive: true });
// Serve tests and built files unchanged, without development-time transforms.
const root = resolve(here, '..');
const fixtures = await mkdtemp(resolve(tmpdir(), 'croq-mirror-browser-'));
await mkdir(resolve(fixtures, 'test'));
await Promise.all([
	cp(resolve(root, 'dist'), resolve(fixtures, 'dist'), { recursive: true }),
	cp(resolve(root, 'docs'), resolve(fixtures, 'docs'), { recursive: true }),
	...['browser.html', 'browser.js'].map(file => cp(resolve(here, file), resolve(fixtures, 'test', file))),
]);
const server = await preview({
	configFile: false,
	root,
	publicDir: false,
	appType: 'mpa',
	build: { outDir: fixtures },
	preview: { host: '127.0.0.1', port: 0, open: false },
});
const port = server.httpServer.address().port;
const child = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let socket;
try {
	const endpoint = await new Promise((resolve, reject) => {
		let log = '';
		const timeout = setTimeout(() => reject(new Error('Browser startup timed out: ' + log)), 15000);
		child.on('error', reject);
		child.stderr.on('data', chunk => {
			log += chunk;
			const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
			if (match) {
				clearTimeout(timeout);
				resolve(match[1]);
			}
		});
	});
	socket = new WebSocket(endpoint);
	await new Promise((resolve, reject) => {
		socket.onopen = resolve;
		socket.onerror = reject;
	});
	let id = 0;
	const pending = new Map();
	socket.onmessage = ({ data }) => {
		const result = JSON.parse(data);
		const p = pending.get(result.id);
		if (p) {
			pending.delete(result.id);
			result.error ? p.reject(result.error) : p.resolve(result.result);
		}
	};
	const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
		const n = ++id;
		pending.set(n, { resolve, reject });
		socket.send(JSON.stringify({ id: n, method, params, sessionId }));
	});
	const { targetId } = await send('Target.createTarget', { url: `http://127.0.0.1:${port}/test/browser.html` });
	const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
	let result;
	for (let i = 0; i < 100; i++) {
		const value = await send('Runtime.evaluate', { expression: 'window.testResult', returnByValue: true }, sessionId);
		result = value.result?.value;
		if (result) break;
		await new Promise(resolve => setTimeout(resolve, 200));
	}
	if (!result) {
		const debug = await send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true }, sessionId);
		throw new Error('Browser tests timed out: ' + JSON.stringify(debug));
	}
	result.browser = await send('Browser.getVersion');
	await writeFile(resolve(here, `${name}-result.json`), JSON.stringify(result, null, 2) + '\n');
	console.log(JSON.stringify(result, null, 2));
	if (!result.passed) process.exitCode = 1;
	if (result.passed) {
		await send('Page.enable', {}, sessionId);
		await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
		await send('Page.navigate', { url: `http://127.0.0.1:${port}/docs/` }, sessionId);
		let ready = false;
		for (let i = 0; i < 50; i++) {
			const status = await send('Runtime.evaluate', { expression: 'document.querySelector("#status")?.textContent', returnByValue: true }, sessionId);
			if (status.result?.value?.startsWith('Ready.')) {
				ready = true;
				break;
			}
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		if (!ready) throw new Error('Built docs failed to initialize editors');
		const docs = await send('Runtime.evaluate', {
			expression: `(async () => {
				const assert = (condition, message) => { if (!condition) throw new Error(message); };
				assert(document.querySelectorAll('.CodeMirror').length === 1, 'One editor must mount');
				await document.querySelector('#analysis').onclick();
				const analysis = JSON.parse(document.querySelector('#status').textContent);
				assert(analysis.success && analysis.fnNames.includes('greet'), 'Worker must analyze sample');
				document.querySelector('#readonly').click();
				assert(JSON.parse(document.querySelector('#status').textContent).readOnly, 'Read-only control must work');
				await document.querySelector('#recreate').onclick();
				assert(document.querySelectorAll('.CodeMirror').length === 1, 'Editor must recreate');
				assert(getComputedStyle(document.querySelector('.CodeMirror')).fontFamily === 'monospace', 'Default editor font must be monospace');
				return true;
			})()`,
			awaitPromise: true,
			returnByValue: true,
		}, sessionId);
		if (docs.exceptionDetails || docs.result?.value !== true) throw new Error('Built docs check failed: ' + JSON.stringify(docs));
		console.log('Built docs passed: one editor, worker, read-only, recreate, default font, subdirectory URLs.');
		if (process.argv.includes('--screenshot')) {
			const capture = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
			await writeFile(resolve(here, `${name}-example.png`), Buffer.from(capture.data, 'base64'));
		}
	}
	await send('Browser.close');
} finally {
	socket?.close();
	child.kill();
	await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
	await rm(fixtures, { recursive: true, force: true });
}
