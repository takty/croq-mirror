const SCOPES = new Set([
	'method_declaration', 'constructor_declaration', 'compact_constructor_declaration',
	'lambda_expression', 'block', 'switch_block', 'for_statement',
	'enhanced_for_statement', 'catch_clause', 'try_with_resources_statement',
]);

const REFERENCE_PARENTS = new Set([
	'argument_list', 'array_access', 'array_initializer', 'assert_statement', 'assignment_expression',
	'binary_expression', 'cast_expression', 'dimensions_expr', 'enhanced_for_statement',
	'expression_statement', 'field_access', 'instanceof_expression', 'method_invocation',
	'method_reference', 'parenthesized_expression', 'resource', 'return_statement',
	'switch_expression', 'switch_statement', 'synchronized_statement',
	'ternary_expression', 'throw_statement', 'unary_expression', 'update_expression',
	'variable_declarator', 'yield_statement',
]);

function isField(node, parent, field) {
	const child = parent.childForFieldName(field);
	return child && child.startIndex === node.startIndex && child.endIndex === node.endIndex;
}

export function isVariableReference(node) {
	if (node.type !== 'identifier') return false;
	const parent = node.parent;
	if (!parent || !REFERENCE_PARENTS.has(parent.type)) return false;
	if (['variable_declarator', 'method_invocation', 'enhanced_for_statement', 'resource', 'instanceof_expression'].includes(parent.type) &&
		isField(node, parent, 'name')) {
		return false;
	}
	if (parent.type === 'method_reference' && parent.namedChild(0)?.startIndex !== node.startIndex) {
		return false;
	}
	return parent.type !== 'field_access' || !isField(node, parent, 'field');
}

export function createLocalVariables(textOf) {
	const scopes = [];

	function enter(node) {
		if (SCOPES.has(node.type)) scopes.push(new Map());
		if (node.type !== 'identifier' || !scopes.length) return;
		const parent = node.parent;
		if (!parent) return;
		let visibleFrom;
		let visibleTo = Infinity;
		if (parent.type === 'variable_declarator' &&
			['local_variable_declaration', 'spread_parameter'].includes(parent.parent?.type) &&
			isField(node, parent, 'name')) {
			visibleFrom = node.endIndex;
		} else if (['formal_parameter', 'spread_parameter', 'catch_formal_parameter'].includes(parent.type) &&
			isField(node, parent, 'name')) {
			visibleFrom = node.endIndex;
		} else if (parent.type === 'enhanced_for_statement' && isField(node, parent, 'name')) {
			visibleFrom = parent.childForFieldName('body')?.startIndex;
		} else if (parent.type === 'resource' && isField(node, parent, 'name')) {
			const body = parent.parent?.parent?.childForFieldName('body');
			if (body) {
				visibleFrom = node.endIndex;
				visibleTo = body.endIndex;
			}
		} else if ((parent.type === 'lambda_expression' && isField(node, parent, 'parameters')) ||
			parent.type === 'inferred_parameters') {
			visibleFrom = node.endIndex;
		}
		if (visibleFrom !== undefined) scopes.at(-1).set(textOf(node), { from: visibleFrom, to: visibleTo });
	}

	function leave(node) {
		if (SCOPES.has(node.type)) scopes.pop();
	}

	function isReference(node) {
		if (!scopes.length || !isVariableReference(node)) return false;
		const name = textOf(node);
		for (let i = scopes.length - 1; i >= 0; i--) {
			const binding = scopes[i].get(name);
			if (binding && node.startIndex >= binding.from && node.startIndex < binding.to) return true;
		}
		return false;
	}

	return { enter, leave, isReference };
}
