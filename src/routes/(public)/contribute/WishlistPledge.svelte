<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { pledgeWishlistItem, releaseWishlistPledge } from '#lib/remote/inventory.remote.js';
	import GuestPledgeAction from './GuestPledgeAction.svelte';
	import type { WishlistPledgeSubject } from '#lib/config.js';

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
	<span class="text-sm text-fg-3">{m.public_contribute_wishlist_pledge_someone_bringing()}</span>
{:else if claim === 'you' && pledgeId}
	<Form
		remote={release}
		successToast={m.public_contribute_wishlist_pledge_released_someone_else_can()}
	>
		<input {...release.fields.pledgeId.as('hidden', pledgeId)} />
		<span class="text-sm text-fg-3">{m.public_contribute_wishlist_pledge_re_bringing()}</span>
		<SubmitButton label={m.public_contribute_wishlist_pledge_release()} size="xs" variant="ghost" />
	</Form>
{:else if signedIn}
	<Form
		remote={pledge}
		successToast={m.public_contribute_wishlist_pledge_thanks_staff_will_expect_3()}
	>
		<input {...pledge.fields.subjectType.as('hidden', subjectType)} />
		<input {...pledge.fields.subjectId.as('hidden', subjectId)} />
		<SubmitButton label={m.public_i_ll_bring()} size="xs" variant="default" outline />
	</Form>
{:else}
	<GuestPledgeAction {subjectType} {subjectId} {entryName} />
{/if}
