import 'klales/klales.min.css';

// Load the distributed modules unchanged, including the analysis worker.
const { createEditor } = await import(/* @vite-ignore */ new URL('croq-mirror.min.js', document.baseURI).href);
const status = document.querySelector('#status');
const selectedLanguage = () => document.querySelector('input[name="language"]:checked').value;
const selectedCodeLanguage = () => document.querySelector('input[name="code-language"]:checked').value;
const functionLineNumbersEnabled = () => document.querySelector('input[name="line-numbers"]:checked').value === 'function';
const samples = {
	javascript: 'class Greeter {\n\tgreet(name) {\n\t\tconst message = "Hello, " + name;\n\t\tif (name) {\n\t\t\tconsole.log(message);\n\t\t}\n\t}\n}\n\nnew Greeter().greet("Croqujs");',
	java: 'class Greeter {\n\tpublic static void main(String[] args) {\n\t\tString message = "Hello, Java";\n\t\tint count = 10;\n\t\tif (count > 0) {\n\t\t\tshowMessage(message);\n\t\t}\n\t}\n\tstatic void showMessage(String message) {\n\t\tIO.println(message);\n\t}\n}',
};
let editor;
let activeCodeLanguage = selectedCodeLanguage();
try {
	const createDemoEditor = (value, codeLanguage) => createEditor(document.querySelector('#editor'), {
		language: selectedLanguage(), codeLanguage, value, fontSize: 18,
		functionLineNumbers: functionLineNumbersEnabled(),
	});
	editor = await createDemoEditor(samples[activeCodeLanguage], activeCodeLanguage);
	document.querySelector('#language').onchange = () => editor.setSettings({ language: selectedLanguage() });
	document.querySelector('#code-language').onchange = async () => {
		const nextLanguage = selectedCodeLanguage();
		if (nextLanguage === activeCodeLanguage) return;
		if (editor) {
			samples[activeCodeLanguage] = editor.getValue();
			editor.destroy();
			editor = null;
		}
		activeCodeLanguage = nextLanguage;
		try {
			editor = await createDemoEditor(samples[activeCodeLanguage], activeCodeLanguage);
			status.textContent = `Switched to ${activeCodeLanguage}.`;
		} catch (error) {
			status.textContent = error.stack || error.message;
		}
	};
	document.querySelector('#line-numbers').onchange = () => editor.setSettings({ functionLineNumbers: functionLineNumbersEnabled() });
	document.querySelector('#undo').onclick = () => editor.execute('undo');
	document.querySelector('#paste').onmousedown = event => event.preventDefault();
	document.querySelector('#paste').onclick = async () => {
		const settings = editor.getSettings();
		if (settings.disabled || settings.readOnly) {
			status.textContent = 'Paste is disabled while the editor is read-only or disabled.';
			return;
		}
		const before = editor.getValue();
		try {
			editor.execute('paste');
			await new Promise(resolve => setTimeout(resolve, 50));
			status.textContent = editor.getValue() !== before
				? 'Editor text changed after Paste.'
				: 'No text change detected. Your browser may block the Paste button. Try Ctrl+V or Command+V in the editor. Pasting identical text may also leave it unchanged.';
		} catch (error) {
			status.textContent = 'Paste failed: ' + error.message;
		}
	};
	document.querySelector('#format').onclick = () => editor.execute('format');
	document.querySelector('#analysis').onclick = async () => {
		status.textContent = JSON.stringify(await editor.analyzeNow(), null, 2);
	};
	for (const key of ['readonly', 'disabled']) document.querySelector('#' + key).onclick = () => {
		const setting = key === 'readonly' ? 'readOnly' : key;
		editor.setSettings({
			[setting]: !editor.getSettings()[setting], });
		status.textContent = JSON.stringify(editor.getState());
	};
	document.querySelector('#recreate').onclick = async () => {
		const value = editor.getValue();
		editor.destroy();
		editor = await createDemoEditor(value, activeCodeLanguage);
		status.textContent = 'Editor recreated.';
	};
	status.textContent = 'Ready. Try IME input, search, completion, and resizing.';
} catch (error) { status.textContent = error.stack; }
