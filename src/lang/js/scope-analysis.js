const BLOCKS = new Set([
	'BlockStatement', 'ForStatement', 'CatchClause',
]);
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

export function analyzeReferences(ast) {
	const definitions = [];
	const candidates  = [];

	function bind(node, scope, evaluationScope = scope) {
		if (!node) return;
		switch (node.type) {
			case 'Identifier':
				if (node.name === '✖' || node.start >= node.end) return;
				definitions.push(node);
				scope.bindings.set(node.name, node);
				break;
			case 'AssignmentPattern':
				bind(node.left, scope, evaluationScope);
				visit(node.right, evaluationScope);
				break;
			case 'RestElement':
				bind(node.argument, scope, evaluationScope);
				break;
			case 'ArrayPattern':
				for (const element of node.elements) {
					bind(element, scope, evaluationScope);
				}
				break;
			case 'ObjectPattern':
				for (const property of node.properties) {
					if (property.computed) visit(property.key, evaluationScope);
					bind(property.value ?? property.argument, scope, evaluationScope);
				}
				break;
		}
	}

	function visit(node, scope) {
		if (!node) return;
		if (FUNCTIONS.has(node.type)) {
			const parameters = createScope(scope);
			if (node.type === 'FunctionDeclaration') {
				bind(node.id, scope);
			} else {
				bind(node.id, parameters);
			}
			for (const param of node.params) {
				bind(param, parameters);
			}
			visit(node.body, createScope(parameters, true));
			return;
		}
		if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
			if (node.type === 'ClassDeclaration') bind(node.id, scope);
			const classScope = createScope(scope);
			if (node.type === 'ClassExpression') bind(node.id, classScope);
			visit(node.superClass, classScope);
			visit(node.body, classScope);
			return;
		}
		if (node.type === 'SwitchStatement') {
			visit(node.discriminant, scope);
			const switchScope = createScope(scope);
			for (const branch of node.cases) {
				visit(branch, switchScope);
			}
			return;
		}
		if (node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
			const loopScope = createScope(scope);
			visit(node.left, loopScope);
			visit(node.right, loopScope);
			visit(node.body, loopScope);
			return;
		}
		if (BLOCKS.has(node.type)) scope = createScope(scope);
		if (node.type === 'StaticBlock') scope = createScope(scope, true);
		switch (node.type) {
			case 'Identifier':
				if (node.name !== '✖' && node.start < node.end) candidates.push({ node, scope });
				return;
			case 'VariableDeclaration':
				for (const { id, init } of node.declarations) {
					bind(id, node.kind === 'var' ? scope.varScope : scope, scope);
					visit(init, scope);
				}
				return;
			case 'CatchClause':
				bind(node.param, scope);
				visit(node.body, scope);
				return;
			case 'Property':
			case 'MethodDefinition':
			case 'PropertyDefinition':
				if (node.computed) {
					visit(node.key, scope);
				}
				visit(node.value, scope);
				return;
			case 'MemberExpression':
				visit(node.object, scope);
				if (node.computed) {
					visit(node.property, scope);
				}
				return;
			case 'ImportDeclaration':
				for (const specifier of node.specifiers) {
					bind(specifier.local, scope);
				}
				return;
			case 'ExportNamedDeclaration':
				visit(node.declaration, scope);
				if (!node.source) {
					for (const specifier of node.specifiers) {
						visit(specifier.local, scope);
					}
				}
				return;
			case 'ExportAllDeclaration':
			case 'MetaProperty':
			case 'BreakStatement':
			case 'ContinueStatement':
				return;
			case 'LabeledStatement':
				visit(node.body, scope);
				return;
		}
		for (const value of Object.values(node)) {
			if (Array.isArray(value)) {
				for (const child of value) {
					if (child?.type) visit(child, scope);
				}
			} else if (value?.type) {
				visit(value, scope);
			}
		}
	}

	visit(ast, createScope(null, true));
	const ranges = definitions.map(node => toReference(node, 'definition', 'unknown'));
	for (const { node, scope } of candidates) {
		let owner = scope;
		while (owner && !owner.bindings.has(node.name)) {
			owner = owner.parent;
		}
		ranges.push(toReference(node, 'reference', owner?.parent ? 'local' : 'unknown'));
	}
	return ranges.sort((a, b) => a.from - b.from || a.to - b.to);
}

function createScope(parent, isVarScope = false) {
	const scope = { parent, bindings: new Map(), varScope: parent?.varScope };
	if (isVarScope) {
		scope.varScope = scope;
	}
	return scope;
}

function toReference(node, role, scope) {
	return {
		from: node.start,
		to  : node.end,
		role,
		scope
	};
}
