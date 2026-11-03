<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import EmailInviteCard from '$lib/components/groups/EmailInviteCard.svelte';
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

	// The sidebar "Create Band" links point here with ?create=1 — open the modal.
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
	// "Create Band" sets it true, the URL settles, the derived re-runs and pins it
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

<PageHeader width="2xl" title={m.member_bands_my_bands()} subtitle={m.member_member()}>
	<Button variant="default" size="sm" onclick={() => (showCreateModal = true)}
		>{m.member_bands_create_band()}</Button
	>
</PageHeader>
<PageContent width="2xl">
	<!-- Pending invitations -->
	{#if pending.length > 0 || data.emailInvites.length > 0}
		<section>
			<h2 class="mb-3 text-lg font-semibold">{m.member_bands_pending_invitations()}</h2>
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
										{m.member_bands_invited_as({ role: invite.role })}
									</p>
								</div>
								<div class="flex gap-2">
									<Form
										remote={accept}
										onsuccess={(result) => {
											if (result?.success === false) {
												toast.error(m.member_bands_invitation_no_longer_available());
											} else {
												toast.success(m.member_bands_invitation_accepted());
											}
											invalidateAll();
										}}
									>
										<input {...accept.fields.bandId.as('hidden', invite.id)} />
										<SubmitButton
											label={m.member_accept()}
											successLabel={m.member_bands_accepted()}
											variant="primary"
											size="sm"
										/>
									</Form>
									<Form
										remote={decline}
										onsuccess={(result) => {
											if (result?.success === false) {
												toast.error(m.member_bands_invitation_no_longer_available());
											} else {
												toast.success(m.member_bands_invitation_declined());
											}
											invalidateAll();
										}}
									>
										<input {...decline.fields.bandId.as('hidden', invite.id)} />
										<SubmitButton
											label={m.member_decline()}
											successLabel={m.member_bands_declined()}
											variant="ghost"
											size="sm"
										/>
									</Form>
								</div>
							</div>
						</CardBody>
					</Card>
				{/each}

				{#each data.emailInvites as inv (inv.id)}
					<EmailInviteCard invite={inv} />
				{/each}
			</div>
		</section>
	{/if}

	<!-- Active bands -->
	<section>
		{#if active.length === 0 && pending.length === 0 && data.emailInvites.length === 0}
			<EmptyState message={m.member_bands_re_not_any_bands_yet()} />
		{:else if active.length === 0}
			<EmptyState message={m.member_bands_no_active_bands_yet()} />
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
									{b.memberCount === 1 ? m.member_bands_member() : m.member_bands_members()}
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
<Modal
	title={m.member_bands_create_band()}
	bind:open={showCreateModal}
	onclose={onCreateModalClose}
>
	<Form
		remote={createBand}
		onfailure={(issues) => {
			// A validation failure already renders under the offending field, so the
			// toast would only repeat it. Reserve the generic message for genuine
			// server/network failures, which have no field to point at — previously
			// both produced the same opaque "Failed to create band".
			if (!issues?.length) toast.error(m.member_bands_failed_create_band());
		}}
		onsuccess={(result) => {
			toast.success(m.member_bands_band_created());
			showCreateModal = false;
			if (result?.slug) goto(resolve(`/band/${result.slug}`));
		}}
	>
		<div class="space-y-4">
			<FormField
				field={createBand.fields.name}
				label={m.member_bands_band_name()}
				type="text"
				placeholder={m.member_bands_e_g_velvet_underground()}
				required
			/>

			<FormField
				field={createBand.fields.bio}
				label={m.member_bio()}
				type="textarea"
				rows={3}
				placeholder={m.member_bands_tell_people_about_band_optional()}
			/>

			<div class="flex justify-end pt-2">
				<SubmitButton
					label={m.member_bands_create_band()}
					successLabel={m.member_bands_created()}
					variant="primary"
				/>
			</div>
		</div>
	</Form>
</Modal>
