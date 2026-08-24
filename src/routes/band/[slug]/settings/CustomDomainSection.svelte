<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import {
		setCustomDomain,
		refreshCustomDomain,
		removeCustomDomain
	} from '$lib/remote/band-custom-domain.remote';
	import type { getCustomDomain } from '$lib/remote/band-custom-domain.remote';
	import type { CustomDomainStatus } from '$lib/server/db/schema/band';
	import { bandSiteUrl } from '$lib/utils/band-site-url';
	import { env } from '$env/dynamic/public';

	// Resolved prop, not an awaited query — a top-level await here would mark the
	// fields.X.as() expressions below as async deriveds (see BandProfileForm).
	let { slug, domain }: { slug: string; domain: Awaited<ReturnType<typeof getCustomDomain>> } =
		$props();

	const setFields = setCustomDomain.fields;
	const refreshFields = refreshCustomDomain.fields;
	const removeFields = removeCustomDomain.fields;

	// The free address, shown as the fallback wherever a custom domain isn't in
	// play. Derived from PUBLIC_SITE_URL so dev and staging don't claim corvmc.org.
	const freeAddress = $derived(bandSiteUrl(slug, env.PUBLIC_SITE_URL).replace(/^https?:\/\//, ''));

	const statusVariant: Record<CustomDomainStatus, 'success' | 'warning' | 'error'> = {
		active: 'success',
		pending: 'warning',
		failed: 'error'
	};
	const statusLabel: Record<CustomDomainStatus, string> = {
		active: 'Live',
		pending: 'Waiting on DNS',
		failed: 'Failed'
	};
</script>

<section class="space-y-4">
	<div class="flex items-center gap-3">
		<h2 class="text-lg font-semibold">Custom Domain</h2>
		<!-- Only meaningful once a domain is actually connected — a stored status
		     with the feature switched off would read as a live domain. -->
		{#if domain.configured && domain.domain && domain.status}
			<Badge variant={statusVariant[domain.status]}>{statusLabel[domain.status]}</Badge>
		{/if}
	</div>

	{#if !domain.configured}
		<div class="alert">
			<p class="text-sm">
				Custom domains aren't set up on this site yet. Your band site is always available at
				<strong>{freeAddress}</strong>.
			</p>
		</div>
	{:else if domain.domain}
		<InfoCard title={domain.domain}>
			{#if domain.status === 'active'}
				<p class="text-sm">
					Your site is live at <strong>{domain.domain}</strong>. Point the domain at
					<code class="text-xs">{domain.cnameTarget}</code> with a CNAME record if you haven't already.
				</p>
			{:else if domain.status === 'failed'}
				<p class="text-sm">
					We couldn't verify this domain. Check the records below, or remove it and try again.
				</p>
			{:else}
				<p class="text-sm">
					Add these records at your domain registrar, then check the status. Verification usually
					takes a few minutes once the records are live.
				</p>
			{/if}

			{#if domain.verification && domain.status !== 'active'}
				<div class="overflow-x-auto mt-3">
					<table class="table table-sm">
						<thead>
							<tr><th>Type</th><th>Name</th><th>Value</th></tr>
						</thead>
						<tbody>
							{#if domain.verification.ownership}
								<tr>
									<td>TXT</td>
									<td class="font-mono text-xs break-all">{domain.verification.ownership.name}</td>
									<td class="font-mono text-xs break-all">{domain.verification.ownership.value}</td>
								</tr>
							{/if}
							{#if domain.verification.ssl}
								<tr>
									<td>TXT</td>
									<td class="font-mono text-xs break-all">{domain.verification.ssl.name}</td>
									<td class="font-mono text-xs break-all">{domain.verification.ssl.value}</td>
								</tr>
							{/if}
							<tr>
								<td>CNAME</td>
								<td class="font-mono text-xs break-all">{domain.domain}</td>
								<td class="font-mono text-xs break-all">{domain.verification.cnameTarget}</td>
							</tr>
						</tbody>
					</table>
				</div>
			{/if}

			<div class="flex flex-wrap justify-end gap-2 mt-4">
				{#if domain.status !== 'active'}
					<Form
						remote={refreshCustomDomain}
						onsuccess={() => {
							toast.success('Status updated');
							invalidateAll();
						}}
						onfailure={() => toast.error('Could not check the domain')}
					>
						<input {...refreshFields.slug.as('hidden', slug)} />
						<SubmitButton
							label="Check status"
							successLabel="Checked"
							variant="default"
							size="sm"
							outline
						/>
					</Form>
				{/if}
				<Form
					remote={removeCustomDomain}
					onsuccess={() => {
						toast.success('Custom domain removed');
						invalidateAll();
					}}
					onfailure={() => toast.error('Could not remove the domain')}
				>
					<input {...removeFields.slug.as('hidden', slug)} />
					<SubmitButton
						label="Remove"
						successLabel="Removed"
						variant="ghost"
						size="sm"
						class="text-error"
					/>
				</Form>
			</div>
		</InfoCard>
	{:else}
		<InfoCard title="Use your own domain">
			<p class="text-sm">
				Serve your band site from a domain you own. Your free address,
				<strong>{freeAddress}</strong>, keeps working either way.
			</p>
			<Form
				remote={setCustomDomain}
				onsuccess={() => {
					toast.success('Domain added — add the DNS records to finish');
					invalidateAll();
				}}
				onfailure={() => toast.error('Could not add that domain')}
			>
				<input {...setFields.slug.as('hidden', slug)} />
				<div class="mt-3 space-y-3">
					<FormField
						field={setFields.domain}
						type="text"
						label="Domain"
						placeholder="theband.com"
						description="Enter it without http:// — we'll give you the DNS records to add."
						required
					/>
					<div class="flex justify-end">
						<SubmitButton label="Add domain" successLabel="Added" variant="primary" size="sm" />
					</div>
				</div>
			</Form>
		</InfoCard>
	{/if}
</section>
