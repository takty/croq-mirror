import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../.build/lang/js/analyzer.js';
import { AnalysisClient } from '../src/analysis-client.js';

test('strict and tolerant results retain the existing coordinate contract', () => {
	const valid = analyze('function outer() {\n const f = () => 1;\n if (f()) { for (let i=0;i<2;i++) {} }\n}');
	assert.equal(valid.success, true);
	assert.deepEqual(valid.fnNames, ['outer', 'f']);
	assert.deepEqual(valid.fnStarts, [0]);
	assert.equal(valid.fnLocs[0][0].line, 1);
	assert.equal(valid.ifLocs.length, 1);
	assert.equal(valid.forLocs.length, 1);
	const invalid = analyze('function unfinished( {');
	assert.equal(invalid.success, false);
	assert.ok(Array.isArray(invalid.fnLocs));
	assert.equal('ast' in valid, false);
});

test('JavaScript analysis reports class declarations and expressions', () => {
	const result = analyze('class Outer {\n method() { return class Inner {}; }\n}\nconst Other = class {};\n');
	assert.equal(result.success, true);
	assert.deepEqual(result.classLocs.map(([from, to]) => [from.line, from.column, to.line, to.column]),
		[[1, 0, 3, 1], [2, 19, 2, 33], [4, 14, 4, 22]]);
	assert.deepEqual(result.fnStarts, [1]);
});

class WorkerMock {
	sent = [];
	terminated = false;
	postMessage(data) {
		this.sent.push(data);
	}
	terminate() {
		this.terminated = true;
	}
	deliver(data) {
		this.onmessage({ data });
	}
}
test('worker replies match requests even out of order', async () => {
	const worker = new WorkerMock();
	const client = new AnalysisClient(worker);
	worker.deliver({ ready: true });
	await client.ready;
	const first = client.request('old', 1);
	const second = client.request('new', 2);
	worker.deliver({ id: 2, result: { text: 'new', version: 2 } });
	worker.deliver({ id: 1, result: { text: 'old', version: 1 } });
	assert.deepEqual(await first, { text: 'old', version: 1 });
	assert.deepEqual(await second, { text: 'new', version: 2 });
	client.destroy();
	assert.equal(worker.terminated, true);
});
test('destroy rejects pending and future requests', async () => {
	const worker = new WorkerMock();
	const client = new AnalysisClient(worker);
	worker.deliver({ ready: true });
	await client.ready;
	const pending = client.request('code', 1);
	const rejected = assert.rejects(pending, /destroyed/);
	client.destroy();
	await rejected;
	await assert.rejects(client.request('later', 2), /destroyed/);
});
test('worker startup and runtime failures are observable', async () => {
	const worker = new WorkerMock();
	const client = new AnalysisClient(worker);
	const ready = assert.rejects(client.ready, /failed/);
	worker.onerror({ message: 'failed' });
	await ready;
	assert.equal(worker.terminated, true);
});

test('JavaScript worker resolves lexical references and excludes property names', () => {
	const source = [
		'function outer(arg = external) {',
		'  { var shared = arg; let block = arg; use(block); }',
		'  const { value: alias } = arg;',
		'  use(shared, block, alias, arg.value, arg[alias]);',
		'}',
		'use(shared);',
	].join('\n');
	const { references } = analyze(source).commonAnalysis;
	const scopeAt = (fragment, name) => {
		const from = source.indexOf(fragment) + fragment.indexOf(name);
		return references.find(item => item.from === from && item.role === 'reference')?.scope;
	};
	assert.equal(scopeAt('arg = external', 'external'), 'unknown');
	assert.equal(scopeAt('use(block)', 'block'), 'local');
	assert.equal(scopeAt('use(shared, block', 'shared'), 'local');
	assert.equal(scopeAt('use(shared, block', 'block'), 'unknown');
	assert.equal(scopeAt('alias, arg.value', 'alias'), 'local');
	assert.equal(scopeAt('arg.value', 'value'), undefined);
	assert.equal(scopeAt('arg[alias]', 'alias'), 'local');
	assert.equal(scopeAt('use(shared);', 'shared'), 'unknown');
});
