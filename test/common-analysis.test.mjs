import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { commonAnalysisState, createCommonAnalysis, setCommonAnalysis } from '../src/analysis/common-analysis.js';
import { adaptJavaScriptAnalysis } from '../src/lang/js/analysis-adapter.js';
import { analyze } from '../.build/lang/js/analyzer.js';

test('JavaScript adapter converts parser positions and semantic ranges to shared UTF-16 data', () => {
	const source = '// 😀\nconst total = 2;\nfunction add(value) { return total + value; }';
	const parsed = analyze(source);
	const syntax = [
		{ from: source.indexOf('total'), to: source.indexOf('total') + 5, kind: 'definition' },
		{ from: source.lastIndexOf('total'), to: source.lastIndexOf('total') + 5, kind: 'variable-reference' },
	];
	const result = adaptJavaScriptAnalysis(parsed, source, 9, syntax);

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
	const incomplete = adaptJavaScriptAnalysis(analyze('function unfinished( {'), 'function unfinished( {', 10);
	assert.equal(incomplete.complete, false);
	assert.equal(incomplete.sourceLength, 'function unfinished( {'.length);
});

test('JavaScript conditional branches use common UTF-16 offsets', () => {
	const source = 'if (ready) { start(); } else { stop(); }';
	const result = adaptJavaScriptAnalysis(analyze(source), source, 11);
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

test('shared analysis maps enclosing structures across safe newline insertions', () => {
	let state = EditorState.create({ doc: 'fn()', extensions: [commonAnalysisState] });
	state = state.update({ effects: setCommonAnalysis.of(createCommonAnalysis({
		version: 1, sourceLength: state.doc.length, complete: true,
		structures: [{ kind: 'function', from: 0, to: state.doc.length, branches: [] }],
		declarations: [], syntax: [], references: [], sections: [],
	})) }).state;
	state = state.update({ changes: { from: 2, insert: '\n  ' } }).state;
	const analysis = state.field(commonAnalysisState);
	assert.equal(analysis.stale, true);
	assert.deepEqual(analysis.structures.map(({ from, to }) => ({ from, to })), [{ from: 0, to: state.doc.length }]);
});
