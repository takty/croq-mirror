const LOOP_STATEMENTS = new Set(['for_statement', 'enhanced_for_statement', 'while_statement', 'do_statement']);

export function diagnoseJava(root, locale) {
	const japanese = locale === 'ja';
	const diagnostics = [];
	const position = ({ row, column }) => ({ line: row, ch: column });
	const add = (node, severity, message) => diagnostics.push({
		message, severity, from: position(node.startPosition), to: position(node.endPosition),
	});
	const checkBody = node => {
		if (!node || node.type === 'block' || node.hasError) return;
		add(node, 'warning', japanese ? '文を波括弧 { } で囲んでください。' : 'Wrap the statement in braces.');
	};

	const cursor = root.walk();
	try {
		for (;;) {
			const node = cursor.currentNode;
			if (node.isMissing) {
				add(node, 'error', japanese ? `「${node.type}」が必要です。` : `Expected "${node.type}".`);
			} else if (node.isError) {
				add(node, 'error', japanese ? 'この部分の構文を確認してください。' : 'Unexpected syntax.');
			} else if (node.type === 'if_statement') {
				checkBody(node.childForFieldName('consequence'));
				const alternative = node.childForFieldName('alternative');
				if (alternative?.type !== 'if_statement') checkBody(alternative);
			} else if (LOOP_STATEMENTS.has(node.type)) {
				checkBody(node.childForFieldName('body'));
			}
			if (!node.isError && cursor.gotoFirstChild()) continue;
			while (!cursor.gotoNextSibling()) {
				if (!cursor.gotoParent()) return diagnostics;
			}
		}
	} finally {
		cursor.delete();
	}
}
