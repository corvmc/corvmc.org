<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * The project's tasks and what each waits on (#2625), as a layered drawing:
	 * a task sits right of what it waits on, done ones greyed. A view of the
	 * project, not a planning tool: edges are set on each task's page.
	 */
	import { resolve } from '$app/paths';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { layoutGraph } from '#lib/utils/task-graph.js';
	import { getProjectGraph } from '#lib/remote/tasks.remote.js';

	let { projectId }: { projectId: string } = $props();

	const NODE_W = 176;
	const NODE_H = 36;
	const GAP_X = 56;
	const GAP_Y = 16;
	const MAX_CHARS = 24;

	const graph = $derived(await getProjectGraph(projectId));
	const layout = $derived(layoutGraph(graph.nodes, graph.edges));
	const at = $derived(new Map(layout.nodes.map((n) => [n.id, n])));
	const width = $derived(layout.layers * (NODE_W + GAP_X) - GAP_X);
	const height = $derived(layout.rows * (NODE_H + GAP_Y) - GAP_Y);

	const x = (layer: number) => layer * (NODE_W + GAP_X);
	const y = (row: number) => row * (NODE_H + GAP_Y);
	const short = (label: string) =>
		label.length > MAX_CHARS ? `${label.slice(0, MAX_CHARS - 1)}…` : label;

	/** From the right edge of what is waited on to the left edge of the task waiting. */
	function path(taskId: string, dependsOnId: string): string | null {
		const to = at.get(taskId);
		const from = at.get(dependsOnId);
		if (!to || !from) return null;
		const x1 = x(from.layer) + NODE_W;
		const y1 = y(from.row) + NODE_H / 2;
		const x2 = x(to.layer);
		const y2 = y(to.row) + NODE_H / 2;
		const bend = (x2 - x1) / 2;
		return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
	}
</script>

{#if layout.nodes.length === 0}
	<EmptyState title={m.staff_projects_id_task_graph_empty_title()} />
{:else}
	<div class="overflow-x-auto" data-testid="task-graph">
		<svg
			{width}
			{height}
			viewBox="0 0 {width} {height}"
			role="img"
			aria-label={m.staff_projects_id_task_graph_label()}
			class="text-base-content"
		>
			<defs>
				<marker
					id="task-graph-arrow"
					viewBox="0 0 8 8"
					refX="8"
					refY="4"
					markerWidth="8"
					markerHeight="8"
					orient="auto"
				>
					<path d="M 0 0 L 8 4 L 0 8 z" class="fill-current opacity-50" />
				</marker>
			</defs>
			{#each graph.edges as e (`${e.taskId}:${e.dependsOnId}`)}
				{@const d = path(e.taskId, e.dependsOnId)}
				{#if d}
					<path
						{d}
						fill="none"
						class="stroke-current opacity-40"
						stroke-width="1.5"
						marker-end="url(#task-graph-arrow)"
						data-edge="{e.taskId}:{e.dependsOnId}"
					/>
				{/if}
			{/each}
			{#each layout.nodes as n (n.id)}
				<a href={resolve('/staff/tasks/[id]', { id: n.id })} data-node={n.id} data-done={n.done}>
					<title>{n.label}</title>
					<rect
						x={x(n.layer)}
						y={y(n.row)}
						width={NODE_W}
						height={NODE_H}
						rx="6"
						class={n.done ? 'fill-base-200 stroke-base-300' : 'fill-base-100 stroke-primary'}
						stroke-width="1.5"
					/>
					<text
						x={x(n.layer) + 10}
						y={y(n.row) + NODE_H / 2}
						dominant-baseline="central"
						class="fill-current text-sm"
						class:opacity-50={n.done}
						text-decoration={n.done ? 'line-through' : undefined}>{short(n.label)}</text
					>
				</a>
			{/each}
		</svg>
	</div>
{/if}
