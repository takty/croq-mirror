/**
 * Code Analyzer (JS)
 *
 * @author Takuto Yanagida
 * @version 2021-02-08
 */

import { acorn } from '../../lib/parser.js';
import { buildCommonAnalysis } from './common-analysis.js';
import { analyzeReferences } from './scope-analysis.js';

'use strict';

export function analyze(code) {
	function walk(node, visitors, base, state, override) {
		if (!base) {
			base = acorn.walk.base;
		}
		(function c(node, st, override) {
			var type = override || node.type, found = visitors[type];
			if (found) { found(node, st); }
			base[type](node, st, c);
		})(node, state, override);
		return visitors;
	}
	const PARSE_OPTION = { locations: true, ecmaVersion: 'latest' };

	let ast;
	let success = true;
	try {
		ast = acorn.parse(code, PARSE_OPTION);
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error;
		ast = acorn.loose.parse(code, PARSE_OPTION);
		success = false;
	}
	return walk(ast, createVisitor()).get(code, ast, success);
}

// -----------------------------------------------------------------------------

function createVisitor() {
	const FE      = 'FunctionExpression';
	const AFE     = 'ArrowFunctionExpression';
	const CE      = 'ClassExpression';
	const ME      = 'MemberExpression';
	const IF_STMT = 'IfStatement';
	const ID      = 'Identifier';

	const fnLocs    = [];
	const classLocs = [];
	const ifLocs    = [];
	const forLocs   = [];
	const fnNames   = [];
	const ifNodes   = [];
	const varLocs   = [];
	const letLocs   = [];
	const constLocs = [];

	return {
		ClassDeclaration: (node, state, c) => {
			fnNames.push(node.id?.name);
			classLocs.push([node, node]);
		},
		ClassExpression: (node, state, c) => {
			classLocs.push([node, node]);
		},
		VariableDeclaration: (node, state, c) => {  // const f = function () {...};
			for (let d of node.declarations) {
				if (d.init !== null && (d.init.type === FE || d.init.type === AFE)) {
					if (node.loc.start.line === d.loc.start.line) {
						fnLocs.push([node, d]);  // for considering the column of 'const'
					} else {
						fnLocs.push([d, d]);
					}
				}
				if (d.init !== null && (d.init.type === FE || d.init.type === AFE || d.init.type === CE)) {
					fnNames.push(d.id?.name);
				}
			}
			switch (node.kind) {
				case 'var':
					for (let d of node.declarations) varLocs.push([d.id, d.id]);
					break;
				case 'let':
					for (let d of node.declarations) letLocs.push([d.id, d.id]);
					break;
				case 'const':
					for (let d of node.declarations) constLocs.push([d.id, d.id]);
					break;
			}
		},
		FunctionDeclaration: (node, state, c) => {  // function f () {...}
			fnLocs.push([node, node]);
			fnNames.push(node.id?.name);
		},
		AssignmentExpression: (node, state, c) => {  // f = function () {...};
			const left = node.left, right = node.right;
			if ((left.type === ID || left.type === ME) && (right.type === FE || right.type === AFE)) {
				fnLocs.push([node, node]);
			}
			if (left.type === ID && (right.type === FE || right.type === AFE || right.type === CE)) {
				fnNames.push(left.name);
			}
		},
		MethodDefinition: (node, state, c) => {
			fnLocs.push([node, node]);
		},
		IfStatement: (node, state, c) => {
			if (ifNodes[node.start] === true) return;
			const p = [node, node];
			let n = node;
			while (true) {
				if (n.alternate) {
					p.push(n.alternate);
				}
				if (n.alternate && n.alternate.type === IF_STMT) {
					n = n.alternate;
					p[1] = n;
					ifNodes[n.start] = true;
				} else {
					break;
				}
			}
			ifLocs.push(p);
		},
		ForStatement: (node, state, c) => {
			forLocs.push([node, node]);
		},
		get: (source, ast, success) => {
			const fnStarts = [];
			let lastEnd = -1;
			for (const [bgn, end] of fnLocs) {
				if (lastEnd < end.loc.end.line - 1) {
					fnStarts.push(bgn.loc.start.line - 1);
					lastEnd = end.loc.end.line - 1;
				}
			}
			const ranges = { fnLocs, classLocs, ifLocs, forLocs, varLocs, letLocs, constLocs };
			const mapRanges = (start, end) => Object.fromEntries(Object.entries(ranges).map(([kind, entries]) => [
				kind, entries.map(([from, to, ...branches]) => [start(from), end(to), ...branches.map(start)]),
			]));
			const legacy = mapRanges(node => node.loc.start, node => node.loc.end);
			const offsets = mapRanges(node => node.start, node => node.end);
			const result = { ...legacy, fnStarts, fnNames: fnNames.filter(Boolean), success };
			return { ...result, commonAnalysis: buildCommonAnalysis(result, source, offsets, analyzeReferences(ast)) };
		}
	};
}
