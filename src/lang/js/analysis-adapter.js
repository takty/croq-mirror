import { createCommonAnalysis, referencesFromSyntax } from '../../analysis/common-analysis.js';

export function adaptJavaScriptAnalysis(analysis, source, version, syntax = []) {
	const lineStarts = [0];
	for (let index = 0; index < source.length; index++) {
		if (source.charCodeAt(index) === 10) lineStarts.push(index + 1);
	}
	const offsetAt = position => {
		const line = position.line - 1;
		if (!Number.isInteger(line) || line < 0 || line >= lineStarts.length ||
			!Number.isInteger(position.column) || position.column < 0) {
			throw new RangeError('Invalid JavaScript parser position');
		}
		const offset = lineStarts[line] + position.column;
		const lineEnd = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : source.length;
		if (offset > lineEnd) throw new RangeError('JavaScript parser position exceeds its line');
		return offset;
	};
	const structures = [];
	const addStructures = (ranges, kind) => {
		for (const [from, to, ...branches] of ranges || []) {
			structures.push({ kind, from: offsetAt(from), to: offsetAt(to), branches: branches.map(offsetAt) });
		}
	};
	addStructures(analysis.fnLocs, 'function');
	addStructures(analysis.classLocs, 'class');
	addStructures(analysis.ifLocs, 'conditional');
	addStructures(analysis.forLocs, 'loop');

	const declarations = [];
	for (const [sourceKind, ranges] of [
		['var', analysis.varLocs],
		['let', analysis.letLocs],
		['const', analysis.constLocs],
	]) {
		for (const [from, to] of ranges || []) {
			declarations.push({
				kind: 'variable',
				from: offsetAt(from),
				to: offsetAt(to),
				mutability: sourceKind === 'const' ? 'immutable' : 'mutable',
				scope: sourceKind === 'var' ? 'function' : 'lexical',
			});
		}
	}
	const sections = [...new Set(analysis.fnStarts || [])].map(line => {
		if (!Number.isInteger(line) || line < 0 || line >= lineStarts.length) {
			throw new RangeError('Invalid JavaScript function section');
		}
		return { kind: 'function', from: lineStarts[line] };
	}).sort((a, b) => a.from - b.from);
	return createCommonAnalysis({
		version,
		sourceLength: source.length,
		complete: !!analysis.success,
		structures,
		declarations,
		syntax: syntax.map(({ from, to, kind }) => ({ from, to, kind })),
		references: referencesFromSyntax(syntax),
		sections,
	});
}
