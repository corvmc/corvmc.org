<script lang="ts">
	import type { Snippet } from 'svelte';
	import EntityViewer from '../src/lib/components/shared/entity/EntityViewer.svelte';
	import type { Panel } from '../src/lib/types/entity';

	/**
	 * Mirrors the `<EntityViewer>` each panel layout mounts.
	 *
	 * Entity components derive their own links from the viewer, so without this
	 * every story would render public URLs — and the whole point of the toolbars
	 * is to *see* the link change as you switch who is looking and where they
	 * are standing.
	 */
	let { children, viewer, panel }: { children: Snippet; viewer: string; panel: Panel } = $props();

	// The interesting one is `staff+band`: a staff user who is also in a band is
	// the case where "which page is canonical" actually has a wrong answer.
	const viewers: Record<
		string,
		{ userId: string | null; isStaff: boolean; bands: { id: string }[] }
	> = {
		anonymous: { userId: null, isStaff: false, bands: [] },
		member: { userId: 'user-1', isStaff: false, bands: [] },
		'band-member': { userId: 'user-1', isStaff: false, bands: [{ id: 'band-1' }] },
		staff: { userId: 'user-1', isStaff: true, bands: [] },
		'staff-and-band-member': { userId: 'user-1', isStaff: true, bands: [{ id: 'band-1' }] }
	};

	const v = $derived(viewers[viewer] ?? viewers.anonymous);
</script>

<EntityViewer {panel} userId={v.userId} isStaff={v.isStaff} bands={v.bands}>
	{@render children()}
</EntityViewer>
