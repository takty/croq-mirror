import 'klales/klales.min.css';

// Load the distributed modules unchanged, including the analysis worker.
const { createEditor } = await import(/* @vite-ignore */ new URL('croq-mirror.min.js', document.baseURI).href);
const status = document.querySelector('#status');
const selectedLanguage = () => document.querySelector('input[name="language"]:checked').value;
const functionLineNumbersEnabled = () => document.querySelector('input[name="line-numbers"]:checked').value === 'function';
const sample = 'function greet(name) {\n\tconst message = "Hello, " + name;\n\tif (name) {\n\t\tconsole.log(message);\n\t}\n}\n\ngreet("Croqujs");';
let editor;
try {
	editor = await createEditor(document.querySelector('#editor'), { language: selectedLanguage(), value: sample, fontSize: 18, functionLineNumbers: functionLineNumbersEnabled() });
	document.querySelector('#language').onchange = () => editor.setSettings({ language: selectedLanguage() });
	document.querySelector('#line-numbers').onchange = () => editor.setSettings({ functionLineNumbers: functionLineNumbersEnabled() });
	document.querySelector('#undo').onclick = () => editor.execute('undo');
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
		editor = await createEditor(document.querySelector('#editor'), { language: selectedLanguage(), value, fontSize: 18, functionLineNumbers: functionLineNumbersEnabled() });
		status.textContent = 'Editor recreated.';
	};
	status.textContent = 'Ready. Try IME input, search, completion, and resizing.';
} catch (error) { status.textContent = error.stack; }
