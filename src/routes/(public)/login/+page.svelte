<script lang="ts">
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import CardTitle from '$lib/components/shared/Card/CardTitle.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { pageTitle } from '$lib/config';
	import { IconEye, IconEyeOff } from '@tabler/icons-svelte';
	import { Turnstile } from 'svelte-turnstile';
	import Form, { Field, SubmitButton } from '$lib/components/shared/Form';
	import ErrorToastBoundary from '$lib/components/shared/ErrorToastBoundary.svelte';
	import { getMe } from '$lib/remote/layout.remote';
	import { TURNSTILE_SITE_KEY } from '$lib/turnstile';
	import Alert from '$lib/components/shared/Alert.svelte';

	// Deliberately NOT `await getMe()`. A top-level await puts the whole template
	// behind an async boundary, and on a direct load of ?register that stops the
	// Turnstile widget from ever mounting — signup then fails with "Verification
	// failed" because no token is produced. Reading `.current` keeps the redirect
	// check without gating the markup.
	const me = getMe();
	$effect(() => {
		if (me.current) goto(resolve('/member'));
	});

	let inviteToken = $derived(page.url.searchParams.get('invite'));
	let inviteMeta = $state<{
		bandName: string;
		inviterName: string;
		role: string;
		email: string;
	} | null>(null);

	// Mode lives in the URL, not in local state, so a refresh or a shared link
	// keeps whichever form the visitor was on. An invite always implies register.
	let mode = $derived<'login' | 'register'>(
		page.url.searchParams.has('invite') || page.url.searchParams.has('register')
			? 'register'
			: 'login'
	);
	let error = $state('');
	let showPassword = $state(false);
	let turnstileToken = $state('');
	let resetTurnstile = $state<() => void>();

	/** Same-page href for the other mode, preserving `redirect` and `invite`. */
	function modeHref(target: 'login' | 'register') {
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.delete('register');
		const rest = params.toString();
		const query =
			target === 'register' ? (rest ? `?register&${rest}` : '?register') : rest ? `?${rest}` : '';
		return `${resolve('/login')}${query}`;
	}

	function toggleMode() {
		error = '';
		goto(modeHref(mode === 'login' ? 'register' : 'login'), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	$effect(() => {
		if (inviteToken) {
			fetch(`/api/invites/${inviteToken}`)
				.then((r) => (r.ok ? r.json() : null))
				.then((data) => {
					inviteMeta = data as typeof inviteMeta;
				});
		}
	});

	async function handleSubmit(data: FormData) {
		error = '';
		const endpoint = mode === 'login' ? '/api/auth/sign-in/email' : '/api/auth/sign-up/email';

		const body: Record<string, string> = {
			email: data.get('email') as string,
			password: data.get('password') as string
		};
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (mode === 'register') {
			body.name = data.get('name') as string;
			headers['x-turnstile-token'] = turnstileToken;
		}

		const res = await fetch(endpoint, {
			method: 'POST',
			headers,
			body: JSON.stringify(body)
		});

		if (!res.ok) {
			if (mode === 'register') resetTurnstile?.();
			const body = (await res.json().catch(() => null)) as { message?: string } | null;
			error =
				mode === 'login'
					? 'Invalid email or password.'
					: (body?.message ?? 'Registration failed. Please try again.');
			// Throw so the Form shows its error state, but carry the HTTP status so
			// `reportError`'s `isExpected` check drops these 4xx auth failures instead
			// of logging every bad password to Sentry. A 5xx still reports as a bug.
			throw Object.assign(new Error(error), { status: res.status });
		}

		const redirectTo = new URLSearchParams(window.location.search).get('redirect') ?? '/member';
		await goto(redirectTo, { invalidateAll: true });
	}
</script>

<svelte:head>
	<title>{pageTitle(mode === 'login' ? 'Sign in' : 'Create account')}</title>
</svelte:head>

<!--
	The only page under (public) that deliberately does NOT server-render its
	content. A boundary with a pending snippet renders that snippet during SSR
	instead of its contents, so this keeps the sign-in form out of the initial
	HTML and back to mounting client-side, the way the whole public site behaved
	before it started server-rendering.

	Why only here: a server-rendered form is interactive before its JS lands, and
	on this page that window is a credential path — an early submit left the
	password in a `?password=` query string and never signed the user in (an
	intermittent CI failure waiting for /member). Form.svelte's `method="post"`
	and SubmitButton's disabled-until-hydrated guard both narrow that window
	everywhere; this closes it outright on the one form where the cost of losing
	the race is a leaked credential. Nothing is given up for it — the page is a
	form, with no content a crawler or link preview would want.
-->
<ErrorToastBoundary>
	<div class="flex items-center justify-center py-16 px-4">
		<div class="w-full max-w-sm">
			<div class="card shadow-xl surface">
				<CardBody class="gap-4">
					{#if inviteMeta}
						<Alert type="info" class="text-sm">
							<span
								><strong>{inviteMeta.inviterName}</strong> invited you to join
								<strong>{inviteMeta.bandName}</strong>. Create an account to get started.</span
							>
						</Alert>
					{/if}

					<CardTitle size="lg" level={2} class="justify-center">
						{mode === 'login' ? 'Sign in to your account' : 'Create your account'}
					</CardTitle>

					{#if error}
						<Alert type="error" class="text-sm">
							{error}
						</Alert>
					{/if}

					<Form action={handleSubmit} class="flex flex-col gap-3">
						{#if mode === 'register'}
							<Field name="name" type="text" label="Name" />
						{/if}
						<Field name="email" type="email" label="Email" value={inviteMeta?.email ?? ''} />
						<Field
							name="password"
							type={showPassword ? 'text' : 'password'}
							label="Password"
							minlength={mode === 'register' ? 8 : undefined}
						>
							{#snippet input(id)}
								<div class="relative">
									<input
										{id}
										name="password"
										type={showPassword ? 'text' : 'password'}
										class="input w-full pr-10"
										minlength={mode === 'register' ? 8 : undefined}
									/>
									<Button
										type="button"
										variant="ghost"
										size="xs"
										shape="square"
										class="absolute right-2 top-1/2 -translate-y-1/2"
										onclick={() => (showPassword = !showPassword)}
										tabindex={-1}
									>
										{#if showPassword}
											<IconEyeOff size={16} />
										{:else}
											<IconEye size={16} />
										{/if}
									</Button>
								</div>
							{/snippet}
						</Field>
						{#if mode === 'register'}
							<Turnstile
								siteKey={TURNSTILE_SITE_KEY}
								theme="auto"
								bind:reset={resetTurnstile}
								on:callback={(e) => (turnstileToken = e.detail.token)}
								on:expired={() => (turnstileToken = '')}
							/>
						{/if}
						<SubmitButton
							label={mode === 'login' ? 'Sign in' : 'Create account'}
							variant="primary"
							class="w-full mt-1"
						/>
					</Form>

					<div class="divider my-0 text-xs">OR</div>

					<Button variant="ghost" size="sm" onclick={toggleMode}>
						{mode === 'login'
							? "Don't have an account? Sign up"
							: 'Already have an account? Sign in'}
					</Button>
				</CardBody>
			</div>
		</div>
	</div>
</ErrorToastBoundary>
