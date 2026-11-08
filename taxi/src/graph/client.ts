import type { IArea } from '../types/types';
import { PackedGraphData } from './packed';
import { preparedGraphView } from './view';
import { createGraphWorker } from './workerFactory';
import type { GraphMetrics, GraphLoadResult } from './loader';
export interface PreparedArea extends IArea {
    preparedGraph: PackedGraphData;
}
export type GraphState = {
    status: 'idle' | 'loading' | 'ready' | 'error';
    metrics?: GraphMetrics;
    error?: string;
};
let state: GraphState = { status: 'idle' }, pending: Promise<PreparedArea> | undefined, loaded: PreparedArea | undefined;
const subscribers = new Set<() => void>();
export const graphState = () => state;
export const subscribeGraph = (listener: () => void) => { subscribers.add(listener); return () => { subscribers.delete(listener); }; };
const update = (next: GraphState) => { state = next; subscribers.forEach(listener => listener()); };
export function loadRoadArea(): Promise<PreparedArea> {
    if (loaded)
        return Promise.resolve(loaded);
    if (pending)
        return pending;
    update({ status: 'loading' });
    pending = new Promise<PreparedArea>((resolve, reject) => {
        if (typeof Worker === 'undefined') {
            reject(new Error('Web Worker is required for local road calculations'));
            return;
        }
        let worker: Worker;
        try {
            worker = createGraphWorker();
        }
        catch (error) {
            reject(error);
            return;
        }
        let settled = false;
        const finish = () => {
            settled = true;
            clearTimeout(timeout);
            worker.onmessage = null;
            worker.onerror = null;
            worker.onmessageerror = null;
            worker.terminate();
        };
        const fail = (error: Error) => { if (!settled) { finish(); reject(error); } };
        const timeout = setTimeout(() => fail(new Error('Road graph loading timed out')), 30000);
        worker.onmessage = (event: MessageEvent<GraphLoadResult & {
            id: number;
            error?: string;
        }>) => {
            if (settled || event.data.id !== 1)
                return;
            if (event.data.error) {
                finish();
                reject(new Error(event.data.error));
                return;
            }
            try {
                const { packet, metrics } = event.data, start = performance.now();
                preparedGraphView(packet);
                const ready: PreparedArea = { id: packet.areaId, nodes: [], ways: [], preparedGraph: packet };
                update({ status: 'ready', metrics: { ...metrics, mainAttachMs: performance.now() - start } });
                finish();
                resolve(ready);
            }
            catch (error) {
                finish();
                reject(error);
            }
        };
        worker.onerror = (event) => fail(new Error(`Road graph worker failed: ${event.message || 'load error'}`));
        worker.onmessageerror = () => fail(new Error('Invalid road graph worker message'));
        try { worker.postMessage({ id: 1 }); }
        catch (error) { fail(error instanceof Error ? error : new Error('Road graph worker message failed')); }
    }).then(value => { loaded = value; return value; }).catch(error => { update({ status: 'error', error: error instanceof Error ? error.message : 'Road graph unavailable' }); throw error; }).finally(() => { pending = undefined; });
    return pending;
}
