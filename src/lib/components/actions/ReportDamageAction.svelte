<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '../ui/Action.svelte';
	import type { ButtonSize, ButtonVariant } from '../ui/Button.svelte';
	import { refreshAll } from '$app/navigation';
	import { reportAssetDamage } from '#lib/remote/inventory.remote.js';
	import { Field } from '../ui/Form';

	const { fields } = reportAssetDamage;

	let {
		assetId,
		variant = 'default',
		size = 'sm',
		class: className = '',
		onsuccess,
		...rest
	}: {
		assetId: string;
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		onsuccess?: () => void;
		[key: string]: unknown;
	} = $props();
</script>

<Action
	action={reportAssetDamage}
	data-testid="report-damage"
	label={m.actions_report_damage_report_problem()}
	modalTitle={m.actions_report_damage_report_problem()}
	successToast={m.actions_thanks_staff_have_been_told()}
	{variant}
	{size}
	class={className}
	onsuccess={onsuccess ?? (() => refreshAll())}
	{...rest}
>
	{#snippet form()}
		<input {...fields.assetId.as('hidden', assetId)} />
		<!-- Said plainly, because it is a real consequence of pressing the button:
		     the unit stops being bookable straight away. Better that than the next
		     member finding out the hard way. -->
		<div class="mb-3 rounded bg-base-200 p-3 text-sm">
			<p>{m.actions_report_damage_takes_item_out_service_until()}</p>
		</div>
		<Field
			field={fields.note}
			type="textarea"
			label={m.actions_what_s_wrong()}
			description={m.actions_report_damage_description()}
		/>
		<Field
			field={fields.condition}
			type="select"
			label={m.actions_report_damage_how_bad()}
			options={[
				{ value: '', label: m.actions_report_damage_not_sure() },
				{ value: 'fair', label: m.actions_report_damage_still_usable_but_not_right() },
				{ value: 'poor', label: m.actions_report_damage_should_not_used() }
			]}
		/>
	{/snippet}
</Action>
