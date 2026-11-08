import { indexedGraphCache } from './cache';
import { loadPreparedGraph } from './loader';
const worker = globalThis as unknown as {
    onmessage: (event: MessageEvent) => void;
    postMessage: (data: unknown, transfer?: Transferable[]) => void;
};
const cache = indexedGraphCache();
worker.onmessage = async (event) => {
    const id = event.data?.id;
    if (!Number.isSafeInteger(id))
        return;
    try {
        const result = await loadPreparedGraph(cache);
        const buffers = Object.values(result.packet).filter(ArrayBuffer.isView).map(value => (value as ArrayBufferView).buffer as ArrayBuffer);
        worker.postMessage({ id, ...result }, Array.from(new Set(buffers)));
    }
    catch (error) {
        worker.postMessage({ id, error: error instanceof Error ? error.message : 'Road graph failed' });
    }
};
