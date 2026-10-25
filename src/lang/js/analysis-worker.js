import { analyze } from './analyzer.js';
self.onmessage = ({ data: { id, version, text } }) => {
	try {
		self.postMessage({ id, result: { version, text, ...analyze(text) } });
	} catch (error) {
		self.postMessage({ id, error: String(error.message || error) });
	}
};
self.postMessage({ ready: true });
