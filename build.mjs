import { readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
	for (const file of ['signal', 'tern', 'def', 'comment', 'infer']) vendor += wrap(await read('tern', `lib/${file}.js`));
	for (const [name, symbol] of [
		['jshint', 'lintEn'],
		['jshint-ja-edu', 'lintJa'],
	]) {
		vendor += `const ${symbol} = (function(exports){\n${await read(name, 'dist/jshint.js')}\nreturn exports.JSHINT;\n})({});\n`;
	}
	vendor += `const beautify = (function(exports){\n${await read('js-beautify', 'js/lib/beautify.js')}\nreturn exports.js_beautify;\n})({});\n`;
	const defs = await Promise.all(['ecmascript', 'browser'].map(n => read('tern', `defs/${n}.json`).then(JSON.parse)));
	vendor += `const defaultDefinitions = ${JSON.stringify(defs)};\nexport { tern, lintEn, lintJa, beautify, defaultDefinitions };\n`;
	await writeFileIfChanged(join(stage, 'vendor.js'), vendor);
}

async function buildJavaScript() {
	for (const file of await readdir(join(root, 'src'))) {
		if (file.endsWith('.js')) await copyFileIfChanged(join(root, 'src', file), join(stageRoot, file));
	}
	await copyDirectory(join(root, 'src/lang'), join(stageRoot, 'lang'));
	await copyDirectory(join(root, 'src/analysis'), join(stageRoot, 'analysis'));
	await copyDirectory(join(root, 'src/extensions'), join(stageRoot, 'extensions'));
	await copyDirectory(join(root, 'src/res'), join(stageRoot, 'res'));
	await bundle({
		entryPoints  : {
			'croq-mirror'    : join(stageRoot, 'index.js'),
			'analysis-worker': join(stageRoot, 'lang/js/analysis-worker.js'),
			'analysis-worker-java': join(stageRoot, 'lang/java/analysis-worker.js'),
		},
		outdir       : out,
		outExtension : { '.js': '.min.js' },
		bundle       : true,
		loader       : { '.svg': 'base64', '.css': 'text' },
		minify       : true,
		sourcemap    : true,
		format       : 'esm',
		platform     : 'browser',
		target       : 'es2022',
		legalComments: 'inline',
	});
	await bundle({
		entryPoints: {
			'structure-view': join(stageRoot, 'extensions', 'structure-view', 'index.js'),
			'function-line-numbers': join(stageRoot, 'extensions', 'function-line-numbers', 'index.js'),
			'gutter-line-selection': join(stageRoot, 'extensions', 'gutter-line-selection', 'index.js'),
			'indent-rulers': join(stageRoot, 'extensions', 'indent-rulers', 'index.js'),
			'syntax-highlighting': join(stageRoot, 'extensions', 'syntax-highlighting', 'index.js'),
		},
		outdir: out,
		bundle: true,
		loader: { '.svg': 'base64', '.css': 'text' },
		packages: 'external',
		format: 'esm',
		platform: 'browser',
		target: 'es2022',
		legalComments: 'inline',
	});
	await copyFileIfChanged(join(resolvePackageDir('web-tree-sitter'), 'web-tree-sitter.wasm'), join(out, 'web-tree-sitter.wasm'));
	await copyFileIfChanged(join(resolvePackageDir('tree-sitter-java'), 'tree-sitter-java.wasm'), join(out, 'tree-sitter-java.wasm'));
}

async function buildStyle() {
	const styles = await bundle({
		entryPoints  : [join(root, 'src/styles/index.css')],
		bundle       : true,
		write        : false,
		loader       : { '.svg': 'dataurl' },
		supported    : { nesting: false },
		legalComments: 'inline',
	});
	const minifiedCss = await transform(styles.outputFiles[0].text, { loader: 'css', minify: true, legalComments: 'inline', target: 'es2022' });
	await writeFileIfChanged(join(out, 'croq-mirror.min.css'), minifiedCss.code);
}

async function copyLicenses() {
	for (const name of ['@codemirror/state', '@codemirror/view', '@codemirror/commands', '@codemirror/language',
		'@codemirror/lang-java', '@codemirror/lang-javascript', '@codemirror/autocomplete', '@codemirror/lint', '@codemirror/search',
		'@lezer/common', '@lezer/highlight', '@lezer/java', '@lezer/javascript', '@lezer/lr',
		'@marijn/find-cluster-break', 'crelt', 'style-mod', 'w3c-keyname', 'acorn', 'acorn-loose', 'acorn-walk', 'tern', 'jshint', 'jshint-ja-edu', 'js-beautify', 'web-tree-sitter', 'tree-sitter-java']) {
		const dir = resolvePackageDir(name);
		for (const file of await readdir(dir)) {
			if (/^(license|copying)/i.test(file)) await copyFileIfChanged(join(dir, file), join(out, 'licenses', name.replace(/^@/, '').replace('/', '-') + '-' + file));
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
