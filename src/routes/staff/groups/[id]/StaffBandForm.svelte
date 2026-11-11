<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { formatDateShortYear } from '#lib/utils/format.js';
	import { untrack } from 'svelte';
	import { IconDeviceFloppy } from '@tabler/icons-svelte';
	import { toast } from 'svelte-sonner';
	import {
		getStaffBand as getBand,
		updateStaffBand as updateBand,
		deactivateBand,
		reactivateBand,
		setBandTier
	} from '#lib/remote/bands.remote.js';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import RichTextEditor from '#lib/components/ui/Form/RichTextEditor.svelte';
	import RecordFrame from '#lib/components/ui/RecordFrame.svelte';
	import type { Snippet } from 'svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
	import Action from '#lib/components/ui/Action.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';

	// The band arrives as a plain resolved prop, NOT an awaited remote query.
	// Keeping this component's script fully synchronous matters: a top-level
	// `await` (as the pre-split page had) marks every later declaration as
	// "blocked", compiling each bind:value and fields.X.as() expression into an
	// async derived — the reactive churn behind the effect_update_depth_exceeded
	// crash on this page (same bug as /member/profile, JAVASCRIPT-SVELTEKIT-W).
	let {
		band,
		id,
		variant = 'page',
		actions
	}: {
		band: Awaited<ReturnType<typeof getBand>>;
		id: string;
		variant?: 'page' | 'panel';
		actions?: Snippet;
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

<Form
	remote={updateBand}
	guard
	onsuccess={() => toast.success(m.staff_groups_id_staff_band_form_toast())}
>
	<RecordFrame {variant} {actions} subtitle={m.staff_band_body()} title={band.name}>
		{#snippet header()}
			{#if isDeactivated}
				<Badge variant="error" size="md">{m.staff_deactivated_label()}</Badge>
			{/if}
			<SubmitButton shortcut="mod+s" size="sm">
				{#snippet icon()}
					<IconDeviceFloppy size={20} />
				{/snippet}
			</SubmitButton>
		{/snippet}
		<div class="mb-6 grid gap-6 lg:grid-cols-2">
			<InfoCard title={m.staff_groups_id_staff_band_form_band_info_title()}>
				<div class="grid grid-cols-1 gap-x-2">
					<Field
						field={updateBand.fields.name}
						label={m.staff_name_label()}
						type="text"
						value={band.name}
					/>
					<Field
						field={updateBand.fields.bio}
						label={m.staff_groups_id_staff_band_form_bio_label()}
					>
						<input {...bandFields.bio.as('hidden', bioHtml)} />
						<RichTextEditor
							bind:value={bioHtml}
							placeholder={m.staff_groups_id_staff_band_form_placeholder()}
						/>
					</Field>
				</div>
			</InfoCard>

			<InfoCard title={m.staff_details_title()} class="bg-base-200 shadow-none">
				<DefinitionList>
					<Fact label={m.staff_groups_id_staff_band_form_band_id_label()} mono>{band.id}</Fact>

					<Fact label={m.staff_slug_label()} mono>{band.slug}</Fact>

					<Fact label={m.staff_owner_label()}>
						<EntityChip ref={band.owner} />
					</Fact>

					<Fact label={m.staff_members_label()}
						>{m.staff_groups_id_staff_band_form_active_text({
							memberCount: band.memberCount
						})}</Fact
					>

					<Fact label={m.staff_tier_label()} class="flex items-center gap-2">
						<StatusBadge status={band.tier} label />
						<span class="text-subtle">
							{isStripeBacked
								? m.staff_groups_id_staff_band_form_billed_through_stripe_text()
								: m.staff_groups_id_staff_band_form_set_by_staff_text()}
						</span>
					</Fact>

					{#if band.subscription}
						<Fact label={m.staff_groups_id_staff_band_form_billing_label()}>
							{m.staff_groups_id_staff_band_form_renews_text({
								billingInterval: band.subscription.billingInterval,
								formatDateShortYear: formatDateShortYear(
									new Date(band.subscription.currentPeriodEnd)
								)
							})}
							{#if band.subscription.cancelAtPeriodEnd}
								<Badge variant="warning" size="sm"
									>{m.staff_groups_id_staff_band_form_cancels_at_period_end_label()}</Badge
								>
							{/if}
						</Fact>
					{/if}

					<Fact label={m.staff_created_label()}
						>{formatDateShortYear(new Date(band.createdAt))}</Fact
					>

					{#if band.deletedAt}
						<Fact label={m.staff_deactivated_label()}
							>{formatDateShortYear(new Date(band.deletedAt))}</Fact
						>
					{/if}
				</DefinitionList>

				<div class="mt-4 flex flex-wrap gap-2">
					{#if isStripeBacked}
						<span class="text-subtle">
							{m.staff_groups_id_staff_band_form_premium_billed_through_strip_text()}
						</span>
					{:else if band.tier === 'premium'}
						<Action
							action={setBandTier}
							label={m.staff_groups_id_staff_band_form_revoke_premium_label()}
							successToast={m.staff_groups_id_staff_band_form_premium_revoked_toast()}
							variant="warning"
							size="sm"
						>
							{#snippet form()}
								<input {...tierFields.id.as('hidden', id)} />
								<input {...tierFields.tier.as('hidden', 'free')} />
								<p class="py-4">
									{m.staff_groups_id_staff_band_form_move_band_back_free_tier_text()}
								</p>
							{/snippet}
						</Action>
					{:else}
						<Action
							action={setBandTier}
							label={m.staff_groups_id_staff_band_form_comp_premium_label()}
							successToast={m.staff_groups_id_staff_band_form_premium_comped_toast()}
							variant="secondary"
							size="sm"
						>
							{#snippet form()}
								<input {...tierFields.id.as('hidden', id)} />
								<input {...tierFields.tier.as('hidden', 'premium')} />
								<p class="py-4">
									{m.staff_groups_id_staff_band_form_give_band_premium_at_no_text()}
								</p>
							{/snippet}
						</Action>
					{/if}
					{#if isDeactivated}
						<Action
							action={reactivateBand}
							label={m.staff_groups_id_staff_band_form_reactivate_label()}
							successToast={m.staff_groups_id_staff_band_form_band_reactivated_toast()}
							variant="success"
							size="sm"
							onsuccess={() => {
								void getBand(id).refresh();
							}}
						>
							{#snippet form()}
								<input {...reactivateFields.id.as('hidden', id)} />
								<p class="py-4">{m.staff_groups_id_staff_band_form_reactivate_band_text()}</p>
							{/snippet}
						</Action>
					{:else}
						<Action
							action={deactivateBand}
							label={m.staff_groups_id_staff_band_form_deactivate_label()}
							successToast={m.staff_groups_id_staff_band_form_band_deactivated_toast()}
							variant="error"
							size="sm"
							onsuccess={() => {
								void getBand(id).refresh();
							}}
						>
							{#snippet form()}
								<input {...deactivateFields.id.as('hidden', id)} />
								<p class="py-4">
									{m.staff_groups_id_staff_band_form_deactivate_band_all_future_r_text()}
								</p>
							{/snippet}
						</Action>
					{/if}
				</div>
			</InfoCard>
		</div>
	</RecordFrame>
</Form>
