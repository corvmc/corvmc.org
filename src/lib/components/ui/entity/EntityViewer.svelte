<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Panel } from '$lib/types/entity';
	import { setEntityViewer } from './context';

	/**
	 * Publishes the current viewer so entity components can derive their links.
	 *
	 * Mounted once per panel layout. It is a **separate, fully synchronous
	 * component** rather than a `setEntityViewer` call in the layout itself: the
	 * layouts `await` their layout query at the top level, and declarations after
	 * a top-level await are async-gated — the same reason `staff/bands/[id]`
	 * keeps its form in `StaffBandForm.svelte`. Context must be set during
	 * initialisation, so it has to happen somewhere nothing has awaited yet.
	 */
	let {
		panel,
		userId = null,
		isStaff = false,
		bands = [],
		children
	}: {
		panel: Panel;
		userId?: string | null;
		isStaff?: boolean;
		/** Active memberships only — `getMemberLayout` already filters them. */
		bands?: readonly { id: string }[];
		children: Snippet;
	} = $props();

	const bandIds = $derived(new Set(bands.map((b) => b.id)));

	// Getters, not a snapshot: the object identity handed to setContext never
	// changes, so the link is never broken by a reassignment, while each read
	// still sees current props. This is the documented way to pass reactive
	// primitives through context.
	setEntityViewer({
		get userId() {
			return userId;
		},
		get isStaff() {
			return isStaff;
		},
		get bandIds() {
			return bandIds;
		},
		get panel() {
			return panel;
		}
	});
</script>

{@render children()}
