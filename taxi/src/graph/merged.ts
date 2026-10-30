import { IWayGraph, IWayGraphNode, TWayGraphEdge, WayGraph } from '../tools/maps';
/** Multiple area packets share a graph interface without rebuilding their node objects. */
export class MergedWayGraph extends WayGraph {
    private readonly joined = new Map<number, IWayGraphNode>();
    constructor(private readonly graphs: IWayGraph[]) { super(); }
    getNode(id: number): IWayGraphNode | undefined {
        if (this.joined.has(id))
            return this.joined.get(id);
        const parts = this.graphs.map(graph => graph.getNode(id)).filter((node): node is IWayGraphNode => Boolean(node));
        if (!parts.length)
            return undefined;
        const owner = this;
        const node: IWayGraphNode = {
            id, latitude: parts[parts.length - 1].latitude, longitude: parts[parts.length - 1].longitude,
            edges: { [Symbol.iterator]: function* () { for (const part of parts)
                    for (const [target, weight, way] of part.edges)
                        yield [owner.getNode(target.id)!, weight, way] as TWayGraphEdge; } },
            isTurnAllowed: (from, to) => parts.every(part => part.isTurnAllowed(from, to)),
        };
        this.joined.set(id, node);
        return node;
    }
    *[Symbol.iterator](): IterableIterator<IWayGraphNode> { const seen = new Set<number>(); for (const graph of this.graphs)
        for (const node of graph)
            if (!seen.has(node.id)) {
                seen.add(node.id);
                yield this.getNode(node.id)!;
            } }
    findClosestNode(latitude: number, longitude: number): [
        IWayGraphNode | undefined,
        number
    ] {
        let node: IWayGraphNode | undefined, distance = Infinity;
        for (const graph of this.graphs) {
            const candidate = graph.findClosestNode(latitude, longitude);
            if (candidate[0] && candidate[1] < distance) {
                node = this.getNode(candidate[0].id);
                distance = candidate[1];
            }
        }
        return [node, distance];
    }
}
