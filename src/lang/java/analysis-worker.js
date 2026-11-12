import { Language, Parser } from 'web-tree-sitter';
import { analyzeJava } from './analyzer.js';

let parser;

try {
	await Parser.init({
		locateFile: () => new URL('./web-tree-sitter.wasm', import.meta.url).href,
	});
	parser = new Parser();
	parser.setLanguage(await Language.load(new URL('./tree-sitter-java.wasm', import.meta.url).href));
	self.onmessage = ({ data: { id, version, text } }) => {
		let tree;
		try {
			tree = parser.parse(text);
			const result = { version, text, ...analyzeJava(text, tree.rootNode) };
			self.postMessage({ id, result });
		} catch (error) {
			self.postMessage({ id, error: String(error.message || error) });
		} finally {
			tree?.delete();
		}
	};
	self.postMessage({ ready: true });
} catch (error) {
	self.postMessage({ error: String(error.message || error) });
}
