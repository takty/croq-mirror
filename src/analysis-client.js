export class AnalysisClient {

	constructor(worker) {
		this.worker  = worker;
		this.pending = new Map();
		this.nextId  = 0;
		this.failure = null;
		this.ready = new Promise((resolve, reject) => {
			this.rejectReady = reject;
			this.timeout = setTimeout(() => this.fail(new Error('Analysis worker initialization timed out')), 15000);
			worker.onmessage = ({ data }) => {
				if (data.ready) {
					clearTimeout(this.timeout);
					resolve();
					return;
				}
				const pending = this.pending.get(data.id);
				if (!pending) return;
				this.pending.delete(data.id);
				if (data.error) pending.reject(new Error(data.error));
				else pending.resolve(data.result);
			};
			worker.onerror = event => this.fail(new Error(event.message || 'Analysis worker failed'));
			worker.onmessageerror = () => this.fail(new Error('Invalid analysis worker message'));
		});
	}

	request(text, version) {
		if (this.failure) return Promise.reject(this.failure);
		const id = ++this.nextId;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			try {
				this.worker.postMessage({ id, text, version });
			} catch (error) {
				this.pending.delete(id);
				reject(error);
			}
		});
	}

	fail(error) {
		if (this.failure) return;
		this.failure = error;
		clearTimeout(this.timeout);
		this.rejectReady(error);
		for (const p of this.pending.values()) p.reject(error);
		this.pending.clear();
		this.worker.terminate();
	}
	destroy() {
		this.fail(new Error('Editor destroyed'));
	}
}
