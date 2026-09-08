<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import PackingItemsEditor from './PackingItemsEditor.svelte';
	import { savePackingItems, savePackingItemsFor } from '$lib/remote/packing.remote';
	import type { PackingItemRowState } from '$lib/types/packing';

	/**
	 * One person's crate — or the band's shared kit, which a null owner means.
	 *
	 * `mine` picks the remote function, and that is the whole client-side
	 * permission story: a member's save runs through `savePackingItems`, which
	 * takes no owner and writes against the guard's user, so no path here can
	 * ask to edit somebody else's rows.
	 */
	let {
		bandId,
		ownerUserId,
		slotKey,
		title,
		subtitle,
		initial,
		mine = false,
		canEdit,
		onsaved
	}: {
		bandId: string;
		/** Null is the band's shared kit — no member's own crate, so admin-only. */
		ownerUserId: string | null;
		/**
		 * A legal field-name fragment (`mine`, `shared`, `m0`) keeping two editors
		 * on one page apart. Not a user id: SvelteKit parses submitted names as
		 * schema paths, and a uuid's hyphens kill the submit client-side.
		 */
		slotKey: string;
		title: string;
		subtitle?: string;
		initial: PackingItemRowState[];
		mine?: boolean;
		canEdit: boolean;
		onsaved: () => void;
	} = $props();

	/**
	 * `.for()` gives each crate its own form instance, so two saves on one page
	 * cannot share a pending state or an error. Held as its own binding rather
	 * than a ternary: only the admin form has `targetUserId`, and a union of the
	 * two loses the field that tells them apart.
	 */
	const adminRemote = $derived(savePackingItemsFor.for(ownerUserId ?? 'shared'));

	let items = $state<PackingItemRowState[]>(initial);

	const count = $derived(items.filter((it) => it.label?.trim()).length);
</script>

<Card>
	<CardBody>
		<div class="mb-3 flex flex-wrap items-center gap-2">
			<h2 class="text-base font-semibold">{title}</h2>
			{#if mine}<Badge color="primary">You</Badge>{/if}
			<Badge class="ml-auto">{count} {count === 1 ? 'thing' : 'things'}</Badge>
		</div>
		{#if subtitle}
			<p class="mb-3 text-xs text-base-content/60">{subtitle}</p>
		{/if}

		{#if canEdit && mine}
			<Form
				remote={savePackingItems}
				guard
				successToast="Packing list saved"
				onsuccess={onsaved}
				class="space-y-4"
			>
				<input {...savePackingItems.fields.bandId.as('hidden', bandId)} />
				<PackingItemsEditor bind:items field={savePackingItems.fields.items} idPrefix={slotKey} />
				<div class="flex justify-end"><SubmitButton label="Save" /></div>
			</Form>
		{:else if canEdit}
			<Form
				remote={adminRemote}
				guard
				successToast="Packing list saved"
				onsuccess={onsaved}
				class="space-y-4"
			>
				<input {...adminRemote.fields.bandId.as('hidden', bandId)} />
				<input {...adminRemote.fields.targetUserId.as('hidden', ownerUserId ?? '')} />
				<PackingItemsEditor bind:items field={adminRemote.fields.items} idPrefix={slotKey} />
				<div class="flex justify-end"><SubmitButton label="Save" /></div>
			</Form>
		{:else}
			<PackingItemsEditor bind:items idPrefix={slotKey} readonly />
		{/if}
	</CardBody>
</Card>
