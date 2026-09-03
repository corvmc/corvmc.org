<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import RiderElementsEditor from './RiderElementsEditor.svelte';
	import { saveMyRiderElements, saveMemberRiderElements } from '$lib/remote/rider.remote';
	import type { RiderElementRowState } from '$lib/types/rider';

	/**
	 * One person's corner of the rider — or the band's shared items, which is
	 * what a null owner means.
	 *
	 * The component picks its own remote function from `mine`, and that is the
	 * whole permission story on the client: a member's save runs through
	 * `saveMyRiderElements`, which takes no owner at all and writes against the
	 * guard's user. There is no code path here that could ask to edit somebody
	 * else's rows; the admin path is a different function with a different guard.
	 *
	 * Local `$state` seeded from props, and the page remounts it with `{#key}`
	 * when the query refreshes — the editor holds a working copy, so re-seeding
	 * it under the author's hands mid-edit would be the wrong behaviour.
	 */
	let {
		bandId,
		ownerUserId,
		title,
		subtitle,
		initial,
		roster,
		mine = false,
		canEdit,
		onsaved
	}: {
		bandId: string;
		/** Null is the band's shared gear — no member's own corner, so admin-only. */
		ownerUserId: string | null;
		title: string;
		subtitle?: string;
		initial: RiderElementRowState[];
		roster: { userId: string; name: string }[];
		mine?: boolean;
		canEdit: boolean;
		onsaved: () => void;
	} = $props();

	/**
	 * `.for()` gives each corner its own form instance, so two saves on one page
	 * cannot share a pending state or an error.
	 *
	 * Held as its own binding rather than a ternary against `saveMyRiderElements`:
	 * the two forms have different schemas — only this one has `targetUserId` —
	 * and a union of the two loses the field that tells them apart.
	 */
	const adminRemote = $derived(saveMemberRiderElements.for(ownerUserId ?? 'shared'));

	let elements = $state<RiderElementRowState[]>(initial);

	const inputCount = $derived(
		elements.reduce((n, el) => n + (el.kind === 'monitor' ? 0 : el.inputs.length), 0)
	);
</script>

<Card>
	<CardBody>
		<div class="mb-3 flex flex-wrap items-center gap-2">
			<h2 class="text-base font-semibold">{title}</h2>
			{#if mine}<Badge color="primary">You</Badge>{/if}
			<Badge class="ml-auto">{inputCount} {inputCount === 1 ? 'input' : 'inputs'}</Badge>
		</div>
		{#if subtitle}
			<p class="mb-3 text-xs text-base-content/60">{subtitle}</p>
		{/if}

		{#if canEdit && mine}
			<Form
				remote={saveMyRiderElements}
				guard
				successToast="Rider saved"
				onsuccess={onsaved}
				class="space-y-4"
			>
				<input {...saveMyRiderElements.fields.bandId.as('hidden', bandId)} />

				<RiderElementsEditor
					bind:elements
					{roster}
					field={saveMyRiderElements.fields.elements}
					idPrefix={ownerUserId ?? 'shared'}
				/>

				<div class="flex justify-end">
					<SubmitButton label="Save" />
				</div>
			</Form>
		{:else if canEdit}
			<Form
				remote={adminRemote}
				guard
				successToast="Rider saved"
				onsuccess={onsaved}
				class="space-y-4"
			>
				<input {...adminRemote.fields.bandId.as('hidden', bandId)} />
				<input {...adminRemote.fields.targetUserId.as('hidden', ownerUserId ?? '')} />

				<RiderElementsEditor
					bind:elements
					{roster}
					field={adminRemote.fields.elements}
					idPrefix={ownerUserId ?? 'shared'}
				/>

				<div class="flex justify-end">
					<SubmitButton label="Save" />
				</div>
			</Form>
		{:else}
			<RiderElementsEditor bind:elements {roster} idPrefix={ownerUserId ?? 'shared'} readonly />
		{/if}
	</CardBody>
</Card>
