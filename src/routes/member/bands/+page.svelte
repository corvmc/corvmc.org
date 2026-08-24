<script lang="ts">
	import Card from '$lib/components/shared/Card/Card.svelte';
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import Modal from '$lib/components/shared/Modal.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import { goto, invalidateAll, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import Button from '$lib/components/shared/Button.svelte';
	import {
		createBand,
		acceptInvite,
		declineInvite,
		getMemberBands
	} from '$lib/remote/bands.remote';

	// The sidebar "Create Band" links point here with ?create=1 — open the modal.
	//
	// Two constraints, both svelte experimental-async related (still present in
	// 5.56.8; covered by the band-onboarding e2e test):
	// - This declaration must sit BEFORE the top-level await. Declarations after
	//   it compile as "blocked" and the modal wiring goes dead.
	// - No wiring here survives a client-side navigation that lands while the
	//   member layout's async queries are still settling (init-time effects are
	//   skipped and an initially-open bits-ui dialog never mounts its portal),
	//   so the sidebar links carry data-sveltekit-reload and arrive as a full
	//   document load, which initializes deterministically.
	// A writable derived keeps the wiring passive: closing writes false into the
	// binding, then onCreateModalClose strips the param so the dependency change
	// keeps the derived in sync.
	let showCreateModal = $derived(page.url.searchParams.has('create'));

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

<PageHeader title="My Bands" subtitle="Member">
	<Button variant="default" size="sm" onclick={() => (showCreateModal = true)}>Create Band</Button>
</PageHeader>
<PageContent width="2xl">
	<!-- Pending invitations -->
	{#if pending.length > 0}
		<section>
			<h2 class="text-lg font-semibold mb-3">Pending Invitations</h2>
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

	<!-- Active bands -->
	<section>
		{#if active.length === 0 && pending.length === 0}
			<EmptyState message="You're not in any bands yet. Create one to get started." />
		{:else if active.length === 0}
			<EmptyState message="No active bands yet." />
		{:else}
			<div class="space-y-3">
				{#each active as b (b.id)}
					<a
						href={resolve(`/band/${b.slug}`)}
						class="card bg-base-100 shadow hover:shadow-md transition-shadow"
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

<!-- Create Band Modal -->
<Modal title="Create Band" bind:open={showCreateModal} onclose={onCreateModalClose}>
	<Form
		remote={createBand}
		onfailure={(issues) => {
			// A validation failure already renders under the offending field, so the
			// toast would only repeat it. Reserve the generic message for genuine
			// server/network failures, which have no field to point at — previously
			// both produced the same opaque "Failed to create band".
			if (!issues?.length) toast.error('Failed to create band');
		}}
		onsuccess={(result) => {
			toast.success('Band created');
			showCreateModal = false;
			if (result?.slug) goto(resolve(`/band/${result.slug}`));
		}}
	>
		<div class="space-y-4">
			<FormField
				field={createBand.fields.name}
				label="Band name"
				type="text"
				placeholder="e.g. The Velvet Underground"
				required
			/>

			<FormField
				field={createBand.fields.bio}
				label="Bio"
				type="textarea"
				rows={3}
				placeholder="Tell people about your band (optional)"
			/>

			<div class="flex justify-end pt-2">
				<SubmitButton label="Create Band" successLabel="Created" variant="primary" />
			</div>
		</div>
	</Form>
</Modal>
