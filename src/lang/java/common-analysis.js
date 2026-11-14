export function buildCommonAnalysis(sourceLength, complete, ranges, sectionStarts, lineStarts) {
	const { structures, declarations, syntax, references } = ranges;
	return {
		sourceLength,
		complete,
		structures,
		declarations,
		syntax,
		references,
		sections: sectionStarts.map(line => ({ kind: 'function', from: lineStarts[line] })),
	};
}
