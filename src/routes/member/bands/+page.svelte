<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { goto, invalidateAll, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import Button from '$lib/components/ui/Button.svelte';
	import {
		createBand,
		acceptInvite,
		declineInvite,
		getMemberBands
	} from '$lib/remote/bands.remote';

	// The sidebar "Create Act" links point here with ?create=1 — open the modal.
	//
	// Two constraints, both svelte experimental-async related (still present in
	// 5.57.0; covered by e2e/create-band-modal.e2e.ts):
	// - This declaration must sit BEFORE the top-level await. Declarations after
	//   it compile as "blocked" and the modal wiring goes dead.
	// - A client-side navigation landing while the member layout's async queries
	//   are still settling could strand this page's `$effect`s — including the
	//   one bits-ui's `Dialog.Portal` uses to mount itself, so no dialog ever
	//   entered the DOM and the button was dead for the life of the page. That
	//   is a svelte scheduler bug, not a shape this page can avoid, and it is
	//   fixed in `patches/svelte@5.57.0.patch` — see the note there. The sidebar
	//   links still carry data-sveltekit-reload; that is now belt-and-braces
	//   rather than the mitigation it was.
	// Deliberately an $effect over $state, NOT a writable $derived. A derived on
	// `page.url` evaluates against the pre-navigation URL during a fast SPA
	// navigation and the Modal's `bind:open` pins that stale false: clicking
	// "Create Act" sets it true, the URL settles, the derived re-runs and pins it
	// back — a button that does nothing. #149 chose the effect for exactly this
	// reason and said so; #153 replaced it with the derived and the dead modal
	// came back, intermittently, in ~17% of CI runs.
	//
	// `data-sveltekit-reload` on the sidebar's ?create=1 link makes THAT arrival
	// a full load, but it does not cover the plain client-side navigations into
	// this page — `goto('/member/bands')` from band settings and from
	// YourMembership, and the links on /member and in the member layout. Those
	// are how a real user hits the dead button.
	//
	// The effect only ever opens, never closes, so a user's own click cannot be
	// undone by a later URL settle.
	let showCreateModal = $state(false);

	$effect(() => {
		if (page.url.searchParams.has('create')) showCreateModal = true;
	});

	// Drop the param on close so the nav link re-triggers and refresh stays clean.
	function onCreateModalClose() {
		if (page.url.searchParams.has('create')) {
			replaceState(resolve('/member/bands'), {});
		}
	}

	let data = $derived(await getMemberBands());

	const pending = $derived(data.pending);
	const active = $derived(data.active);
</script>

<PageHeader title="My Acts" subtitle="Member">
	<Button variant="default" size="sm" onclick={() => (showCreateModal = true)}>Create Act</Button>
</PageHeader>
<PageContent width="2xl">
	<!-- Pending invitations -->
	{#if pending.length > 0}
		<section>
			<h2 class="mb-3 text-lg font-semibold">Pending Invitations</h2>
			<div class="space-y-3">
				{#each pending as invite (invite.id)}
					{@const accept = acceptInvite.for(invite.id)}
					{@const decline = declineInvite.for(invite.id)}
					<Card>
						<CardBody class="py-4">
							<div class="flex items-center justify-between">
								<div>
									<p class="font-medium">{invite.name}</p>
									<p class="text-muted">
										Invited as {invite.role}
									</p>
								</div>
								<div class="flex gap-2">
									<Form
										remote={accept}
										onfailure={() => toast.error('Failed to accept')}
										onsuccess={(result) => {
											if (result?.success === false) {
												toast.error('That invitation is no longer available.');
											} else {
												toast.success('Invitation accepted');
											}
											invalidateAll();
										}}
									>
										<input {...accept.fields.bandId.as('hidden', invite.id)} />
										<SubmitButton
											label="Accept"
											successLabel="Accepted"
											variant="primary"
											size="sm"
										/>
									</Form>
									<Form
										remote={decline}
										onfailure={() => toast.error('Failed to decline')}
										onsuccess={(result) => {
											if (result?.success === false) {
												toast.error('That invitation is no longer available.');
											} else {
												toast.success('Invitation declined');
											}
											invalidateAll();
										}}
									>
										<input {...decline.fields.bandId.as('hidden', invite.id)} />
										<SubmitButton
											label="Decline"
											successLabel="Declined"
											variant="ghost"
											size="sm"
										/>
									</Form>
								</div>
							</div>
						</CardBody>
					</Card>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Active acts -->
	<section>
		{#if active.length === 0 && pending.length === 0}
			<EmptyState message="You're not in any acts yet. Create one to get started." />
		{:else if active.length === 0}
			<EmptyState message="No active acts yet." />
		{:else}
			<div class="space-y-3">
				{#each active as b (b.id)}
					<a
						href={resolve(`/band/${b.slug}`)}
						class="card bg-base-100 shadow transition-shadow hover:shadow-md"
					>
						<CardBody row class="py-4">
							<div>
								<p class="font-medium">{b.name}</p>
								<p class="text-muted">
									{b.memberCount}
									{b.memberCount === 1 ? 'member' : 'members'}
								</p>
							</div>
							<StatusBadge status={b.role} />
						</CardBody>
					</a>
				{/each}
			</div>
		{/if}
	</section>
</PageContent>

<!-- Create Act Modal -->
<Modal title="Create Act" bind:open={showCreateModal} onclose={onCreateModalClose}>
	<Form
		remote={createBand}
		onfailure={(issues) => {
			// A validation failure already renders under the offending field, so the
			// toast would only repeat it. Reserve the generic message for genuine
			// server/network failures, which have no field to point at — previously
			// both produced the same opaque "Failed to create act".
			if (!issues?.length) toast.error('Failed to create act');
		}}
		onsuccess={(result) => {
			toast.success('Act created');
			showCreateModal = false;
			if (result?.slug) goto(resolve(`/band/${result.slug}`));
		}}
	>
		<div class="space-y-4">
			<FormField
				field={createBand.fields.name}
				label="Act name"
				type="text"
				placeholder="e.g. The Velvet Underground"
				required
			/>

			<FormField
				field={createBand.fields.bio}
				label="Bio"
				type="textarea"
				rows={3}
				placeholder="Tell people about your act (optional)"
			/>

			<div class="flex justify-end pt-2">
				<SubmitButton label="Create Act" successLabel="Created" variant="primary" />
			</div>
		</div>
	</Form>
</Modal>
