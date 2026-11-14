import { lintEn, lintJa } from '../../lib/vendor.js';
import defaults from '../../res/defaults.json';

export function diagnostics(text, locale, options = {}) {
	const lint = locale === 'ja' ? lintJa : lintEn;
	lint(text, { ...defaults.jsHintOpt, indent: 1, ...options });
	return (lint.errors || []).filter(e => e && e.line > 0).map(e => ({
		message: e.reason,
		severity: e.code?.startsWith('W') ? 'warning' : 'error',
		from: { line: e.line - 1, ch: Math.max(0, e.character - 1) },
		to: { line: e.line - 1, ch: Math.max(1, e.character) },
	}));
}
