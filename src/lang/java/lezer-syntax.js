import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const style = HighlightStyle.define([
	{ tag: tags.comment, class: 'comment' },
	{ tag: [tags.keyword, tags.self, tags.standard(tags.typeName)], class: 'keyword' },
	{ tag: tags.operator, class: 'operator' },
	{ tag: [tags.bool, tags.null, tags.number, tags.string, tags.character], class: 'literal' },
	{ tag: tags.definition(tags.variableName), class: 'definition' },
	{ tag: tags.function(tags.variableName), class: 'function' },
	{ tag: tags.variableName, class: 'variable' },
	{ tag: tags.typeName, class: 'type' },
	{ tag: tags.invalid, class: 'invalid' },
]);

const typeDeclarations = new Set([
	'ClassDeclaration', 'InterfaceDeclaration', 'EnumDeclaration',
	'RecordDeclaration', 'AnnotationTypeDeclaration', 'TypeParameter',
]);

export const lezerSyntax = {
	style,
	classify(tree, kind, from, to, add) {
		const node = tree.resolveInner(from, 1);
		if (kind === 'definition') {
			const parent = node.parent?.name;
			if (typeDeclarations.has(parent)) add(from, to, 'type');
			else {
				add(from, to, kind);
				add(from, to, parent === 'MethodDeclaration' ? 'function' : 'variable');
			}
		} else {
			add(from, to, kind);
			if (kind === 'variable' && isReference(node)) add(from, to, 'variable-reference');
		}
	},
};

function isReference(node) {
	const parent = node.parent;
	if (!parent) return false;
	if (parent.name === 'FieldAccess' || parent.name === 'MethodReference') {
		const identifiers = parent.getChildren('Identifier');
		if (identifiers.length && identifiers.at(-1).from === node.from &&
			(parent.name === 'FieldAccess' || identifiers.length > 1)) {
			return false;
		}
	}
	return true;
}
