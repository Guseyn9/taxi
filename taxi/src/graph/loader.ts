import type { IArea } from '../types/types';
import { GRAPH_SCHEMA, packArea, validatePacked, PackedGraphData } from './packed';
import type { GraphCache } from './cache';
export interface GraphMetrics {
    source: 'network' | 'indexeddb' | 'offline-cache';
    version: string;
    nodes: number;
    edges: number;
    jsonMs: number;
    prepareMs: number;
    workerMs: number;
    packetBytes: number;
    mainAttachMs?: number;
    cacheStored?: boolean;
}
export interface GraphLoadResult {
    packet: PackedGraphData;
    metrics: GraphMetrics;
}
const MANIFEST = '/mock/road-graph-version.json', LATEST = `latest:${GRAPH_SCHEMA}`;
const key = (version: string) => `agadir:${GRAPH_SCHEMA}:${version}`;
const bytes = (packet: PackedGraphData) => Object.values(packet).reduce((sum, value) => sum + (ArrayBuffer.isView(value) ? value.byteLength : 0), 0);
export async function loadPreparedGraph(cache: GraphCache, fetcher: typeof fetch = fetch, clock: () => number = () => performance.now(), digest: (text: string) => Promise<string> = sha256): Promise<GraphLoadResult> {
    const started = clock();
    const read = async (name: string) => { try {
        return await cache.read(name);
    }
    catch {
        return undefined;
    } };
    const write = async (name: string, value: unknown) => { try {
        await cache.write(name, value);
    }
    catch { /* Fail-soft storage. */ } };
    const request = async (url: string, mode: RequestCache) => {
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
        try {
            const response = await fetcher(url, { cache: mode, signal: controller.signal, credentials: 'same-origin' });
            if (!response.ok) throw new Error(`Graph resource unavailable: ${response.status}`);
            // Keep timeout active until the body has arrived, not just headers.
            return url === MANIFEST ? await response.json() : await response.text();
        }
        finally {
            clearTimeout(timeout);
        }
    };
    let manifest: any;
    try {
        manifest = await request(MANIFEST, 'no-cache');
    }
    catch (error) {
        const previous = await read(LATEST), version = previous?.version;
        if (typeof version === 'string' && /^[a-f0-9]{64}$/.test(version)) {
            const packet = await read(key(version));
            if (validatePacked(packet))
                return { packet, metrics: { source: 'offline-cache', version, nodes: packet.ids.length, edges: packet.targets.length, jsonMs: 0, prepareMs: 0, workerMs: clock() - started, packetBytes: bytes(packet) } };
        }
        throw error;
    }
    const version = manifest?.version;
    if (manifest?.schema !== GRAPH_SCHEMA || typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version))
        throw new Error('Invalid graph manifest');
    const cached = await read(key(version));
    if (validatePacked(cached))
        return { packet: cached, metrics: { source: 'indexeddb', version, nodes: cached.ids.length, edges: cached.targets.length, jsonMs: 0, prepareMs: 0, workerMs: clock() - started, packetBytes: bytes(cached) } };
    const text: string = await request(`/mock/agadir.json?v=${version}`, 'force-cache');
    if (text.length > 64000000)
        throw new Error('Road graph too large');
    const hash = await digest(text);
    if (hash !== version)
        throw new Error('Road graph version mismatch');
    const jsonStart = clock(), area = JSON.parse(text) as IArea, jsonMs = clock() - jsonStart;
    if (!area || !Array.isArray(area.nodes) || !Array.isArray(area.ways) || area.nodes.length > 2000000)
        throw new Error('Invalid road graph data');
    const prepareStart = clock(), packet = packArea(area), prepareMs = clock() - prepareStart;
    if (!validatePacked(packet))
        throw new Error('Invalid prepared road graph');
    await write(key(version), packet);
    const stored = validatePacked(await read(key(version)));
    if (stored)
        await write(LATEST, { version });
    return { packet, metrics: { source: 'network', version, nodes: packet.ids.length, edges: packet.targets.length, jsonMs, prepareMs, workerMs: clock() - started, packetBytes: bytes(packet), cacheStored: stored } };
}
async function sha256(text: string): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(v => v.toString(16).padStart(2, '0')).join(''); }
