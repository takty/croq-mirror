import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Language, Parser } from 'web-tree-sitter';
import { analyzeJava } from '../src/lang/java/analyzer.js';

await Parser.init();
const parser = new Parser();
parser.setLanguage(await Language.load(fileURLToPath(new URL('../node_modules/tree-sitter-java/tree-sitter-java.wasm', import.meta.url))));

test('Java highlights lexical variable references without confusing declarations or member names', () => {
	const source = [
		'// 日本語 😀',
		'class Example {',
		'  int field;',
		'  void run(int arg, String... args) {',
		'    final int value = arg;',
		'    use(value, arg, args);',
		'    this.value = value;',
		'    { int nested = value; use(nested); }',
		'    use(nested);',
		'    for (int i = 0; i < 2; i++) use(i);',
		'    use(i);',
		'    for (String item : item) use(item);',
		'    use(item);',
		'    list.forEach(v -> use(v));',
		'    use(v);',
		'    int[] numbers = new int[value];',
		'    boolean valid = args instanceof Object;',
		'    Runnable action = args::toString;',
		'    try (var resource = acquire()) { use(resource); } catch (Exception ex) { use(ex); use(resource); }',
		'    use(ex);',
		'  }',
		'}',
	].join('\n');
	const tree = parser.parse(source);
	try {
		const result = analyzeJava(source, tree.rootNode);
		assert.equal(result.success, true);
		const localOffsets = new Set(result.syntaxHighlights
			.filter(item => item.kind === 'local-reference').map(item => item.from));
		const offset = (fragment, name) => source.indexOf(fragment) + fragment.indexOf(name);
		for (const [fragment, name] of [
			['value = arg', 'arg'], ['use(value, arg, args)', 'value'], ['use(value, arg, args)', 'arg'],
			['arg, args)', 'args'],
			['this.value = value', '= value'], ['nested = value', 'value'], ['use(nested); }', 'nested'],
			['i < 2', 'i'], ['i++', 'i'], ['use(i);', 'i'], ['use(item);', 'item'],
			['use(v));', 'v'], ['int[value]', 'value'], ['args instanceof', 'args'],
			['args::toString', 'args'], ['use(resource); }', 'resource'], ['use(ex); use', 'ex'],
		]) {
			const index = offset(fragment, name) + (name === '= value' ? 2 : 0);
			assert.ok(localOffsets.has(index), `expected local reference at ${fragment}: ${name}`);
		}
		for (const [fragment, name] of [
			['int value = arg', 'value'], ['this.value = value', 'value'],
			['    use(nested);', 'nested'], ['    use(i);', 'i'],
			[': item)', 'item'], ['    use(item);', 'item'], ['    use(v);', 'v'],
		]) {
			assert.ok(!localOffsets.has(offset(fragment, name)), `unexpected local reference at ${fragment}: ${name}`);
		}
		assert.ok(!localOffsets.has(offset('use(ex); use(resource);', 'resource')));
		assert.ok(!localOffsets.has(offset('    use(ex);', 'ex')));
		const referenceOffsets = new Set(result.syntaxHighlights
			.filter(item => item.kind === 'variable-reference').map(item => item.from));
		assert.ok(referenceOffsets.has(offset('use(value, arg, args)', 'value')));
		assert.ok(referenceOffsets.has(offset('    use(nested);', 'nested')));
		assert.ok(!referenceOffsets.has(offset('int value = arg', 'value')));
		assert.ok(!referenceOffsets.has(offset('this.value = value', 'value')));
		assert.ok(!referenceOffsets.has(offset('use(value, arg, args)', 'use')));
		assert.ok(!referenceOffsets.has(offset('args::toString', 'toString')));
		const tokens = result.decorations.filter(item => item.kind === 'token');
		assert.equal(tokens.length, 9);
		assert.ok(tokens.some(item => item.from.line === 4 && item.stroke === 'hsla(240, 75%, 65%, 0.75)'));
	} finally {
		tree.delete();
	}
});

test('Java classifies definitions, literals and operators separately from references and type punctuation', () => {
	const source = 'class Demo<T> { void run(String arg) { int count = 10; boolean flag = true; Object other = null; if (count > 0) { use(arg); } } }';
	const tree = parser.parse(source);
	try {
		const result = analyzeJava(source, tree.rootNode);
		assert.equal(result.success, true);
		const kinds = (text, start = 0) => {
			const from = source.indexOf(text, start);
			assert.notEqual(from, -1);
			return result.syntaxHighlights.filter(item => item.from === from && item.to === from + text.length)
				.map(item => item.kind);
		};
		for (const text of ['run', 'arg', 'count', 'flag', 'other']) {
			assert.ok(kinds(text).includes('definition'), `${text} must be a definition`);
		}
		assert.ok(!kinds('count', source.indexOf('if')).includes('definition'));
		assert.ok(!kinds('use').includes('definition'));
		for (const text of ['true', 'null', '10']) {
			assert.ok(kinds(text).includes('literal'), `${text} must be a literal`);
		}
		assert.ok(kinds('0', source.indexOf('if')).includes('literal'));
		assert.ok(kinds('>').includes('operator') === false);
		assert.ok(kinds('>', source.indexOf('if')).includes('operator'));
		assert.ok(kinds('=').includes('operator'));
	} finally {
		tree.delete();
	}
});

test('Java emits class ranges before their methods without changing method sections', () => {
	const source = 'class Outer {\n  void run() {\n    class Inner {}\n  }\n}\ninterface NotAClass {}\n';
	const tree = parser.parse(source);
	try {
		const result = analyzeJava(source, tree.rootNode);
		assert.equal(result.success, true);
		const classes = result.decorations.filter(item => item.fill === 'var(--croq-mirror-l-red, #e61e58)');
		assert.deepEqual(classes.map(item => [item.from.line, item.from.ch, item.to.line, item.to.ch, item.opacity]),
			[[0, 0, 4, 1, 0.15], [2, 4, 2, 18, 0.15]]);
		assert.deepEqual(result.sectionStarts, [1]);
		assert.ok(result.decorations.indexOf(classes[0]) < result.decorations.findIndex(item =>
			item.fill === 'hsla(40, 100%, 50%, 0.15)'));
	} finally {
		tree.delete();
	}
});
