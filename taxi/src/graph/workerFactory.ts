export function createGraphWorker(): Worker {
    return new Worker(new URL('./roadGraph.worker.ts', import.meta.url), { name: 'taxi-road-graph', type: 'module' });
}
