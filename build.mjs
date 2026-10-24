import { readFile, writeFile, mkdir, cp, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sass from 'sass';
import postcss from 'postcss';
import { build, transform } from 'esbuild';

const root      = dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);
const out       = join(root, 'dist');
const stageRoot = join(root, '.build');
const stage     = join(stageRoot, 'lib');
await rm(stageRoot, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

function pkg(name) {
	return dirname(require.resolve(name + '/package.json'));
}

async function read(name, path) {
	return readFile(join(pkg(name), path), 'utf8');
}

// Browser modules -------------------------------------------------------------

// Wrap the upstream browser builds in lexical scopes; no globals are installed on window.
const wrap = (code, result = '') => `(function(module,exports,define,globalThis,require){\n${code}\n${result}\n}).call(scope,undefined,undefined,undefined,scope,undefined);\n`;
let parser = 'const scope = {};\n';
parser += wrap(await read('acorn', 'dist/acorn.js'));
parser += 'const acorn = scope.acorn;\n';
parser += wrap(await read('acorn-loose', 'dist/acorn-loose.js'));
parser += wrap(await read('acorn-walk', 'dist/walk.js'));
await writeFile(join(stage, 'parser.js'), parser + `
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
await writeFile(join(stage, 'vendor.js'), vendor);
for (const file of await readdir(join(root, 'src/lib'))) await cp(join(root, 'src/lib', file), join(stage, file), { recursive: true });
await cp(join(root, 'src/res'), join(stageRoot, 'res'), { recursive: true });
await build({
	entryPoints: {
		'croq-mirror': join(stage, 'index.js'),
		'analysis-worker': join(stage, 'analysis-worker.js'),
	},
	outdir: out,
	outExtension: { '.js': '.min.js' },
	bundle: true,
	minify: true,
	sourcemap: true,
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
	legalComments: 'inline',
});

// Styles and assets -----------------------------------------------------------

let css = '';
for (const file of ['lib/codemirror', 'addon/dialog/dialog', 'addon/hint/show-hint', 'addon/lint/lint', 'addon/tern/tern']) css += await read('codemirror', file + '.css');
css += sass.compile(join(root, 'src/styles/editor.scss')).css;
const tree = postcss.parse(css);
tree.walkRules(rule => {
	if (rule.parent.type === 'atrule' && /keyframes/.test(rule.parent.name)) return;
	rule.selectors = rule.selectors.map(s => ':where(.croq-mirror) ' + s);
});
css = tree.toString() + `
.croq-mirror { position: relative; width: 100%; height: 100%; min-width: 0; }
.croq-mirror[aria-disabled="true"] { pointer-events: none; }
.croq-mirror .CodeMirror-Tern-tooltip { display: block; position: fixed; }
`;
css += `@font-face {font-family: CroqInconsolata; src: url('./assets/Inconsolata-dz.woff')}
@font-face {font-family: CroqLaMono; src: url('./assets/LaMono-Regular.ttf')}
@font-face {font-family: CroqLaMono; font-weight:700; src: url('./assets/LaMono-Bold.ttf')}
`;
css = css.replaceAll('url(cursor-', 'url(./assets/cursor-');
const minifiedCss = await transform(css, { loader: 'css', minify: true, legalComments: 'inline', target: 'es2022' });
await writeFile(join(out, 'croq-mirror.min.css'), minifiedCss.code);
await cp(join(root, 'src/assets'), join(out, 'assets'), { recursive: true });

// Third-party licenses --------------------------------------------------------

await mkdir(join(out, 'licenses'), { recursive: true });
for (const name of ['codemirror', 'acorn', 'acorn-loose', 'acorn-walk', 'tern', 'jshint', 'jshint-ja-edu', 'js-beautify']) {
	for (const file of await readdir(pkg(name))) {
		if (/^(license|copying)/i.test(file)) await cp(join(pkg(name), file), join(out, 'licenses', name + '-' + file));
	}
}
console.log('Built dist');
