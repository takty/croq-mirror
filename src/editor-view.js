/**
 * Editor: Editor Component Wrapper for CodeMirror
 *
 * @author Takuto Yanagida
 * @version 2021-02-24
 */

import { CodeMirror } from './lib/vendor.js';

'use strict';

export class Editor {

	constructor({ language, phrases, onFontSizeChange }, domElm) {
		this._language = language;
		this._onFontSizeChange = onFontSizeChange;
		this._presentation = language.presentation();

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

		this._comp = new CodeMirror(domElm, this.codeMirrorOptions(phrases));
		Object.assign(this._comp.getMode(), language.modeOptions);
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

		this._completionSession = this._language.createCompletionSession(this._comp);
		this.initAutoComplete();

		this._comp.on('renderLine', (cm, line, elt) => {
			if (!cm.getOption('lineWrapping')) return;
			const charWidth = this._comp.defaultCharWidth(), basePadding = 2;
			const off = CodeMirror.countColumn(line.text, null, cm.getOption('tabSize')) * charWidth;
			elt.style.textIndent = '-' + off + 'px';
			elt.style.paddingLeft = (basePadding + off) + 'px';
		});
	}

	codeMirrorOptions(phrases) {
		return {
			mode: this._language.mode,
			autoCloseBrackets: this._language.autoCloseBrackets,
			lineNumbers: true,
			indentUnit: 4,
			indentWithTabs: true,
			gutters: ['CodeMirror-lint-markers', 'CodeMirror-function-linenumbers', 'CodeMirror-linenumbers'],
			extraKeys: {
				'Ctrl-\\'     : () => this.complete(),
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
			matchBrackets: this._language.matchBrackets,
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
			phrases,
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
			this._onFontSizeChange(e.deltaY > 0 ? -2 : 2);
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
		if (this._destroyed) return;
		const ctx = this._canvas.getContext('2d');
		ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
		for (const decoration of this._presentation.decorations) {
			ctx.fillStyle = decoration.fill;
			if (decoration.kind === 'range') this._drawSyntaxRange(ctx, decoration);
			else if (decoration.kind === 'token') {
				ctx.strokeStyle = decoration.stroke;
				this._drawSyntaxToken(ctx, decoration);
			}
		}
		this._canvas.style.opacity = 1;
	}

	_drawSyntaxRange(ctx, { from: bgn, to: end, spineChars, branchChars, branches }) {
		const scc = this._comp.charCoords(bgn, 'local');
		const ecc = this._comp.charCoords(end, 'local');
		scc.left += 4;

		const lh = this._comp.defaultTextHeight();
		const tcc = this._comp.charCoords({ line: bgn.line, ch: bgn.ch + spineChars }, 'local');
		const iw = tcc.right - scc.left - spineChars;
		const w = ctx.canvas.width / 2;

		this._fillLeftRoundedRect(ctx, scc.left, scc.top + 3, iw, ecc.top - scc.top + lh - 6, lh / 1.5);
		this._fillRightRoundedRect(ctx, scc.left + iw, scc.top + 3, w, lh - 6, lh / 1.5);
		if (bgn.line !== end.line) {
			this._fillRightRoundedRect(ctx, scc.left + iw, ecc.top + 3, w, lh - 6, lh / 1.5);
		}

		const branchEnd = this._comp.charCoords({ line: bgn.line, ch: bgn.ch + branchChars }, 'local');
		const branchWidth = branchEnd.right - scc.left - branchChars;

		for (const branch of branches) {
			const icc = this._comp.charCoords(branch, 'local');
			this._fillRightRoundedRect(ctx, scc.left + iw, icc.top + 3, branchWidth, lh - 6, lh / 1.5);
		}
	}

	_drawSyntaxToken(ctx, { from: bgn, to: end }) {
		const scc = this._comp.charCoords(bgn, 'local');
		const ecc = this._comp.charCoords(end, 'local');
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
		this._allowShortCompletion = false;
		this._comp.on('cursorActivity', (cm) => { if (this._completion && this._isEnabled && !this._isReadOnly) this._completionSession.updateArgumentHints(); });

		const ek = this._comp.getOption('extraKeys');
		ek['Ctrl-Tab'] = () => this.complete();
		this._comp.setOption('extraKeys', ek);

		let autoComp = null;
		this._comp.on('keypress', (cm, e) => {
			if (!this._completion || e.isComposing) return;
			const trigger = this._language.completionTrigger(e.key);
			if (trigger) {
				if (trigger.allowShort) this._allowShortCompletion = true;
				if (autoComp) this._cancelLater(autoComp);
				autoComp = this._later(() => {
					const elm = this._elem.closest('.croq-mirror').querySelector('.CodeMirror-hints');
					if (!elm && !trigger.allowShort) this._allowShortCompletion = false;
					this.complete();
				}, trigger.delay);
			} else {
				if (!autoComp) return;
				this._cancelLater(autoComp);
				autoComp = null;
			}
		});
	}

	setDefinitions(defs) {
		this._completionSession.setDefinitions(defs);
	}

	complete() {
		if (!this._completion || !this._isEnabled || this._isReadOnly) return;
		const cm = this._comp;
		const fn = (_cm, callback) => this._completionSession.complete({ allowShort: this._allowShortCompletion }, callback);
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

	// -------------------------------------------------------------------------

	autoIndentEnabled(flag) {
		this._isAutoIndentEnabled = flag;
	}

	initAutoFormat() {
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

		const result = this._language.formatLine(orig + '\n', {
			autoIndent: this._isAutoIndentEnabled,
			indentWithTabs: this._comp.getOption('indentWithTabs'),
			tabSize: this._comp.getOption('tabSize'),
		});
		if (!result) return;
		const { text, indent: doIndent } = result;
		if (1 < text.split('\n').length) return;
		this._formatting = true;
		try {
			this._comp.operation(() => {
				if (orig !== text) doc.replaceRange(text, bgn, end);
				if (this._presentation.canIndent && doIndent) this._comp.indentLine(line);
			});
		} finally {
			this._formatting = false;
		}
	}

	// =========================================================================

	autoFormatEnabled(flag) { this._autoFormat = flag; }
	completionEnabled(flag) { this._completion = flag; }
	composing(flag) { this._elem.classList.toggle('ime', flag); }

	setDiagnostics(provider) {
		this._comp.setOption('lint', provider ? { selfContain: true, getAnnotations: provider } : false);
	}

	getSectionLineNumber(line) {
		let number = 0, start = 0;
		for (const boundary of this._presentation.sectionStarts) {
			if (boundary > line) break;
			number++;
			start = boundary;
		}
		return [number, line - start + 1];
	}

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
		this._presentation = this._language.presentation();
		this.refresh();
	}

	setPresentation(data = this._language.presentation()) {
		this._presentation = data;
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
		if (this._isFunctionLineNumberEnabled && this._presentation.lineNumbers !== 'absolute') {
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
		const sectionStarts = this._presentation.sectionStarts;

		this._lineNoByFunc = [];
		if (lineCount === 0 || !sectionStarts || sectionStarts.length === 0) {
			for (let i = 0; i < lineCount; i++) this._lineNoByFunc.push([0, i + 1]);
		} else {
			let fnIdx = 0, local = 1;
			for (let i = 0; i < lineCount; i += 1) {
				if (sectionStarts[fnIdx] !== undefined && i === sectionStarts[fnIdx]) {
					local = 1;
					fnIdx += 1;
				}
				this._lineNoByFunc.push([fnIdx, local]);
				local += 1;
			}
		}

		const as = [];
		if (sectionStarts) {
			for (const fnIdx of sectionStarts) {
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
		this._completionSession.destroy();
		this._comp.getInputField().blur();
		this._elem.remove();
	}
};
