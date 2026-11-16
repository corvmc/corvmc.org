<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { toast } from 'svelte-sonner';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import { getFeatureFlags, updateFeatureFlag } from '#lib/remote/settings.remote.js';
	import type { FeatureFlag } from '#lib/server/feature-flags.js';
	import { switchState } from '../../section-state';
	import { featureMeta } from './feature-meta';

	const featureFlags = $derived(await getFeatureFlags());
</script>

<PageHeader
	width="2xl"
	title={m.staff_settings_features_title()}
	subtitle={m.staff_settings_enable_disable_feature_modules_members_body()}
/>

<PageContent width="2xl">
	<div class="space-y-4">
		{#each Object.entries(featureMeta) as [flag, meta] (flag)}
			{@const enabled = featureFlags[flag as FeatureFlag]}
			{@const toggleForm = updateFeatureFlag.for(flag)}
			<InfoCard title={meta.label} state={switchState(enabled)}>
				{#snippet action()}
					<Form
						remote={toggleForm}
						onsuccess={() => toast.success(`${meta.label} ${enabled ? 'disabled' : 'enabled'}`)}
					>
						<input {...toggleForm.fields.flag.as('hidden', flag)} />
						<input {...toggleForm.fields.enabled.as('hidden', enabled ? 'false' : 'true')} />
						<Button
							type="submit"
							variant={enabled ? 'error' : 'success'}
							outline={enabled}
							size="sm"
						>
							{enabled ? m.staff_settings_disable_label() : m.staff_settings_enable_label()}
						</Button>
					</Form>
				{/snippet}
				<p class="text-subtle">{meta.description}</p>
			</InfoCard>
		{/each}
	</div>
</PageContent>
