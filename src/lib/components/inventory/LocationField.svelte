<script lang="ts">
	import type { RemoteFormFieldValue, RemoteFormField } from '@sveltejs/kit';
	import { Field } from '$lib/components/ui/Form';
	import { getLocations } from '$lib/remote/inventory.remote';

	/**
	 * The "where is it" select, loading its own data.
	 *
	 * Owns `getLocations()` for the same reason `CategoryOptions` owns its query:
	 * it is unparameterized and `addLocation` refreshes it by name, so folding it
	 * into a page query keyed by an id would leave the list stale until
	 * navigation. Kit dedupes a remote query per request, so several of these on
	 * one screen are still one read.
	 *
	 * Two things this deliberately does *not* do:
	 *
	 * - **It does not hide itself when there are no locations.** Both call sites
	 *   used to wrap this in `{#if locations.length > 0}`, which meant the field
	 *   vanished in exactly the state where it matters — a fresh install, at the
	 *   start of a stocktake, before anyone has created a location. The empty
	 *   select now says so and points at where to fix it.
	 * - **It passes `options` rather than `<option>` children.** `FormField`
	 *   renders children *instead of* its select (children beat `type`), so the
	 *   children spelling emits bare `<option>`s with no control around them and
	 *   submits nothing at all.
	 */
	let {
		field,
		value = undefined,
		label = 'Location'
	}: {
		// FormField's own `field?: RemoteFormField<any>`; narrowing it here would
		// reject every caller's concrete field type.
		field: RemoteFormField<RemoteFormFieldValue>;
		value?: string | null;
		label?: string;
	} = $props();

	/** Deep enough for any real building; a cap is also the cycle guard. */
	const MAX_LOCATION_DEPTH = 20;

	const locations = $derived(await getLocations());

	/**
	 * "Main room → Stage left rack", not "Stage left rack".
	 *
	 * A stocktake is walked room by room and the leaf names repeat — every room
	 * has a shelf. Without the parent the select is a list of ambiguous nouns.
	 */
	const options = $derived.by(() => {
		const byId = new Map(locations.map((l) => [l.id, l]));

		function path(id: string): string {
			const parts: string[] = [];
			let cursor: string | null | undefined = id;
			// `parentId` carries no foreign key, so a cycle is possible in
			// principle. A depth cap terminates on one without keeping a `Set` of
			// visited ids — which would be a non-reactive mutable Set inside a
			// `$derived`, and `svelte/prefer-svelte-reactivity` rightly rejects
			// that shape even though this one never escapes the function.
			for (let depth = 0; cursor && depth < MAX_LOCATION_DEPTH; depth++) {
				const node = byId.get(cursor);
				if (!node) break;
				parts.unshift(node.name);
				cursor = node.parentId;
			}
			return parts.join(' → ');
		}

		return [
			{ value: '', label: 'Unassigned' },
			...locations
				.map((l) => ({ value: l.id, label: path(l.id) }))
				.sort((a, b) => a.label.localeCompare(b.label))
		];
	});
</script>

<Field
	{field}
	type="select"
	{label}
	value={value ?? ''}
	{options}
	description={locations.length === 0
		? 'No locations yet — add them under Inventory → Locations and everything you enter can be filed as you go.'
		: undefined}
/>
