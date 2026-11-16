/**
 * A layered layout for a project's task dependencies (#2625), drawn in the
 * browser. Each task sits one layer right of the furthest task it waits on, so
 * a sequence reads left to right; within a layer, tasks sit near what they wait
 * on. Client-safe: no server imports. Cycles cannot reach here; the service
 * refuses them on write.
 */

export interface GraphNode {
	id: string;
	label: string;
	done: boolean;
}

/** `taskId` waits on `dependsOnId`. */
export interface GraphEdge {
	taskId: string;
	dependsOnId: string;
}

export interface PlacedNode extends GraphNode {
	layer: number;
	row: number;
}

export interface GraphLayout {
	nodes: PlacedNode[];
	layers: number;
	rows: number;
}

/** Only tasks on an edge are drawn: a task with no dependencies is a dot, not a graph. */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): GraphLayout {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const live = edges.filter((e) => byId.has(e.taskId) && byId.has(e.dependsOnId));
	const waitsOn = new Map<string, string[]>();
	const onEdge = new Set<string>();
	for (const e of live) {
		waitsOn.set(e.taskId, [...(waitsOn.get(e.taskId) ?? []), e.dependsOnId]);
		onEdge.add(e.taskId);
		onEdge.add(e.dependsOnId);
	}

	// Longest path from a task that waits on nothing, memoised. The guard set is
	// belt and braces: a loop the database somehow held would end, not hang.
	const layerOf = new Map<string, number>();
	const visiting = new Set<string>();
	const layer = (id: string): number => {
		const known = layerOf.get(id);
		if (known !== undefined) return known;
		if (visiting.has(id)) return 0;
		visiting.add(id);
		const deps = waitsOn.get(id) ?? [];
		const value = deps.length === 0 ? 0 : 1 + Math.max(...deps.map(layer));
		visiting.delete(id);
		layerOf.set(id, value);
		return value;
	};

	const ids = [...onEdge].sort((a, b) => byId.get(a)!.label.localeCompare(byId.get(b)!.label));
	const columns: string[][] = [];
	for (const id of ids) (columns[layer(id)] ??= []).push(id);

	// Left to right, each task takes the mean row of what it waits on, so lines
	// run as flat as they can; ties keep the alphabetical order.
	const rowOf = new Map<string, number>();
	columns.forEach((column, i) => {
		const keyed = column.map((id, at) => {
			const deps = (waitsOn.get(id) ?? []).filter((d) => rowOf.has(d));
			const centre =
				i === 0 || deps.length === 0
					? at
					: deps.reduce((sum, d) => sum + rowOf.get(d)!, 0) / deps.length;
			return { id, centre, at };
		});
		keyed.sort((a, b) => a.centre - b.centre || a.at - b.at);
		keyed.forEach(({ id }, row) => rowOf.set(id, row));
	});

	return {
		nodes: ids.map((id) => ({ ...byId.get(id)!, layer: layerOf.get(id)!, row: rowOf.get(id)! })),
		layers: columns.length,
		rows: Math.max(0, ...columns.map((c) => c.length))
	};
}
