import { createLocalVariables, isVariableReference } from './syntax-analysis.js';
import { referencesFromSyntax } from '../../analysis/common-analysis.js';

const KEYWORDS = new Set([
	'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
	'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
	'extends', 'final', 'finally', 'float', 'for', 'if', 'implements', 'import',
	'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package',
	'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
	'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient',
	'try', 'void', 'volatile', 'while', 'var', 'yield',
	'record', 'sealed', 'permits', 'non-sealed', 'module', 'open', 'opens',
	'exports', 'requires', 'transitive', 'to', 'uses', 'provides', 'with',
]);

const DECLARATIONS = new Set([
	'class_declaration', 'interface_declaration', 'enum_declaration',
	'record_declaration', 'annotation_type_declaration',
]);

const LITERALS = new Set(['string_literal', 'character_literal', 'text_block', 'true', 'false']);
const OPERATORS = new Set([
	'=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '>>>=',
	'+', '-', '*', '/', '%', '++', '--', '==', '!=', '<', '>', '<=', '>=',
	'&&', '||', '!', '~', '&', '|', '^', '<<', '>>', '>>>', '?', ':', '.', '::',
]);
const DEFINITION_PARENTS = new Set([
	'variable_declarator', 'formal_parameter', 'catch_formal_parameter',
	'enhanced_for_statement', 'resource', 'method_declaration', 'constructor_declaration',
	'compact_constructor_declaration',
]);
const FUNCTION_NODES = new Set([
	'method_declaration', 'constructor_declaration', 'compact_constructor_declaration',
	'lambda_expression',
]);
const CONDITIONAL_NODES = new Set(['if_statement', 'switch_statement', 'switch_expression']);
const LOOP_NODES = new Set([
	'do_statement', 'enhanced_for_statement', 'for_statement', 'while_statement',
]);

export function analyzeJava(source, rootNode) {
	const bytes = new TextEncoder().encode(source);
	const decoder = new TextDecoder();
	const utf8ToUtf16 = createUtf8OffsetMap(source);
	const usesByteOffsets = rootNode.endIndex === bytes.length;
	const toOffset = usesByteOffsets ? index => utf8ToUtf16[index] : index => index;
	const textOf = node => usesByteOffsets
		? decoder.decode(bytes.subarray(node.startIndex, node.endIndex))
		: source.slice(node.startIndex, node.endIndex);
	const locals = createLocalVariables(textOf);
	const syntaxHighlights = [];
	const sectionStarts = new Set();
	const decorations = [];
	const structures = [];
	const declarations = [];
	const lineStarts = [0];
	for (let i = 0; i < source.length; i++) {
		if (source.charCodeAt(i) === 10) lineStarts.push(i + 1);
	}

	function positionAt(offset) {
		let low = 0, high = lineStarts.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (lineStarts[middle] <= offset) low = middle + 1;
			else high = middle;
		}
		const line = low - 1;
		return { line, ch: offset - lineStarts[line] };
	}

	function add(node, kind) {
		if (node.endIndex <= node.startIndex) return;
		const from = toOffset(node.startIndex);
		const to = toOffset(node.endIndex);
		if (from !== undefined && to !== undefined) syntaxHighlights.push({ from, to, kind });
	}

	function addRange(node, kind, fill, branches = [], opacity) {
		const from = toOffset(node.startIndex), to = toOffset(node.endIndex);
		if (from === undefined || to === undefined || to <= from) return;
		const branchOffsets = branches.filter(Number.isInteger);
		structures.push({ kind, from, to, branches: branchOffsets });
		decorations.push({
			kind: 'range', from: positionAt(from), to: positionAt(to), fill,
			...(opacity === undefined ? {} : { opacity }),
			spineChars: 3, branchChars: 4, branches: branchOffsets.map(positionAt),
		});
	}

	function addVariableDeclaration(node) {
		const declarator = node.parent;
		const declaration = declarator?.type === 'variable_declarator' ? declarator.parent : declarator;
		if (!['local_variable_declaration', 'field_declaration', 'enhanced_for_statement', 'resource'].includes(declaration?.type) ||
			declarator.childForFieldName('name')?.startIndex !== node.startIndex) return;
		const from = toOffset(node.startIndex), to = toOffset(node.endIndex);
		if (from === undefined || to === undefined || from >= to) return;
		const modifiers = declaration.namedChildren.find(child => child.type === 'modifiers');
		const isFinal = modifiers && /\bfinal\b/.test(textOf(modifiers));
		const scope = declaration.type === 'field_declaration' ? 'member' : 'lexical';
		declarations.push({
			kind: 'variable', from, to,
			mutability: isFinal ? 'immutable' : 'mutable',
			scope,
		});
		decorations.push({
			kind: 'token', from: positionAt(from), to: positionAt(to),
			fill: isFinal ? 'hsla(240, 75%, 97%, 1)' : 'hsla(205, 100%, 97%, 1)',
			stroke: isFinal ? 'hsla(240, 75%, 65%, 0.75)' : 'hsla(205, 100%, 52%, 0.75)',
		});
	}

	function visit(node) {
		if (node.isError) {
			add(node, 'invalid');
			return;
		}
		if (node.isMissing) return;
		locals.enter(node);
		if (node.type === 'class_declaration') {
			addRange(node, 'class', 'var(--croq-mirror-l-red, #e61e58)', [], 0.15);
		} else if (FUNCTION_NODES.has(node.type)) {
			const start = toOffset(node.startIndex);
			if (start !== undefined) {
				const position = positionAt(start);
				sectionStarts.add(position.line);
				addRange(node, 'function', 'hsla(40, 100%, 50%, 0.15)');
			}
		} else if (CONDITIONAL_NODES.has(node.type)) {
			const alternative = node.childForFieldName('alternative');
			const branchOffset = alternative ? toOffset(alternative.startIndex) : undefined;
			const branches = branchOffset === undefined ? [] : [branchOffset];
			addRange(node, 'conditional', 'hsla(150, 100%, 35%, 0.15)', branches);
		} else if (LOOP_NODES.has(node.type)) {
			addRange(node, 'loop', 'hsla(190, 90%, 50%, 0.20)');
		}
		if (node.type.includes('comment')) {
			add(node, 'comment');
			locals.leave(node);
			return;
		}
		if (LITERALS.has(node.type) || node.type.endsWith('_literal')) {
			add(node, 'literal');
			locals.leave(node);
			return;
		}
		if (node.childCount === 0) {
			const text = textOf(node);
			if (KEYWORDS.has(text)) add(node, 'keyword');
			else if (isOperator(node, text)) {
				add(node, 'operator');
			}
			else if (node.type === 'type_identifier') add(node, 'type');
			else if (node.type === 'identifier' || node.type === 'field_identifier') {
				addVariableDeclaration(node);
				add(node, locals.isReference(node) ? 'local-reference' : identifierKind(node));
				if (isVariableReference(node)) add(node, 'variable-reference');
				if (isDefinition(node)) add(node, 'definition');
			}
			locals.leave(node);
			return;
		}
		for (let i = 0; i < node.childCount; i++) visit(node.child(i));
		locals.leave(node);
	}

	visit(rootNode);
	syntaxHighlights.sort((a, b) => a.from - b.from || a.to - b.to);
	const references = referencesFromSyntax(syntaxHighlights);
	const sections = [...sectionStarts].sort((a, b) => a - b)
		.map(line => ({ kind: 'function', from: lineStarts[line] }));
	return {
		success: !rootNode.hasError,
		syntaxHighlights,
		sectionStarts: [...sectionStarts].sort((a, b) => a - b),
		decorations,
		commonAnalysis: {
			sourceLength: source.length,
			complete: !rootNode.hasError,
			structures,
			declarations,
			syntax: syntaxHighlights,
			references,
			sections,
		},
	};
}

function isOperator(node, text) {
	if (!OPERATORS.has(text)) return false;
	const parent = node.parent?.type;
	if (['type_arguments', 'type_parameters', 'wildcard', 'scoped_type_identifier', 'scoped_identifier'].includes(parent)) return false;
	return text !== ':' || parent === 'ternary_expression';
}

function isDefinition(node) {
	const parent = node.parent;
	if (!parent) return false;
	if (parent.type === 'inferred_parameters') return true;
	if (parent.type === 'lambda_expression') {
		return parent.childForFieldName('parameters')?.startIndex === node.startIndex;
	}
	return DEFINITION_PARENTS.has(parent.type) &&
		parent.childForFieldName('name')?.startIndex === node.startIndex;
}

function identifierKind(node) {
	const parent = node.parent;
	if (!parent) return 'variable';
	const name = parent.childForFieldName('name');
	if (name?.startIndex === node.startIndex && DECLARATIONS.has(parent.type)) return 'type';
	if (name?.startIndex === node.startIndex && parent.type === 'method_declaration') return 'function';
	if (name?.startIndex === node.startIndex && parent.type === 'method_invocation') return 'function';
	return 'variable';
}

function createUtf8OffsetMap(source) {
	const offsets = [];
	const encoder = new TextEncoder();
	let byteOffset = 0;
	let utf16Offset = 0;
	offsets[0] = 0;
	for (const character of source) {
		byteOffset += encoder.encode(character).length;
		utf16Offset += character.length;
		offsets[byteOffset] = utf16Offset;
	}
	return offsets;
}

