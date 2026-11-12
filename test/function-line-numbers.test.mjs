import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EditorState } from '@codemirror/state';
import { functionLineNumbers, getSectionLineNumber, setSectionStarts } from '../dist/function-line-numbers.js';

test('section numbers use supplied starts and clear on edits or loads', () => {
	let state = EditorState.create({ doc: 'a\nb\nc\nd\ne', extensions: [functionLineNumbers] });
	state = state.update({ effects: setSectionStarts.of([1, 3]) }).state;
	assert.deepEqual([0, 1, 2, 3, 4].map(line => getSectionLineNumber(state, line)),
		[[0, 1], [1, 1], [1, 2], [2, 1], [2, 2]]);
	state = state.update({ changes: { from: 0, insert: 'x' } }).state;
	assert.deepEqual(getSectionLineNumber(state, 4), [0, 5]);
	state = state.update({ effects: setSectionStarts.of([0]) }).state;
	state = state.update({ userEvent: 'load' }).state;
	assert.deepEqual(getSectionLineNumber(state, 4), [0, 5]);
	state = state.update({ changes: { from: 0, insert: 'x' }, effects: setSectionStarts.of([2]) }).state;
	assert.deepEqual(getSectionLineNumber(state, 4), [1, 3]);
});

test('invalid starts and query lines are rejected', () => {
	const state = EditorState.create({ doc: 'a\nb', extensions: [functionLineNumbers] });
	for (const starts of [[-1], [2], [1, 0], [0.5], Array(1)]) {
		assert.throws(() => getSectionLineNumber(state.update({ effects: setSectionStarts.of(starts) }).state, 0), RangeError);
	}
	assert.throws(() => getSectionLineNumber(state.update({ effects: setSectionStarts.of(null) }).state, 0), TypeError);
	for (const line of [-1, 2, 0.5]) assert.throws(() => getSectionLineNumber(state, line), RangeError);
});
