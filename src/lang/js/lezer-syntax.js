import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

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

const FUNCTION_SCOPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunction', 'MethodDeclaration']);
const BLOCK_SCOPES    = new Set(['Block', 'ForStatement', 'CatchClause', 'SwitchBody', 'ClassDeclaration', 'ClassExpression']);
const DECLARATIONS    = new Set(['VariableDeclaration', 'ForInSpec', 'ForOfSpec']);

export const lezerSyntax = {
	style,
	classify(_tree, kind, from, to, add) {
		add(from, to, kind);
		if (kind === 'variable' || kind === 'local-variable') add(from, to, 'variable-reference');
	},
	collectInterimReferences,
};

function collectInterimReferences(tree, state, add) {
	const references = [];
	let scope = null;
	tree.iterate({
		enter(node) {
			const isFunction = FUNCTION_SCOPES.has(node.name);
			if (isFunction || BLOCK_SCOPES.has(node.name)) {
				scope = { parent: scope, names: new Set(), functionScope: isFunction };
			}
			if (node.name === 'VariableDefinition' && scope) {
				const parent = node.node.parent;
				let target = scope;
				if (parent.name === 'FunctionDeclaration' || parent.name === 'ClassDeclaration') {
					target = scope.parent;
				} else {
					for (let owner = parent; owner && !FUNCTION_SCOPES.has(owner.name) && !BLOCK_SCOPES.has(owner.name); owner = owner.parent) {
						if (!DECLARATIONS.has(owner.name)) continue;
						if (owner.getChild('var')) {
							while (target && !target.functionScope) {
								target = target.parent;
							}
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
			if (FUNCTION_SCOPES.has(node.name) || BLOCK_SCOPES.has(node.name)) {
				scope = scope.parent;
			}
		},
	});

	for (const { from, to, scope } of references) {
		const name = state.sliceDoc(from, to);
		for (let binding = scope; binding; binding = binding.parent) {
			if (!binding.names.has(name)) continue;
			add(from, to, 'local-reference');
			break;
		}
	}
}
