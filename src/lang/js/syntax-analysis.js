import { HighlightStyle, syntaxTree } from '@codemirror/language';
import { highlightTree, tags } from '@lezer/highlight';

const style = HighlightStyle.define([
	{ tag: tags.comment, class: 'comment' },
	{ tag: [tags.keyword, tags.operator, tags.meta], class: 'keyword' },
	{ tag: [tags.bool, tags.null, tags.atom, tags.number, tags.string, tags.special(tags.string), tags.regexp], class: 'literal' },
	{ tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName)], class: 'definition' },
	{ tag: tags.variableName, class: 'variable' },
	{ tag: tags.local(tags.variableName), class: 'local-variable' },
	{ tag: tags.propertyName, class: 'property' },
	{ tag: tags.invalid, class: 'invalid' },
]);

const functionScopes = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunction', 'MethodDeclaration']);
const blockScopes = new Set(['Block', 'ForStatement', 'CatchClause', 'SwitchBody', 'ClassDeclaration', 'ClassExpression']);
const declarations = new Set(['VariableDeclaration', 'ForInSpec', 'ForOfSpec']);
export function analyzeSyntax(state) {
	const tree = syntaxTree(state);
	const highlights = [];
	highlightTree(tree, style, (from, to, classes) => {
		const kinds = new Set(classes.split(' '));
		for (const kind of kinds) highlights.push({ from, to, kind });
		if (kinds.has('variable') || kinds.has('local-variable')) {
			highlights.push({ from, to, kind: 'variable-reference' });
		}
	});
	const references = [];
	let scope = null;
	tree.iterate({
		enter(node) {
			const isFunction = functionScopes.has(node.name);
			if (isFunction || blockScopes.has(node.name)) {
				scope = { parent: scope, names: new Set(), functionScope: isFunction };
			}
			if (node.name === 'VariableDefinition' && scope) {
				const parent = node.node.parent;
				let target = scope;
				if (parent.name === 'FunctionDeclaration' || parent.name === 'ClassDeclaration') {
					target = scope.parent;
				} else {
					for (let owner = parent; owner && !functionScopes.has(owner.name) && !blockScopes.has(owner.name); owner = owner.parent) {
						if (!declarations.has(owner.name)) continue;
						if (owner.getChild('var')) {
							while (target && !target.functionScope) target = target.parent;
						}
						break;
					}
				}
				target?.names.add(state.sliceDoc(node.from, node.to));
			}
			if (node.name === 'VariableName' && scope) {
				references.push({ from: node.from, to: node.to, scope });
			}
		},
		leave(node) {
			if (functionScopes.has(node.name) || blockScopes.has(node.name)) scope = scope.parent;
		},
	});

	for (const { from, to, scope } of references) {
		const name = state.sliceDoc(from, to);
		for (let binding = scope; binding; binding = binding.parent) {
			if (!binding.names.has(name)) continue;
			highlights.push({ from, to, kind: 'local-reference' });
			break;
		}
	}
	return highlights;
}
