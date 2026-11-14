export function buildCommonAnalysis(analysis, source, nodes, references) {
	const lineStarts = [0];
	for (let index = 0; index < source.length; index++) {
		const char = source.charCodeAt(index);
		if (char === 13 && source.charCodeAt(index + 1) === 10) index++;
		if (char === 10 || char === 13 || char === 0x2028 || char === 0x2029) lineStarts.push(index + 1);
	}
	const structures = [];
	const addStructures = (ranges, kind) => {
		for (const [from, to, ...branches] of ranges) {
			if (from < to) structures.push({ kind, from, to, branches });
		}
	};
	addStructures(nodes.fnLocs, 'function');
	addStructures(nodes.classLocs, 'class');
	addStructures(nodes.ifLocs, 'conditional');
	addStructures(nodes.forLocs, 'loop');

	const declarations = [];
	for (const [sourceKind, ranges] of [
		['var', nodes.varLocs],
		['let', nodes.letLocs],
		['const', nodes.constLocs],
	]) {
		for (const [from, to] of ranges) {
			if (from >= to) continue;
			declarations.push({
				kind: 'variable',
				from,
				to,
				mutability: sourceKind === 'const' ? 'immutable' : 'mutable',
				scope: sourceKind === 'var' ? 'function' : 'lexical',
			});
		}
	}
	const sections = [...new Set(analysis.fnStarts)]
		.map(line => ({ kind: 'function', from: lineStarts[line] }))
		.filter(({ from }) => from < source.length)
		.sort((a, b) => a.from - b.from);
	return {
		sourceLength: source.length,
		complete: analysis.success,
		structures,
		declarations,
		syntax: [],
		references,
		sections,
	};
}
