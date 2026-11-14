import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { deleteCharBackward, insertNewlineAndIndent } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { lezerAnalysis, syntaxAnalysisState } from '../src/analysis/lezer-analysis.js';
import { lezerSyntax as javaSyntax } from '../src/lang/java/lezer-syntax.js';
import { lezerSyntax as javascriptSyntax } from '../src/lang/js/lezer-syntax.js';
import { commonAnalysisState, createCommonAnalysis, setCommonAnalysis } from '../src/analysis/common-analysis.js';
import { analyze } from '../.build/lang/js/analyzer.js';

test('JavaScript worker analysis reports shared UTF-16 ranges and references', () => {
	const source = '// 😀\nconst total = 2;\nfunction add(value) { return total + value; }';
	const result = createCommonAnalysis({ ...analyze(source).commonAnalysis, version: 9 });

	assert.equal(result.version, 9);
	assert.equal(result.sourceLength, source.length);
	assert.equal(result.complete, true);
	assert.ok(result.structures.some(item =>
		item.kind === 'function' && item.from === source.indexOf('function') && item.to === source.length));
	assert.ok(result.declarations.some(item =>
		item.from === source.indexOf('total') && item.mutability === 'immutable' && item.scope === 'lexical'));
	assert.deepEqual(result.sections, [{ kind: 'function', from: source.indexOf('function') }]);
	assert.ok(result.references.some(item => item.role === 'definition' && item.from === source.indexOf('total')));
	assert.ok(Object.isFrozen(result) && Object.isFrozen(result.structures));
	const incomplete = createCommonAnalysis({ ...analyze('function unfinished( {').commonAnalysis, version: 10 });
	assert.equal(incomplete.complete, false);
	assert.equal(incomplete.sourceLength, 'function unfinished( {'.length);
});

test('JavaScript conditional branches use common UTF-16 offsets', () => {
	const source = 'if (ready) { start(); } else { stop(); }';
	const result = createCommonAnalysis({ ...analyze(source).commonAnalysis, version: 11 });
	const conditional = result.structures.find(item => item.kind === 'conditional');
	assert.equal(conditional.branches.length, 1);
	assert.ok(conditional.branches[0] > conditional.from && conditional.branches[0] < conditional.to);
});

test('shared analysis state validates ranges, rejects older versions and maps usable data as stale', () => {
	const make = (version, sourceLength = 3) => createCommonAnalysis({
		version, sourceLength, complete: true, structures: [], declarations: [],
		syntax: sourceLength >= 3 ? [{ from: 1, to: 3, kind: 'keyword' }] : [],
		references: [], sections: sourceLength >= 3 ? [{ kind: 'function', from: 1 }] : [],
	});
	let state = EditorState.create({ doc: 'abc', extensions: [commonAnalysisState] });
	state = state.update({ effects: setCommonAnalysis.of(make(3)) }).state;
	assert.equal(state.field(commonAnalysisState).version, 3);

	state = state.update({ effects: setCommonAnalysis.of(make(2)) }).state;
	assert.equal(state.field(commonAnalysisState).version, 3);
	assert.throws(() => state.update({ effects: setCommonAnalysis.of(make(4, 2)) }).state, /document length/);
	assert.throws(() => createCommonAnalysis({
		version: 1, sourceLength: 3, complete: true,
		structures: [{ kind: 'function', from: 0, to: 4 }], declarations: [], syntax: [], references: [], sections: [],
	}), /range/);

	state = state.update({ changes: { from: 0, to: 1, insert: 'x' } }).state;
	assert.equal(state.field(commonAnalysisState).stale, true);
	assert.equal(state.field(commonAnalysisState).sourceLength, 3);
	assert.deepEqual(state.field(commonAnalysisState).syntax, [{ from: 1, to: 3, kind: 'keyword' }]);
	state = state.update({ effects: setCommonAnalysis.of(make(4)) }).state;
	assert.equal(state.field(commonAnalysisState).version, 4);
	state = state.update({ changes: { from: 2, insert: '!' } }).state;
	assert.equal(state.field(commonAnalysisState).stale, true);
	assert.deepEqual(state.field(commonAnalysisState).syntax, []);
	assert.deepEqual(state.field(commonAnalysisState).sections, [{ kind: 'function', from: 1 }]);
	state = state.update({ effects: setCommonAnalysis.of(make(5, 4)) }).state;
	state = state.update({ userEvent: 'load' }).state;
	assert.equal(state.field(commonAnalysisState), null);
});

test('shared analysis invalidates token ranges at insertion boundaries and rejects stale revisions', () => {
	const make = version => createCommonAnalysis({
		version, sourceLength: 3, complete: true, structures: [],
		declarations: [{ kind: 'variable', from: 1, to: 2, mutability: 'mutable', scope: 'lexical' }],
		syntax: [{ from: 1, to: 2, kind: 'variable' }],
		references: [{ from: 1, to: 2, role: 'reference', scope: 'local' }],
		sections: [],
	});

	for (const position of [1, 2]) {
		let state = EditorState.create({ doc: 'abc', extensions: [commonAnalysisState] });
		state = state.update({ effects: setCommonAnalysis.of(make(1)) }).state;
		state = state.update({ changes: { from: position, insert: 'x' } }).state;
		const stale = state.field(commonAnalysisState);
		assert.equal(stale.stale, true);
		const from = position === 1 ? 2 : 1;
		assert.deepEqual(stale.declarations, [{ from, to: from + 1, kind: 'variable', mutability: 'mutable', scope: 'lexical' }]);
		assert.deepEqual(stale.syntax, []);
		assert.deepEqual(stale.references, []);
	}

	let sameLength = EditorState.create({ doc: 'abc', extensions: [commonAnalysisState] });
	sameLength = sameLength.update({ effects: setCommonAnalysis.of(make(1)) }).state;
	sameLength = sameLength.update({ changes: { from: 0, to: 1, insert: 'z' } }).state;
	sameLength = sameLength.update({ effects: setCommonAnalysis.of(make(1)) }).state;
	assert.equal(sameLength.field(commonAnalysisState).stale, true);
	sameLength = sameLength.update({ effects: setCommonAnalysis.of(make(2)) }).state;
	assert.equal(sameLength.field(commonAnalysisState).version, 2);
	assert.equal(sameLength.field(commonAnalysisState).stale, false);
});

test('shared analysis drops a section whose start is deleted', () => {
	let state = EditorState.create({ doc: 'function fn() {}', extensions: [commonAnalysisState] });
	state = state.update({ effects: setCommonAnalysis.of(createCommonAnalysis({
		version: 1, sourceLength: state.doc.length, complete: true,
		structures: [], declarations: [], syntax: [], references: [],
		sections: [{ kind: 'function', from: 0 }],
	})) }).state;
	state = state.update({ changes: { from: 0, to: 8 } }).state;
	assert.deepEqual(state.field(commonAnalysisState).sections, []);
});

test('shared analysis retains edited structures until the next analysis', () => {
	let state = EditorState.create({ doc: 'fn()', extensions: [commonAnalysisState] });
	state = state.update({ effects: setCommonAnalysis.of(createCommonAnalysis({
		version: 1, sourceLength: state.doc.length, complete: true,
		structures: [{ kind: 'function', from: 0, to: state.doc.length, branches: [] }],
		declarations: [], syntax: [], references: [], sections: [],
	})) }).state;
	state = state.update({ changes: { from: 1, to: 2, insert: 'x' } }).state;
	const analysis = state.field(commonAnalysisState);
	assert.equal(analysis.stale, true);
	assert.deepEqual(analysis.structures.map(({ from, to }) => ({ from, to })), [{ from: 0, to: state.doc.length }]);
});

test('Enter and Backspace between methods retain structures in both languages', () => {
	for (const [language, first, second] of [
		[javascript, 'first() {}', 'second() {}'],
		[java, 'void first() {}', 'void second() {}'],
	]) {
		const doc = `class Example {\n  ${first}\n  \n  ${second}\n}`;
		const snapshot = (state, version) => {
			const source = state.doc.toString();
			return {
				version, sourceLength: source.length, complete: true,
				structures: [
					{ kind: 'class', from: 0, to: source.length },
					...[first, second].map(method => ({
						kind: 'function', from: source.indexOf(method), to: source.indexOf(method) + method.length,
					})),
				],
				declarations: [], syntax: [], references: [], sections: [],
			};
		};
		let state = EditorState.create({ doc, selection: { anchor: doc.indexOf('\n  \n') + 3 },
			extensions: [language(), indentUnit.of('\t'), commonAnalysisState] });
		state = state.update({ effects: setCommonAnalysis.of(snapshot(state, 0)) }).state;
		const dispatch = transaction => { state = transaction.state; };
		for (const [index, command] of [insertNewlineAndIndent, deleteCharBackward, insertNewlineAndIndent].entries()) {
			const previous = state.doc;
			if (command === deleteCharBackward) {
				assert.equal(previous.sliceString(state.selection.main.head - 1, state.selection.main.head), '\t');
			}
			assert.ok(command({ state, dispatch }));
			assert.equal(state.doc.lines, previous.lines + (command === deleteCharBackward ? 0 : 1));
			const mapped = state.field(commonAnalysisState);
			const fresh = snapshot(state, index + 1);
			assert.deepEqual(mapped.structures, createCommonAnalysis(fresh).structures);
			assert.ok(mapped.stale);
			state = state.update({ effects: setCommonAnalysis.of(fresh) }).state;
			assert.equal(state.field(commonAnalysisState).structures, mapped.structures);
			assert.equal(state.field(commonAnalysisState).declarations, mapped.declarations);
			assert.equal(state.field(commonAnalysisState).stale, false);
		}
		const from = state.doc.toString().indexOf(second);
		state = state.update({ changes: { from, to: from + second.length, insert: '  ' } }).state;
		assert.deepEqual(state.field(commonAnalysisState).structures.map(item => item.kind), ['class', 'function']);
	}
});

test('both Lezer sources replace stale code with comments and restore code on delimiter removal', () => {
	for (const [language, classifier, source, text] of [
		[javascript, javascriptSyntax, 'function f() {\n  let value = 1;\n}', 'let value = 1;'],
		[java, javaSyntax, 'class Example {\n  int value = 1;\n}', 'int value = 1;'],
	]) {
		const from = source.indexOf(text);
		let state = EditorState.create({ doc: source, extensions: [
			language(), commonAnalysisState, lezerAnalysis(classifier),
		] });
		state = state.update({ effects: setCommonAnalysis.of(createCommonAnalysis({
			version: 1, sourceLength: source.length, complete: true,
			structures: [], declarations: [], references: [], sections: [],
			syntax: [{ from, to: from + 3, kind: 'keyword' }],
		})) }).state;
		state = state.update({ changes: { from, insert: '//' } }).state;
		let data = state.field(syntaxAnalysisState).data;
		assert.ok(data.syntax.some(item => item.from === from && item.kind === 'comment'));
		assert.ok(!data.syntax.some(item => item.from >= from && item.from < from + text.length + 2 && item.kind !== 'comment'));
		assert.ok(!data.references.some(item => item.from >= from && item.from < from + text.length + 2));
		state = state.update({ changes: { from, to: from + 2 } }).state;
		data = state.field(syntaxAnalysisState).data;
		assert.ok(data.syntax.some(item => item.from === from && item.kind === 'keyword'));
		assert.ok(!data.syntax.some(item => item.from === from && item.kind === 'comment'));
		assert.ok(data.references.some(item => item.from === from + 4 && item.role === 'definition'));
	}
});
