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
	label={m.actions_report_damage_report_problem_label()}
	modalTitle={m.actions_report_damage_report_problem_title()}
	successToast={m.actions_thanks_staff_have_been_told_toast()}
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
			<p>{m.actions_report_damage_takes_item_out_service_until_text()}</p>
		</div>
		<Field
			field={fields.note}
			type="textarea"
			label={m.actions_what_s_wrong_label()}
			description={m.actions_report_damage_description_body()}
		/>
		<Field
			field={fields.condition}
			type="select"
			label={m.actions_report_damage_how_bad_label()}
			options={[
				{ value: '', label: m.actions_report_damage_not_sure_label() },
				{ value: 'fair', label: m.actions_report_damage_still_usable_but_not_right_label() },
				{ value: 'poor', label: m.actions_report_damage_should_not_used_label() }
			]}
		/>
	{/snippet}
</Action>
