import { createCommonAnalysis } from '../../analysis/common-analysis.js';

export function adaptJavaAnalysis(analysis, version) {
	const data = analysis.commonAnalysis;
	if (!data) throw new TypeError('Java analysis is missing common data');
	return createCommonAnalysis({ ...data, version });
}
