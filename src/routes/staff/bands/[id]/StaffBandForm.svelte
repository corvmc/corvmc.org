<script lang="ts">
	import { untrack } from 'svelte';
	import { IconDeviceFloppy } from '@tabler/icons-svelte';
	import { toast } from 'svelte-sonner';
	import {
		getStaffBand as getBand,
		updateStaffBand as updateBand,
		deactivateBand,
		reactivateBand,
		setBandTier
	} from '$lib/remote/bands.remote';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import { Field } from '$lib/components/shared/Form';
	import RichTextEditor from '$lib/components/shared/Form/RichTextEditor.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import { EntityChip } from '$lib/components/shared/entity';
	import Action from '$lib/components/shared/Action.svelte';
	import DefinitionList from '$lib/components/shared/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/shared/DefinitionList/Fact.svelte';

	// The band arrives as a plain resolved prop, NOT an awaited remote query.
	// Keeping this component's script fully synchronous matters: a top-level
	// `await` (as the pre-split page had) marks every later declaration as
	// "blocked", compiling each bind:value and fields.X.as() expression into an
	// async derived — the reactive churn behind the effect_update_depth_exceeded
	// crash on this page (same bug as /member/profile, JAVASCRIPT-SVELTEKIT-W).
	let {
		band,
		id
	}: {
		band: Awaited<ReturnType<typeof getBand>>;
		id: string;
	} = $props();

	const { fields: reactivateFields } = reactivateBand;
	const { fields: deactivateFields } = deactivateBand;
	const { fields: bandFields } = updateBand;
	const { fields: tierFields } = setBandTier;

	// Reactive: deactivate/reactivate refresh getBand, which updates the prop.
	const isDeactivated = $derived(!!band.deletedAt);

	// A comped band is premium with no subscription JSON; only Stripe-backed
	// bands are off-limits to the comp/revoke actions.
	const isStripeBacked = $derived(!!band.subscription);

	let bioHtml = $state(untrack(() => band.bio) ?? '');
</script>

<Form remote={updateBand} guard onsuccess={() => toast.success('Band updated')}>
	<PageHeader subtitle="Band" title={band.name} backHref="/staff/bands">
		{#if isDeactivated}
			<Badge variant="error" size="md">Deactivated</Badge>
		{/if}
		<SubmitButton shortcut="mod+s">
			{#snippet icon()}
				<IconDeviceFloppy size={20} />
			{/snippet}
		</SubmitButton>
	</PageHeader>
	<PageContent width="3xl">
		<div class="grid gap-6 lg:grid-cols-2 mb-6">
			<InfoCard title="Band Info">
				<div class="grid grid-cols-1 gap-x-2">
					<Field name="name" type="text" value={band.name} />
					<Field name="bio" label="Bio">
						<input {...bandFields.bio.as('hidden', bioHtml)} />
						<RichTextEditor bind:value={bioHtml} placeholder="Tell people about this band..." />
					</Field>
				</div>
			</InfoCard>

			<InfoCard title="Details" class="bg-base-200 shadow-none">
				<DefinitionList>
					<Fact label="Band ID" mono>{band.id}</Fact>

					<Fact label="Slug" mono>{band.slug}</Fact>

					<Fact label="Owner">
						<EntityChip ref={band.owner} />
					</Fact>

					<Fact label="Members">{band.memberCount} active</Fact>

					<Fact label="Tier" class="flex items-center gap-2">
						<StatusBadge status={band.tier} label />
						<span class="text-subtle">
							{isStripeBacked ? 'billed through Stripe' : 'set by staff'}
						</span>
					</Fact>

					{#if band.subscription}
						<Fact label="Billing">
							{band.subscription.billingInterval}, renews {new Date(
								band.subscription.currentPeriodEnd
							).toLocaleDateString()}
							{#if band.subscription.cancelAtPeriodEnd}
								<Badge variant="warning" size="sm">Cancels at period end</Badge>
							{/if}
						</Fact>
					{/if}

					<Fact label="Created">{new Date(band.createdAt).toLocaleDateString()}</Fact>

					{#if band.deletedAt}
						<Fact label="Deactivated">{new Date(band.deletedAt).toLocaleDateString()}</Fact>
					{/if}
				</DefinitionList>

				<div class="mt-4 flex flex-wrap gap-2">
					{#if isStripeBacked}
						<span class="text-subtle">
							Premium is billed through Stripe — cancel there to move this band back to free.
						</span>
					{:else if band.tier === 'premium'}
						<Action
							action={setBandTier}
							label="Revoke premium"
							successToast="Premium revoked"
							variant="warning"
							size="sm"
						>
							{#snippet form()}
								<input {...tierFields.id.as('hidden', id)} />
								<input {...tierFields.tier.as('hidden', 'free')} />
								<p class="py-4">
									Move this band back to the free tier? Their page editor, EPK and public band site
									stop being reachable.
								</p>
							{/snippet}
						</Action>
					{:else}
						<Action
							action={setBandTier}
							label="Comp premium"
							successToast="Premium comped"
							variant="secondary"
							size="sm"
						>
							{#snippet form()}
								<input {...tierFields.id.as('hidden', id)} />
								<input {...tierFields.tier.as('hidden', 'premium')} />
								<p class="py-4">
									Give this band premium at no charge? No Stripe subscription is created, and the
									comp stays in place until staff revoke it.
								</p>
							{/snippet}
						</Action>
					{/if}
					{#if isDeactivated}
						<Action
							action={reactivateBand}
							label="Reactivate"
							successToast="Band reactivated"
							variant="success"
							size="sm"
							onsuccess={() => {
								void getBand(id).refresh();
							}}
						>
							{#snippet form()}
								<input {...reactivateFields.id.as('hidden', id)} />
								<p class="py-4">Reactivate this band?</p>
							{/snippet}
						</Action>
					{:else}
						<Action
							action={deactivateBand}
							label="Deactivate"
							successToast="Band deactivated"
							variant="error"
							size="sm"
							onsuccess={() => {
								void getBand(id).refresh();
							}}
						>
							{#snippet form()}
								<input {...deactivateFields.id.as('hidden', id)} />
								<p class="py-4">Deactivate this band? All future reservations will be cancelled.</p>
							{/snippet}
						</Action>
					{/if}
				</div>
			</InfoCard>
		</div>
	</PageContent>
</Form>
