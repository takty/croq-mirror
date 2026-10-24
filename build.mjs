import { readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { build as bundle, transform } from 'esbuild';
import { copyDirectory, copyFileIfChanged, resolvePackageDir, writeFileIfChanged } from './tasks.mjs';

const root      = dirname(fileURLToPath(import.meta.url));
const out       = join(root, 'dist');
const stageRoot = join(root, '.build');
const stage     = join(stageRoot, 'lib');

async function read(name, path) {
	return readFile(join(resolvePackageDir(name), path), 'utf8');
}

async function buildLibraries() {
	// Wrap the upstream browser builds in lexical scopes; no globals are installed on window.
	const wrap = (code, result = '') => `(function(module,exports,define,globalThis,require){\n${code}\n${result}\n}).call(scope,undefined,undefined,undefined,scope,undefined);\n`;
	let parser = 'const scope = {};\n';
	parser += wrap(await read('acorn', 'dist/acorn.js'));
	parser += 'const acorn = scope.acorn;\n';
	parser += wrap(await read('acorn-loose', 'dist/acorn-loose.js'));
	parser += wrap(await read('acorn-walk', 'dist/walk.js'));
	await writeFileIfChanged(join(stage, 'parser.js'), parser + `
export { acorn };
`);
	let vendor = `import { acorn } from './parser.js';
const scope = { tern: {} };
const tern = scope.tern;
`;
	vendor += wrap(await read('codemirror', 'lib/codemirror.js'));
	vendor += 'const CodeMirror = scope.CodeMirror;\n';
	const ADDONS = [
		'mode/javascript/javascript',
		'addon/comment/comment',
		'addon/display/rulers',
		'addon/dialog/dialog',
		'addon/edit/matchbrackets',
		'addon/edit/closebrackets',
		'addon/hint/show-hint',
		'addon/lint/lint',
		'addon/scroll/annotatescrollbar',
		'addon/search/searchcursor',
		'addon/search/search',
		'addon/search/match-highlighter',
		'addon/selection/active-line',
		'addon/selection/mark-selection',
	];
	for (const path of ADDONS) {
		let code = await read('codemirror', path + '.js');
		if (path === 'addon/lint/lint') code = code.replace('document.body.appendChild', 'cm.getWrapperElement().closest(\'.croq-mirror\').appendChild');
		vendor += wrap(code);
	}
	for (const file of ['signal', 'tern', 'def', 'comment', 'infer', 'condense']) vendor += wrap(await read('tern', `lib/${file}.js`));
	let ternAddon = await read('codemirror', 'addon/tern/tern.js');
	ternAddon = ternAddon.replace('function makeTooltip(x, y, content, cm, className) {', 'function makeTooltip(x, y, content, cm, className) {\n x -= window.pageXOffset; y -= window.pageYOffset;');
	ternAddon = ternAddon.replace('var pos = cm.cursorCoords();', 'var pos = cm.cursorCoords(null, "window");');
	ternAddon = ternAddon.replace('document.querySelector(".CodeMirror-hints")', 'container.querySelector(".CodeMirror-hints")');
	vendor += wrap(ternAddon);
	for (const [name, symbol] of [
		['jshint', 'lintEn'],
		['jshint-ja-edu', 'lintJa'],
	]) {
		vendor += `const ${symbol} = (function(exports){\n${await read(name, 'dist/jshint.js')}\nreturn exports.JSHINT;\n})({});\n`;
	}
	vendor += `const beautify = (function(exports){\n${await read('js-beautify', 'js/lib/beautify.js')}\nreturn exports.js_beautify;\n})({});\n`;
	const defs = await Promise.all(['ecmascript', 'browser'].map(n => read('tern', `defs/${n}.json`).then(JSON.parse)));
	vendor += `const defaultDefinitions = ${JSON.stringify(defs)};\nexport { CodeMirror, lintEn, lintJa, beautify, defaultDefinitions };\n`;
	await writeFileIfChanged(join(stage, 'vendor.js'), vendor);
}

async function buildJavaScript() {
	await copyDirectory(join(root, 'src/lib'), stage);
	await copyFileIfChanged(join(root, 'src/index.js'), join(stageRoot, 'index.js'));
	await copyDirectory(join(root, 'src/res'), join(stageRoot, 'res'));
	await bundle({
		entryPoints  : {
			'croq-mirror'    : join(stageRoot, 'index.js'),
			'analysis-worker': join(stage, 'analysis-worker.js'),
		},
		outdir       : out,
		outExtension : { '.js': '.min.js' },
		bundle       : true,
		minify       : true,
		sourcemap    : true,
		format       : 'esm',
		platform     : 'browser',
		target       : 'es2022',
		legalComments: 'inline',
	});
}

async function buildStyle() {
	let css = '';
	for (const file of ['lib/codemirror', 'addon/dialog/dialog', 'addon/hint/show-hint', 'addon/lint/lint', 'addon/tern/tern']) css += await read('codemirror', file + '.css');
	// Scope dependency styles only; our CSS declares its own component scope.
	const tree = postcss.parse(css);
	tree.walkRules(rule => {
		if (rule.parent.type === 'atrule' && /keyframes/.test(rule.parent.name)) return;
		rule.selectors = rule.selectors.map(s => ':where(.croq-mirror) ' + s);
	});
	const styles = await bundle({
		entryPoints  : [join(root, 'src/styles/index.css')],
		bundle       : true,
		write        : false,
		loader       : { '.svg': 'dataurl' },
		supported    : { nesting: false },
		legalComments: 'inline',
	});
	css = tree.toString() + styles.outputFiles[0].text;
	const minifiedCss = await transform(css, { loader: 'css', minify: true, legalComments: 'inline', target: 'es2022' });
	await writeFileIfChanged(join(out, 'croq-mirror.min.css'), minifiedCss.code);
}

async function copyLicenses() {
	for (const name of ['codemirror', 'acorn', 'acorn-loose', 'acorn-walk', 'tern', 'jshint', 'jshint-ja-edu', 'js-beautify']) {
		const dir = resolvePackageDir(name);
		for (const file of await readdir(dir)) {
			if (/^(license|copying)/i.test(file)) await copyFileIfChanged(join(dir, file), join(out, 'licenses', name + '-' + file));
		}
	}
}

async function build() {
	await rm(stageRoot, { recursive: true, force: true });
	await rm(out, { recursive: true, force: true });
	await buildLibraries();
	await buildJavaScript();
	await buildStyle();
	await copyLicenses();
	console.log('Built dist');
}

await build();
