<script lang="ts">
	import { Field } from '../ui/Form';
	import { getSupplierNames } from '#lib/remote/inventory.remote.js';
	import type { RemoteFormField, RemoteFormFieldValue } from '$app/server';

	/**
	 * A purchase order's supplier, typed or picked from the suppliers in Contacts.
	 * A name not on file becomes a new supplier when the order is saved.
	 */
	let { field, label }: { field: RemoteFormField<RemoteFormFieldValue>; label: string } = $props();
	const uid = $props.id();
	const listId = `suppliers-${uid}`;
</script>

<Field {field} type="text" {label} list={listId} autocomplete="off" />
<datalist id={listId}>
	{#each await getSupplierNames() as name (name)}
		<option value={name}></option>
	{/each}
</datalist>
