<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Pagination from '#lib/components/ui/Pagination.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { getLocationsWithCounts, addLocation } from '#lib/remote/inventory.remote.js';

	/** Deep enough for any real building; a cap is also the cycle guard. */
	const MAX_LOCATION_DEPTH = 20;

	/**
	 * Where things live.
	 *
	 * `addLocation` shipped with the module and had no caller anywhere, so
	 * locations could be *chosen* and never *created* — and both pickers hid
	 * themselves when the list was empty, which is the state every install starts
	 * in. A stocktake begins by walking the building and naming the rooms, so this
	 * is the first page of the job rather than a settings screen.
	 */
	const data = $derived(await getLocationsWithCounts());
	const { fields } = addLocation;

	/** "Main room → Stage left rack" — leaf names repeat, so the path is the name. */
	const rows = $derived.by(() => {
		const byId = new Map(data.locations.map((l) => [l.id, l]));

		function path(id: string): string[] {
			const parts: string[] = [];
			let cursor: string | null | undefined = id;
			// `parentId` carries no foreign key, so a cycle is possible. The depth
			// cap terminates on one without a mutable `Set` inside a `$derived`.
			for (let depth = 0; cursor && depth < MAX_LOCATION_DEPTH; depth++) {
				const node = byId.get(cursor);
				if (!node) break;
				parts.unshift(node.name);
				cursor = node.parentId;
			}
			return parts;
		}

		return data.locations
			.map((l) => ({ ...l, path: path(l.id) }))
			.sort((a, b) => a.path.join(' → ').localeCompare(b.path.join(' → ')));
	});
</script>

<PageHeader width="3xl" title={m.staff_locations()} subtitle={m.staff_inventory()} />

<PageContent width="3xl">
	{#if data.locations.length === 0}
		<Alert type="info" class="mb-4">
			{m.staff_inventory_locations_nothing_has_home_yet_name()}
		</Alert>
	{/if}

	<div class="grid gap-6 lg:grid-cols-[2fr_1fr]">
		<div>
			{#if data.locations.length > 0}
				<Table>
					{#snippet head()}
						<th>{m.staff_location()}</th>
						<th class="cell-num">{m.staff_units()}</th>
					{/snippet}
					{#each rows as row (row.id)}
						<tr class="hover">
							<td class="cell-primary">
								{#if row.path.length > 1}
									<span class="text-subtle">{row.path.slice(0, -1).join(' → ')} → </span>
								{/if}
								<span class="font-medium">{row.path.at(-1)}</span>
								{#if row.notes}
									<div class="text-subtle">{row.notes}</div>
								{/if}
							</td>
							<td class="cell-num">{row.unitCount}</td>
						</tr>
					{/each}
					{#if data.unassignedCount > 0}
						<tr class="hover">
							<td class="cell-primary">
								<span class="font-medium">{m.staff_unassigned()}</span>
								<Badge variant="warning" size="xs"
									>{m.staff_inventory_locations_needs_filing()}</Badge
								>
								<div class="text-subtle">
									{m.staff_inventory_locations_units_entered_before_location_exis()}
								</div>
							</td>
							<td class="cell-num">{data.unassignedCount}</td>
						</tr>
					{/if}
				</Table>
				<Pagination total={rows.length} unit="locations" />
			{/if}
		</div>

		<InfoCard title={m.staff_inventory_locations_add_location()}>
			<Form remote={addLocation} successToast={m.staff_inventory_locations_success_toast()}>
				<Field field={fields.name} type="text" label={m.staff_name()} />
				<Field
					field={fields.parentId}
					type="select"
					label={m.staff_inventory_locations_inside()}
					options={[
						{ value: '', label: m.staff_inventory_locations_nothing_its_own_place() },
						...rows.map((r) => ({ value: r.id, label: r.path.join(' → ') }))
					]}
				/>
				<Field field={fields.notes} type="textarea" label={m.staff_notes()} />
				<Field
					field={fields.displayOrder}
					type="number"
					label={m.staff_order_2()}
					value={0}
					min="0"
				/>
				<div class="mt-3">
					<SubmitButton label={m.staff_inventory_locations_add_location_2()} />
				</div>
			</Form>
		</InfoCard>
	</div>
</PageContent>
