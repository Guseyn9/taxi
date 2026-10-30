import type { IArea } from '../types/types';
import { WayGraph, IWayGraphNode, TWayGraphEdge, calculateDistance } from '../tools/maps';
export const GRAPH_SCHEMA = 1;
export interface PackedGraphData {
    schema: number;
    areaId: number;
    ids: Float64Array;
    coordinates: Float64Array;
    sorted: Uint32Array;
    offsets: Uint32Array;
    targets: Uint32Array;
    weights: Float64Array;
    ways: Float64Array;
    restrictionOffsets: Uint32Array;
    restrictionFrom: Float64Array;
    restrictionTo: Float64Array;
    gridKeys: Uint32Array;
    gridOffsets: Uint32Array;
    gridNodes: Uint32Array;
}
const cellKey = (lat: number, lng: number) => (lat + 9000) * 36001 + lng + 18000;
function search(values: ArrayLike<number>, value: number, by?: (index: number) => number): number {
    let left = 0, right = values.length - 1;
    while (left <= right) {
        const middle = (left + right) >>> 1, current = by ? by(middle) : values[middle];
        if (current === value)
            return middle;
        if (current < value)
            left = middle + 1;
        else
            right = middle - 1;
    }
    return -1;
}
/** Called in the worker only. Retains the original one-way and turn-restriction implementation. */
export function packArea(area: IArea): PackedGraphData {
    const graph = new WayGraph(undefined, area), nodes = Array.from(graph), index = new Map(nodes.map((node, i) => [node.id, i]));
    const n = nodes.length, ids = new Float64Array(n), coordinates = new Float64Array(n * 2), offsets = new Uint32Array(n + 1), restrictionOffsets = new Uint32Array(n + 1);
    const targets: number[] = [], weights: number[] = [], ways: number[] = [], restrictionFrom: number[] = [], restrictionTo: number[] = [];
    const restrictions = new Map(area.nodes.map(node => [node.id, node.turnRestrictions || []]));
    const grid = new Map<number, number[]>();
    nodes.forEach((node, i) => {
        ids[i] = node.id;
        coordinates[i * 2] = node.latitude;
        coordinates[i * 2 + 1] = node.longitude;
        offsets[i] = targets.length;
        for (const [target, weight, way] of node.edges) {
            targets.push(index.get(target.id)!);
            weights.push(weight);
            ways.push(way);
        }
        restrictionOffsets[i] = restrictionFrom.length;
        for (const item of restrictions.get(node.id) || []) {
            restrictionFrom.push(item.fromWayId);
            restrictionTo.push(item.toWayId);
        }
        const key = cellKey(Math.floor(node.latitude * 100), Math.floor(node.longitude * 100));
        if (!grid.has(key))
            grid.set(key, []);
        grid.get(key)!.push(i);
    });
    offsets[n] = targets.length;
    restrictionOffsets[n] = restrictionFrom.length;
    const keys = Array.from(grid.keys()).sort((a, b) => a - b), gridOffsets = new Uint32Array(keys.length + 1), gridNodes: number[] = [];
    keys.forEach((key, i) => { gridOffsets[i] = gridNodes.length; for (const node of grid.get(key)!)
        gridNodes.push(node); });
    gridOffsets[keys.length] = gridNodes.length;
    return { schema: GRAPH_SCHEMA, areaId: area.id, ids, coordinates, sorted: new Uint32Array(nodes.map((_, i) => i).sort((a, b) => ids[a] - ids[b])), offsets, targets: new Uint32Array(targets), weights: new Float64Array(weights), ways: new Float64Array(ways), restrictionOffsets, restrictionFrom: new Float64Array(restrictionFrom), restrictionTo: new Float64Array(restrictionTo), gridKeys: new Uint32Array(keys), gridOffsets, gridNodes: new Uint32Array(gridNodes) };
}
/** Persistent cache is untrusted: validate its whole representation in the worker before use. */
export function validatePacked(data: PackedGraphData): boolean {
    try {
        if (!data || data.schema !== GRAPH_SCHEMA || !Number.isSafeInteger(data.areaId))
            return false;
        const { ids, coordinates, sorted, offsets, targets, weights, ways, restrictionOffsets, restrictionFrom, restrictionTo, gridKeys, gridOffsets, gridNodes } = data, n = ids.length;
        if (!(ids instanceof Float64Array) || !n || n > 2000000 || !(coordinates instanceof Float64Array) || coordinates.length !== n * 2 || !(sorted instanceof Uint32Array) || sorted.length !== n)
            return false;
        if (!(offsets instanceof Uint32Array) || offsets.length !== n + 1 || offsets[0] !== 0 || offsets[n] !== targets.length || !(targets instanceof Uint32Array) || !(weights instanceof Float64Array) || !(ways instanceof Float64Array) || targets.length !== weights.length || targets.length !== ways.length)
            return false;
        if (!(restrictionOffsets instanceof Uint32Array) || restrictionOffsets.length !== n + 1 || restrictionOffsets[0] !== 0 || !(restrictionFrom instanceof Float64Array) || !(restrictionTo instanceof Float64Array) || restrictionFrom.length !== restrictionTo.length || restrictionOffsets[n] !== restrictionFrom.length)
            return false;
        if (!(gridKeys instanceof Uint32Array) || !(gridOffsets instanceof Uint32Array) || gridOffsets.length !== gridKeys.length + 1 || gridOffsets[0] !== 0 || gridOffsets[gridKeys.length] !== n || !(gridNodes instanceof Uint32Array) || gridNodes.length !== n)
            return false;
        const seen = new Uint8Array(n), gridSeen = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
            if (!Number.isSafeInteger(ids[i]) || !Number.isFinite(coordinates[i * 2]) || Math.abs(coordinates[i * 2]) > 90 || !Number.isFinite(coordinates[i * 2 + 1]) || Math.abs(coordinates[i * 2 + 1]) > 180 || sorted[i] >= n || seen[sorted[i]] || i > 0 && ids[sorted[i - 1]] >= ids[sorted[i]] || offsets[i] > offsets[i + 1] || restrictionOffsets[i] > restrictionOffsets[i + 1])
                return false;
            seen[sorted[i]] = 1;
        }
        for (let i = 0; i < targets.length; i++)
            if (targets[i] >= n || !Number.isFinite(weights[i]) || weights[i] < 0 || !Number.isSafeInteger(ways[i]))
                return false;
        for (let i = 0; i < restrictionFrom.length; i++)
            if (!Number.isSafeInteger(restrictionFrom[i]) || !Number.isSafeInteger(restrictionTo[i]))
                return false;
        for (let k = 0; k < gridKeys.length; k++) {
            if (k > 0 && gridKeys[k] <= gridKeys[k - 1] || gridOffsets[k] > gridOffsets[k + 1])
                return false;
            for (let j = gridOffsets[k]; j < gridOffsets[k + 1]; j++) {
                const i = gridNodes[j];
                if (i >= n || gridSeen[i] || cellKey(Math.floor(coordinates[i * 2] * 100), Math.floor(coordinates[i * 2 + 1] * 100)) !== gridKeys[k])
                    return false;
                gridSeen[i] = 1;
            }
        }
        return true;
    }
    catch {
        return false;
    }
}
export class PackedWayGraph extends WayGraph {
    private readonly wrappers = new Map<number, IWayGraphNode>();
    constructor(readonly data: PackedGraphData) { super(); }
    private nodeAt(index: number): IWayGraphNode {
        let node = this.wrappers.get(index);
        if (!node) {
            node = new PackedNode(this, index);
            this.wrappers.set(index, node);
        }
        return node;
    }
    getNode(id: number): IWayGraphNode | undefined {
        const position = search(this.data.sorted, id, i => this.data.ids[this.data.sorted[i]]);
        return position < 0 ? undefined : this.nodeAt(this.data.sorted[position]);
    }
    *[Symbol.iterator](): IterableIterator<IWayGraphNode> { for (let i = 0; i < this.data.ids.length; i++)
        yield this.nodeAt(i); }
    findClosestNode(latitude: number, longitude: number): [
        IWayGraphNode | undefined,
        number
    ] {
        if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180)
            return [undefined, Infinity];
        let best = -1, distance = this.closestNodeRadius;
        const consider = (i: number) => { const value = calculateDistance([latitude, longitude], [this.data.coordinates[i * 2], this.data.coordinates[i * 2 + 1]]); if (value < distance || best >= 0 && value === distance && i < best) {
            best = i;
            distance = value;
        } };
        const latDelta = this.closestNodeRadius / 110000, lonDelta = latDelta / Math.max(.00001, Math.cos(Math.min(89.99999, Math.abs(latitude) + latDelta) * Math.PI / 180));
        if (lonDelta > 1 || longitude - lonDelta < -180 || longitude + lonDelta > 180) {
            for (let i = 0; i < this.data.ids.length; i++)
                consider(i);
        }
        else
            for (let lat = Math.floor((latitude - latDelta) * 100); lat <= Math.floor((latitude + latDelta) * 100); lat++)
                for (let lng = Math.floor((longitude - lonDelta) * 100); lng <= Math.floor((longitude + lonDelta) * 100); lng++) {
                    const key = search(this.data.gridKeys, cellKey(lat, lng));
                    if (key < 0)
                        continue;
                    for (let j = this.data.gridOffsets[key]; j < this.data.gridOffsets[key + 1]; j++)
                        consider(this.data.gridNodes[j]);
                }
        return best < 0 ? [undefined, Infinity] : [this.nodeAt(best), distance];
    }
    /** Materialize only the handful of nodes a route visits, never all nodes at startup. */
    getNodeByIndex(index: number) { return this.nodeAt(index); }
}
class PackedNode implements IWayGraphNode {
    constructor(private readonly graph: PackedWayGraph, private readonly index: number) { }
    get id() { return this.graph.data.ids[this.index]; }
    get latitude() { return this.graph.data.coordinates[this.index * 2]; }
    get longitude() { return this.graph.data.coordinates[this.index * 2 + 1]; }
    get edges(): Iterable<Readonly<TWayGraphEdge>> {
        const data = this.graph.data, index = this.index, graph = this.graph;
        return { [Symbol.iterator]: function* () { for (let i = data.offsets[index]; i < data.offsets[index + 1]; i++)
                yield [graph.getNodeByIndex(data.targets[i]), data.weights[i], data.ways[i]] as TWayGraphEdge; } };
    }
    isTurnAllowed(from: number, to: number) { const data = this.graph.data; for (let i = data.restrictionOffsets[this.index]; i < data.restrictionOffsets[this.index + 1]; i++)
        if (data.restrictionFrom[i] === from && data.restrictionTo[i] === to)
            return false; return true; }
}
