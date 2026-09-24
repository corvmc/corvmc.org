<script lang="ts">
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { pledgeWishlistItem, releaseWishlistPledge } from '$lib/remote/inventory.remote';
	import GuestPledgeAction from './GuestPledgeAction.svelte';
	import type { WishlistPledgeSubject } from '$lib/config';

	/**
	 * One entry's pledge control (#1492). Another donor's pledge shows only as
	 * "someone"; the viewer's own carries a Release. A signed-out visitor pledges
	 * by name and email (#1565). `.for()` keeps each entry's submit state apart.
	 */
	let {
		subjectType,
		subjectId,
		claim,
		pledgeId,
		signedIn,
		entryName
	}: {
		subjectType: WishlistPledgeSubject;
		subjectId: string;
		claim: 'none' | 'someone' | 'you';
		pledgeId?: string;
		signedIn: boolean;
		entryName: string;
	} = $props();

	const pledge = $derived(pledgeWishlistItem.for(`${subjectType}:${subjectId}`));
	const release = $derived(releaseWishlistPledge.for(`${subjectType}:${subjectId}`));
</script>

{#if claim === 'someone'}
	<span class="text-sm text-fg-3">Someone is bringing this</span>
{:else if claim === 'you' && pledgeId}
	<Form remote={release} successToast="Released — someone else can bring it">
		<input {...release.fields.pledgeId.as('hidden', pledgeId)} />
		<span class="text-sm text-fg-3">You're bringing this.</span>
		<SubmitButton label="Release" size="xs" variant="ghost" />
	</Form>
{:else if signedIn}
	<Form remote={pledge} successToast="Thanks — staff will expect it for 30 days">
		<input {...pledge.fields.subjectType.as('hidden', subjectType)} />
		<input {...pledge.fields.subjectId.as('hidden', subjectId)} />
		<SubmitButton label="I'll bring this" size="xs" variant="default" outline />
	</Form>
{:else}
	<GuestPledgeAction {subjectType} {subjectId} {entryName} />
{/if}
