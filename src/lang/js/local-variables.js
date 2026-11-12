import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, ViewPlugin } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

const functionScopes = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunction', 'MethodDeclaration']);
const blockScopes = new Set(['Block', 'ForStatement', 'CatchClause', 'SwitchBody', 'ClassDeclaration', 'ClassExpression']);
const declarations = new Set(['VariableDeclaration', 'ForInSpec', 'ForOfSpec']);
const localReference = Decoration.mark({ class: 'cm-local-reference' });

function highlightLocals(state) {
	const references = [];
	let scope = null;
	syntaxTree(state).iterate({
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

	const marks = new RangeSetBuilder();
	for (const { from, to, scope } of references) {
		const name = state.sliceDoc(from, to);
		for (let binding = scope; binding; binding = binding.parent) {
			if (!binding.names.has(name)) continue;
			marks.add(from, to, localReference);
			break;
		}
	}
	return marks.finish();
}

export const localVariables = ViewPlugin.fromClass(class {
	constructor(view) {
		this.decorations = highlightLocals(view.state);
	}

	update({ changes, docChanged, startState, state }) {
		if (syntaxTree(startState) !== syntaxTree(state)) this.decorations = highlightLocals(state);
		else if (docChanged) this.decorations = this.decorations.map(changes);
	}
}, { decorations: plugin => plugin.decorations });
