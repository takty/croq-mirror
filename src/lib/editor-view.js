/**
 * Editor: Editor Component Wrapper for CodeMirror
 *
 * @author Takuto Yanagida
 * @version 2021-02-24
 */

import { CodeMirror, beautify as js_beautify, defaultDefinitions } from './vendor.js';

'use strict';

export class Editor {

	constructor(owner, domElm) {
		this._owner           = owner;
		this._codeStructure   = {};
		this._ternServer      = null;
		this._defaultDefJsons = [];
		this._formatOpts      = {};

		this._timers     = new Set();
		this._abort      = new AbortController();
		this._destroyed  = false;
		this._autoFormat = true;
		this._completion = true;

		this._isEnabled                   = true;
		this._isReadOnly                  = false;
		this._isFunctionLineNumberEnabled = false;
		this._isLineSelModeEnabled        = false;
		this._isAutoIndentEnabled         = false;

		this._lastLineNumWidth = 0;
		this._lastLineNumChars = 0;

		this._comp = new CodeMirror(domElm, this.codeMirrorOptions());
		this._comp.getMode().closeBrackets = '()[]\'\'""``';  // Must Overwrite JavaScript Mode Here!
		this._elem = this._comp.getWrapperElement();
		this._comp.setOption('hintOptions', { container: domElm });
		this._elem.style.userSelect = 'none';
		this._elem.style.WebkitUserSelect = 'none';

		this.initCaret();
		this.initHideMouseCursorWhenEditing();
		this.initWheelZoom();
		this.initGutterSelection();
		this.initCodeStructureView();
		this.initAutoFormat();

		this.constructorSecond();
	}

	constructorSecond() {
		this.rulerEnabled(true);
		this._annotateScrollbar = this._comp.annotateScrollbar('cm-annotate-scrollbar-function-marker');
		this.functionLineNumberEnabled(false);

		this._defaultDefJsons = structuredClone(defaultDefinitions);
		this.initAutoComplete();

		this._comp.on('renderLine', (cm, line, elt) => {
			if (!cm.getOption('lineWrapping')) return;
			const charWidth = this._comp.defaultCharWidth(), basePadding = 2;
			const off = CodeMirror.countColumn(line.text, null, cm.getOption('tabSize')) * charWidth;
			elt.style.textIndent = '-' + off + 'px';
			elt.style.paddingLeft = (basePadding + off) + 'px';
		});
	}

	codeMirrorOptions() {
		return {
			mode: 'javascript',
			autoCloseBrackets: true,
			lineNumbers: true,
			indentUnit: 4,
			indentWithTabs: true,
			gutters: ['CodeMirror-lint-markers', 'CodeMirror-function-linenumbers', 'CodeMirror-linenumbers'],
			extraKeys: {
				'Ctrl-\\'     : (cm) => this._complete(cm, this._ternServer),
				'Shift-Ctrl-R': false,
				'Shift-Tab'   : 'indentLess',
				'F3'          : 'findPersistent',
				'Shift-F3'    : 'findPersistentPrev',
				'Ctrl-G'      : 'findPersistent',
				'Ctrl-Shift-G': 'findPersistentPrev',
				'Cmd-G'       : 'findPersistent',
				'Cmd-Shift-G' : 'findPersistentPrev',
			},
			highlightSelectionMatches: true,
			matchBrackets: true,
			showCursorWhenSelecting: true,
			dragDrop: true,
			cursorBlinkRate: 530,
			cursorScrollMargin: 32,
			styleActiveLine: true,
			theme: 'laccolla',
			inputStyle: 'textarea',
			lineWiseCopyCut: false,
			lint: false,
			styleSelectedText: true,
			specialChars: / /,
			specialCharPlaceholder: (c) => {
				const e = document.createElement('span');
				e.textContent = '_';
				e.className = 'cm-space';
				return e;
			},
			historyEventDelay: 200,
			phrases: this._owner._res.editorPhrase,
		};
	}

	initCaret() {
		const cursor = this._elem.querySelector('.CodeMirror-cursor');
		if (!cursor) return;
		this._listen(window, 'blur', () => {
			cursor.style.visibility = 'hidden';  // hide cursor on mac
			this._comp.setOption('cursorBlinkRate', -1);
		});
		this._listen(window, 'focus', () => {
			cursor.style.visibility = '';
			this._comp.setOption('cursorBlinkRate', 530);
		});
		this._comp.on('cursorActivity', () => {
			cursor.style.visibility = '';
		});
	}

	initHideMouseCursorWhenEditing() {
		let pointerShown = true, to;
		const lines = this._elem.querySelector('.CodeMirror-lines');
		const showPointer = () => {
			if (!pointerShown) lines.style.cursor = 'auto';
			pointerShown = true;
		};
		this._comp.on('cursorActivity', () => {
			this._cancelLater(to);
			if (pointerShown) lines.style.cursor = 'none';
			pointerShown = false;
			to = this._later(showPointer, 500);
		});
		this._listen(document, 'mousemove', showPointer);
	}

	initWheelZoom() {
		this._listen(this._elem, 'wheel', (e) => {
			if (!this._isEnabled || !e.ctrlKey) return;
			this._owner.executeCommand(e.deltaY > 0 ? 'fontSizeMinus' : 'fontSizePlus');
		}, { passive: true });
	}

	// -------------------------------------------------------------------------

	initCodeStructureView() {
		this._canvas = document.createElement('canvas');
		this._canvas.classList.add('code-structure-view');

		const parent = this._elem.getElementsByClassName('CodeMirror-sizer')[0];
		parent.insertBefore(this._canvas, parent.firstElementChild);

		this._setCanvasSize();
		let st = null;

		this._comp.on('refresh', () => {
			if (this._setCanvasSize()) {
				if (st) this._cancelLater(st);
				st = this._later(() => { this._updateCodeStructureView(); }, 200);
			}
		});
		this._comp.on('change', () => {
			if (st) this._cancelLater(st);
			this._clearCanvas();
		});
	}

	_setCanvasSize() {
		const c = this._canvas;
		const cw = this._comp.defaultCharWidth();
		const w = Math.min(c.parentElement.clientWidth, cw * 64) | 0;
		const h = c.parentElement.clientHeight;
		if (c.width !== w || c.height !== h) {
			c.style.opacity = 0;
			this._later(() => {
				c.width  = w;
				c.height = h;
				c.getContext('2d').clearRect(0, 0, w, h);
			}, 200);
			return true;
		}
		return false;
	}

	_clearCanvas() {
		const c = this._canvas;
		c.style.opacity = 0;
		this._later(() => { c.getContext('2d').clearRect(0, 0, c.width, c.height); }, 200);
	}

	_updateCodeStructureView() {
		const cs = this._codeStructure;
		if (this._destroyed) return;
		const ctx = this._canvas.getContext('2d');

		ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

		if (cs.fnLocs) {
			ctx.fillStyle = 'hsla(40, 100%, 50%, 0.15)';
			for (let loc of cs.fnLocs) this._drawSyntaxRange(ctx, loc);
		}
		if (cs.ifLocs) {
			ctx.fillStyle = 'hsla(150, 100%, 35%, 0.15)';
			for (let loc of cs.ifLocs) this._drawSyntaxRange(ctx, loc);
		}
		if (cs.forLocs) {
			ctx.fillStyle = 'hsla(190, 90%, 50%, 0.20)';
			for (let loc of cs.forLocs) this._drawSyntaxRange(ctx, loc);
		}
		if (cs.varLocs) {
			ctx.fillStyle = 'hsla(0, 0%, 97%, 1)';
			ctx.strokeStyle = 'hsla(0, 0%, 69%, 0.75)';
			for (let loc of cs.varLocs) this._drawSyntaxToken(ctx, loc);
		}
		if (cs.letLocs) {
			ctx.fillStyle = 'hsla(205, 100%, 97%, 1)';
			ctx.strokeStyle = 'hsla(205, 100%, 52%, 0.75)';
			for (let loc of cs.letLocs) this._drawSyntaxToken(ctx, loc);
		}
		if (cs.constLocs) {
			ctx.fillStyle = 'hsla(240, 75%, 97%, 1)';
			ctx.strokeStyle = 'hsla(240, 75%, 65%, 0.75)';
			for (let loc of cs.constLocs) this._drawSyntaxToken(ctx, loc);
		}
		this._canvas.style.opacity = 1;
	}

	_drawSyntaxRange(ctx, pos) {
		const bgn = pos[0], end = pos[1];
		const scc = this._comp.charCoords({ line: bgn.line - 1, ch: bgn.column }, 'local');
		const ecc = this._comp.charCoords({ line: end.line - 1, ch: end.column }, 'local');
		scc.left += 4;

		const lh = this._comp.defaultTextHeight();
		const tcc = this._comp.charCoords({ line: bgn.line - 1, ch: bgn.column + 3 }, 'local');
		const iw = tcc.right - scc.left - 3;
		const w = ctx.canvas.width / 2;

		this._fillLeftRoundedRect(ctx, scc.left, scc.top + 3, iw, ecc.top - scc.top + lh - 6, lh / 1.5);
		this._fillRightRoundedRect(ctx, scc.left + iw, scc.top + 3, w, lh - 6, lh / 1.5);
		if (bgn.line !== end.line) {
			this._fillRightRoundedRect(ctx, scc.left + iw, ecc.top + 3, w, lh - 6, lh / 1.5);
		}

		const elsecc = this._comp.charCoords({ line: bgn.line - 1, ch: bgn.column + 4 }, 'local');
		const elsew = elsecc.right - scc.left - 4;

		for (let i = 2; i < pos.length; i += 1) {
			const icc = this._comp.charCoords({ line: pos[i].line - 1, ch: pos[i].column }, 'local');
			this._fillRightRoundedRect(ctx, scc.left + iw, icc.top + 3, elsew, lh - 6, lh / 1.5);
		}
	}

	_drawSyntaxToken(ctx, pos) {
		const bgn = pos[0], end = pos[1];
		const scc = this._comp.charCoords({ line: bgn.line - 1, ch: bgn.column }, 'local');
		const ecc = this._comp.charCoords({ line: end.line - 1, ch: end.column }, 'local');
		scc.left -= 2;

		const th = this._comp.defaultTextHeight();
		const cw = this._comp.defaultCharWidth();
		const dh = th - cw * 1.9;
		const w = ecc.left - scc.left + 4;
		const h = ecc.top - scc.top + th - dh;

		this._fillRightRoundedRect(ctx, scc.left, scc.top + dh / 2, w, h, th / 4);
		ctx.lineWidth = 0.5;
		ctx.stroke();
		ctx.lineWidth = cw * 0.35;
		ctx.beginPath();
		ctx.moveTo(scc.left - cw * 0.35 * 0.5, scc.top + dh / 2     - 0.5);
		ctx.lineTo(scc.left - cw * 0.35 * 0.5, scc.top + dh / 2 + h + 0.5)
		ctx.stroke();
	}

	_fillLeftRoundedRect(ctx, x, y, width, height, radius) {
		if (height < radius * 2) radius = height / 2;
		ctx.beginPath();
		ctx.moveTo(x + radius, y);
		ctx.lineTo(x + width, y);
		ctx.lineTo(x + width, y + height);
		ctx.lineTo(x + radius, y + height);
		ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
		ctx.lineTo(x, y + radius);
		ctx.quadraticCurveTo(x, y, x + radius, y);
		ctx.fill();
	}

	_fillRightRoundedRect(ctx, x, y, width, height, radius) {
		if (height < radius * 2) radius = height / 2;
		ctx.beginPath();
		ctx.moveTo(x, y);
		ctx.lineTo(x + width - radius, y);
		ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
		ctx.lineTo(x + width, y + height - radius);
		ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
		ctx.lineTo(x, y + height);
		ctx.lineTo(x, y);
		ctx.fill();
	}

	// -------------------------------------------------------------------------

	initGutterSelection() {
		const doc = this._comp.getDoc();
		const guts = this._elem.querySelector('.CodeMirror-gutters');
		let downLine = -1, fromLine = -1, dragging = false;

		this._comp.on('gutterClick', (cm, line, gut, e) => {
			if (e.button !== 0) return;
			if (!isGutter(e)) {
				downLine = -1;
				fromLine = -1;
				this.setLineSelectionMode(false);
				doc.setCursor(getLine(e), 0);
			}
		});
		this._listen(this._elem, 'mousedown', (e) => {
			if (e.button !== 0) return;
			if (isGutter(e)) {
				downLine = getLine(e);
				dragging = true;

				if (e.shiftKey) {
					if (fromLine === -1) fromLine = this._comp.getCursor().line;
					this._select(fromLine, downLine);
					this.setLineSelectionMode(false);
				} else if (this._isLineSelModeEnabled) {
					this._select(fromLine, downLine);
				} else {
					fromLine = downLine;
					this._select(fromLine);
				}
			}
		});
		this._listen(this._elem, 'mousemove', (e) => {
			if (!dragging) return;
			if (e.buttons === 0) {
				dragging = false;
			} else {
				this._select(fromLine, getLine(e));
			}
		});
		this._listen(this._elem, 'mouseup', (e) => {
			if (dragging && isGutter(e)) {
				if (e.shiftKey) {
				} else if (this._isLineSelModeEnabled) {
				} else {
					if (getLine(e) === downLine) {
						this.setLineSelectionMode(true);
						fromLine = downLine;
					}
				}
			}
			dragging = false;
		});
		this._comp.on('cursorActivity', () => {
			if (doc.getSelection() === '') {
				this.setLineSelectionMode(false);
			}
		});
		const isGutter = (e) => {
			const s = window.getComputedStyle(guts);
			return e.clientX <= guts.getBoundingClientRect().right - parseInt(s.borderRightWidth) - 1;
		};
		const getLine = (e) => {
			const { line } = this._comp.coordsChar({ left: e.clientX, top: e.clientY });
			return line;
		};
		this._listen(window, 'blur', () => {
			this.setLineSelectionMode(false);
		});
	}

	setLineSelectionMode(enabled) {
		if (enabled) {
			this._isLineSelModeEnabled = true;
			this._elem.classList.add('line-selection-mode');
		} else {
			this._isLineSelModeEnabled = false;
			this._elem.classList.remove('line-selection-mode');
		}
	}

	_select(fromLine, toLine = false) {
		const doc = this._comp.getDoc();
		if (toLine === false) {
			doc.setCursor(fromLine, 0);
			doc.setSelection({ line: fromLine, ch: 0 }, this._getTailPos(doc, fromLine));
		} else {
			if (fromLine <= toLine) {
				doc.setSelection({ line: fromLine, ch: 0 }, this._getTailPos(doc, toLine));
			} else {
				doc.setSelection(this._getTailPos(doc, fromLine), { line: toLine, ch: 0 });
			}
		}
	}

	_getTailPos(doc, line) {
		if (doc.lineCount() - 1 === line) {
			return { line: line, ch: doc.getLine(line).length };
		} else {
			return { line: line + 1, ch: 0 };
		}
	}

	// -------------------------------------------------------------------------

	initAutoComplete() {
		this._isDotTyped = false;
		this._ternServer = new CodeMirror.TernServer({ defs: this._defaultDefJsons });
		this._comp.on('cursorActivity', (cm) => { if (this._completion && this._isEnabled && !this._isReadOnly) this._ternServer.updateArgHints(cm); });

		const ek = this._comp.getOption('extraKeys');
		ek['Ctrl-Tab'] = (cm) => { this._complete(cm, this._ternServer); };
		this._comp.setOption('extraKeys', ek);

		const reg = /\w|\./;
		let autoComp = null;
		this._comp.on('keypress', (cm, e) => {
			if (!this._completion || e.isComposing) return;
			if (reg.test(e.key)) {
				if (e.key === '.') this._isDotTyped = true;
				if (autoComp) this._cancelLater(autoComp);
				autoComp = this._later(() => {
					const elm = this._elem.closest('.croq-mirror').querySelector('.CodeMirror-hints');
					if (!elm && e.key !== '.') this._isDotTyped = false;
					this._complete(cm, this._ternServer);
				}, 500);
			} else {
				if (!autoComp) return;
				this._cancelLater(autoComp);
				autoComp = null;
			}
		});
	}

	updateAutoComplete(defs) {
		this._disposeTern();
		const ds = this._defaultDefJsons.concat(defs);
		this._ternServer = new CodeMirror.TernServer({ defs: ds });
	}

	_complete(cm, server) {
		if (!this._completion || !this._isEnabled || this._isReadOnly || !server) return;
		const fn = (cm, c) => this._hint(server, cm, c);
		fn.async = true;
		cm.showHint({ container: this._elem.closest('.croq-mirror'), hint: fn, completeSingle: false, customKeys: {
			Up      : function (cm, handle) { handle.moveFocus(-1); },
			Down    : function (cm, handle) { handle.moveFocus(1); },
			PageUp  : function (cm, handle) { handle.moveFocus(-handle.menuSize() + 1, true); },
			PageDown: function (cm, handle) { handle.moveFocus(handle.menuSize() - 1, true); },
			Home    : function (cm, handle) { handle.setFocus(0); },
			End     : function (cm, handle) { handle.setFocus(handle.length - 1); },
			Enter   : function (cm, handle) { handle.pick(); },
			Tab     : function (cm, handle) { handle.pick(); },
			Esc     : function (cm, handle) { handle.close(); }
		} });
	}

	_hint(ts, cm, c) {
		ts.request(cm, { type: 'completions', types: true, includeKeywords: true }, (error, data) => {
			if (error) { c(null); return; }
			const from = data.start, to = data.end;
			if (from.line !== to.line) { c(null); return; }
			const len = to.ch - from.ch;
			if (!this._isDotTyped && len < 3) { c(null); return; }

			const list = [];
			for (const c of data.completions) {
				let className = this._typeToIcon(c.type);
				if (data.guess) className += ' CodeMirror-Tern-guess';
				list.push({ text: c.name, displayText: c.displayName || c.name, className: className, data: c });
			}
			c({ from, to, list });
		});
	}

	_typeToIcon(type) {
		let suffix;
		if (type === '?') suffix = 'unknown';
		else if (type === 'number' || type === 'string' || type === 'bool') suffix = type;
		else if (/^fn\(/.test(type)) suffix = 'fn';
		else if (/^\[/.test(type)) suffix = 'array';
		else suffix = 'object';
		return 'CodeMirror-Tern-' + 'completion ' + 'CodeMirror-Tern-' + 'completion-' + suffix;
	}

	// -------------------------------------------------------------------------

	autoIndentEnabled(flag) {
		this._isAutoIndentEnabled = flag;
	}

	initAutoFormat() {
		const useTab = this._comp.getOption('indentWithTabs'), tabSize = this._comp.getOption('tabSize');
		this._formatOpts = Object.assign({}, this._owner._res.jsBeautifyOpt);
		Object.assign(this._formatOpts, { indent_char: (useTab ? '\t' : ' '), indent_size: (useTab ? 1 : tabSize), indent_with_tabs: useTab });

		const doc = this._comp.getDoc();
		let changedLine = -1;

		this._comp.on('change', (cm, changeObj) => {
			if (!this._autoFormat || this._formatting || ['setValue','undo','redo','load'].includes(changeObj.origin)) { changedLine = -1; return; }
			const { line } = doc.getCursor('head');
			const { text } = changeObj;
			if (1 < text.length) {
				const flc = text.length - 1;
				for (let i = 0; i < flc; i += 1) {
					this._formatLine(line - flc + i);
				}
			}
			const from = changeObj.from.line;
			if (line === from) changedLine = line;
		});
		this._comp.on('cursorActivity', () => {
			const { line } = doc.getCursor('head');
			if (this._autoFormat && !this._formatting && !doc.somethingSelected() && changedLine !== -1 && changedLine !== line) {
				this._formatLine(changedLine);
				changedLine = -1;
			}
		});
	}

	_formatLine(line) {
		if (!this._isEnabled || this._isReadOnly || this._formatting) return;
		const doc = this._comp.getDoc();

		const str = doc.getLine(line);
		if (!str) return;
		const bgn = { line: line, ch: 0 };
		const end = { line: line, ch: str.length };
		const orig = doc.getRange(bgn, end);

		const [text, doIndent] = this._doFormat(orig + '\n')
		if (text === false) return;
		if (1 < text.split('\n').length) return;
		this._formatting = true;
		try {
			this._comp.operation(() => {
				if (orig !== text) doc.replaceRange(text, bgn, end);
				if (this._codeStructure.success && doIndent) this._comp.indentLine(line);
			});
		} finally {
			this._formatting = false;
		}
	}

	_doFormat(text, force = false) {
		try {
			const indent = this._isAutoIndentEnabled ? false : text.match(/^(\s+)/);
			const commentIndent = text.match(/^(\s*\/\/)/);
			text = js_beautify(text, this._formatOpts);
			text = this._formatCommentWhitespace(text);
			if (force) return [text, true];
			if (commentIndent) {
				if (commentIndent[0].startsWith('//')) {
					text = text.replace(/^\/\//, commentIndent[0]);
				} else {
					text = text.replace(/^\s*\/\/\s*/, commentIndent[0] + ' ');
				}
				return [text, false];
			} else if (indent) {
				text = text.replace(/^\s+/, indent[0]);
				return [text, false];
			}
			return [text, true];
		} catch (e) {
			console.error(e);
		}
		return [false, false];
	}

	_formatCommentWhitespace(text) {
		const m = text.match(/\S+\s*(\/\/.+)$/);
		if (!m) return text;

		let state      = '';
		let lastIdx    = -1;
		let isLastEsc  = false;
		let slashCount = 0;

		for (let i = 0; i < text.length; i += 1) {
			const c = text[i];
			if (!isLastEsc && (c === "'" || c === '"' || c === '`')) {
				if (state === '') {
					state = c;
					slashCount = 0;
				} else if (state === c) {
					state = '';
					lastIdx = i;
				}
			} else if (state === '' && c === '/') {
				slashCount += 1;
				if (slashCount === 2) break;
			} else {
				slashCount = 0;
			}
			if (isLastEsc) isLastEsc = false;
			else if (!isLastEsc && c === '\\') isLastEsc = true;
		}
		if (state === '' && lastIdx !== -1) {
			const head = text.substring(0, lastIdx);
			const tail = text.substring(lastIdx);
			text = head + tail.replace(/(\S+)\s*\/\/\s*(.+)$/, '$1  // $2');  // Make the blank before the comment two blanks
		} else {
			text = text.replace(/(\S+)\s*\/\//m, '$1  //');  // Make the blank before the comment two blanks
		}
		return text;
	}

	// =========================================================================

	getComponent() {
		return this._comp;
	}

	refresh(updateCodeStructureView = false) {
		this._comp.refresh();
		this._lastLineNumWidth = 0;
		this._updateLineNumberGutter();
		if (updateCodeStructureView) this._updateCodeStructureView();
	}

	enabled(flag) {
		if (flag === undefined) return this._isEnabled;
		this._isEnabled = flag;
		this._comp.setOption('readOnly', flag ? this._isReadOnly : 'nocursor');

	}

	readOnly(flag) {
		if (flag === undefined) return this._comp.getOption('readOnly');
		this._isReadOnly = flag;
		this._comp.setOption('readOnly', this._isEnabled ? flag : 'nocursor');
	}

	value(content) {
		if (content === undefined) return this._comp.getValue();
		this._comp.setValue(content);
		this._comp.getDoc().clearHistory();
		this._comp.getDoc().setCursor(0, 0);
		this._codeStructure = {};
		this.refresh();
	}

	setCodeStructureData(data) {
		this._codeStructure = data;
		this._updateLineNumberGutter();
		if (this._canvas.style.opacity === '1') {  // for the first time
			this._clearCanvas();
			this._later(() => { this._updateCodeStructureView(); }, 200);
		} else {
			this._updateCodeStructureView();
		}
	}

	rulerEnabled(flag) {
		if (flag === undefined) return this._comp.getOption('rulers') !== null;
		if (flag) {
			this._comp.setOption('rulers', [...Array(3).keys()].map(i => ({ column: (i + 1) * 4, color: 'rgba(230,30,88,0.15)', lineStyle: 'dashed', width: '2px' })));
		} else {
			this._comp.setOption('rulers', null);
		}
	}

	// EDIT COMMAND ============================================================

	undo() {
		if (this._isEnabled) this._comp.execCommand('undo');
	}

	redo() {
		if (this._isEnabled) this._comp.execCommand('redo');
	}

	selectAll() {
		if (this._isEnabled) this._comp.execCommand('selectAll');
	}

	toggleComment() {
		if (this._isEnabled) this._comp.execCommand('toggleComment');
	}

	format() {
		if (!this._isEnabled) return;
		const doc = this._comp.getDoc();
		const { line, ch } = doc.getCursor('head');

		let bgn, end, curPos;
		if (doc.somethingSelected()) {
			bgn = doc.getCursor('from');
			end = doc.getCursor('to');
			curPos = Object.assign({}, end);
			if (bgn.line < end.line && end.ch === 0) end.line = Math.max(bgn.line, end.line - 1);
		} else {
			const str = doc.getLine(line);
			if (!str) return;
			curPos = { line, ch };
			bgn = { line: line, ch: 0 };
			end = { line: line, ch: str.length };
		}
		const flc = end.line - bgn.line + 1;
		for (let i = 0; i < flc; i += 1) {
			this._formatLine(bgn.line + i);
		}
		doc.setCursor(curPos);
	}

	find() {
		if (!this._isEnabled) return;
		this._comp.execCommand('findPersistent');
	}

	findNext() {
		if (!this._isEnabled) return;
		this._comp.execCommand('findPersistentNext');
	}

	replace() {
		if (!this._isEnabled) return;
		this._comp.execCommand('replace');
	}

	// VIEW COMMAND ============================================================

	lineWrapping(flag) {
		if (flag === undefined) return this._comp.getOption('lineWrapping');
		this._comp.setOption('lineWrapping', flag);
		if (flag) this._elem.classList.add('wordwrap');
		else this._elem.classList.remove('wordwrap');
	}

	fontFamily(attr) {
		if (attr === undefined) return this._elem.style.fontFamily;
		this._elem.style.fontFamily = attr;
	}

	lineHeight(attr) {
		if (attr === undefined) return this._elem.style.lineHeight;
		this._elem.style.lineHeight = attr;
	}

	fontSize(px) {
		if (px === undefined) return parseInt(this._elem.style.fontSize, 10);
		const size = Math.min(64, Math.max(10, px));
		this._elem.style.fontSize = size + 'px';
	}

	functionLineNumberEnabled(flag) {
		this._isFunctionLineNumberEnabled = flag;
		this._updateLineNumberGutter();
	}

	_updateLineNumberGutter() {
		this._comp.clearGutter('CodeMirror-function-linenumbers');
		if (this._isFunctionLineNumberEnabled) {
			this._comp.setOption('lineNumbers', false);
			this._comp.operation(() => {
				const fl = this._elem.getElementsByClassName('CodeMirror-function-linenumbers')[0];
				fl.style.width = this._updateFuncLineNoGutter();
				fl.style.display = '';
				fl.parentElement.classList.add('function-linenumbers');
			});
		} else {
			this._comp.setOption('lineNumbers', true);
			this._comp.operation(() => {
				const fl = this._elem.getElementsByClassName('CodeMirror-function-linenumbers')[0];
				fl.style.display = 'none';
				fl.parentElement.classList.remove('function-linenumbers');
			});
			this._annotateScrollbar.update([]);
		}
		this._comp.refresh();
	}

	_updateFuncLineNoGutter() {
		const lineCount = this._comp.getDoc().lineCount();
		const fnStarts  = this._codeStructure.fnStarts;

		this._lineNoByFunc = [];
		if (lineCount === 0 || !fnStarts || fnStarts.length === 0) {
			for (let i = 0; i < lineCount; i++) this._lineNoByFunc.push([0, i + 1]);
		} else {
			let fnIdx = 0, local = 1;
			for (let i = 0; i < lineCount; i += 1) {
				if (fnStarts[fnIdx] !== undefined && i === fnStarts[fnIdx]) {
					local = 1;
					fnIdx += 1;
				}
				this._lineNoByFunc.push([fnIdx, local]);
				local += 1;
			}
		}

		const as = [];
		if (fnStarts) {
			for (const fnIdx of fnStarts) {
				as.push({ from: { line: fnIdx }, to: { line: fnIdx } });
			}
		}
		this._annotateScrollbar.update(as);

		this._lineNoByFunc.forEach((e, i) => {
			const ln = document.createElement('div');
			if (e[0] !== 0 && e[1] === 1) {
				ln.textContent = e[0];
				ln.classList.add('CodeMirror-function-number');
			} else {
				ln.textContent = e[1];
				ln.classList.add('CodeMirror-function-linenumber');
			}
			ln.classList.add((e[0] % 2 === 0) ? 'CodeMirror-function-odd' : 'CodeMirror-function-even');
			this._comp.setGutterMarker(i, 'CodeMirror-function-linenumbers', ln);
		});
		return this._calcWidth(this._comp, lineCount);
	}

	_calcWidth(cm, str) {
		str = String(str);
		if (this._lastLineNumChars === str.length && this._lastLineNumWidth !== 0) {
			return this._lastLineNumWidth + 'px';
		}
		const _elt = (tag, content, className) => {
			var e = document.createElement(tag);
			if (className) e.className = className;
			e.appendChild(content);
			return e;
		};
		if (str.length === 0) str = '0';
		const display = cm.display;
		const test = display.measure.appendChild(_elt('div', _elt('div', document.createTextNode(str)), 'CodeMirror-function-linenumber CodeMirror-gutter-elt'));
		const innerW = test.firstChild.clientWidth;
		const padding = test.clientWidth - innerW;
		const lineGutterWidth = display.lineGutter ? display.lineGutter.clientWidth : 0;
		const lineNumWidth = Math.max(innerW, lineGutterWidth - padding) + 1 + padding;

		test.remove();
		this._lastLineNumChars = str.length;
		this._lastLineNumWidth = (lineNumWidth || 1);
		return this._lastLineNumWidth + 'px';
	}

	_disposeTern() {
		if (!this._ternServer) return;
		for (const name of Object.keys(this._ternServer.docs)) this._ternServer.delDoc(name);
		this._ternServer.destroy();
		this._ternServer = null;
	}

	_cancelLater(id) {
		clearTimeout(id);
		this._timers.delete(id);
	}

	_listen(target, type, listener, options = {}) {
		target.addEventListener(type, listener, { ...options, signal: this._abort.signal });
	}
	_later(fn, delay) {
		const id = setTimeout(() => {
			this._timers.delete(id);
			if (!this._destroyed) fn();
		}, delay);
		this._timers.add(id);
		return id;
	}

	destroy() {
		this._destroyed = true;
		this._abort.abort();
		for (const id of this._timers) this._cancelLater(id);
		this._timers.clear();
		this._comp.closeHint?.();
		this._comp.setOption('lint', false);
		this._annotateScrollbar?.clear();
		this._disposeTern();
		this._comp.getInputField().blur();
		this._elem.remove();
	}
};
