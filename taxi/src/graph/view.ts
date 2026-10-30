import { PackedGraphData, PackedWayGraph } from './packed';
const views = new WeakMap<PackedGraphData, PackedWayGraph>();
export function preparedGraphView(packet: PackedGraphData) { let view = views.get(packet); if (!view) {
    view = new PackedWayGraph(packet);
    views.set(packet, view);
} return view; }
