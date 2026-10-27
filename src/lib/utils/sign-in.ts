import type { ResolvedPathname } from '$app/types';

/**
 * The sign-in interrupt (#1999): one way to send a visitor to `/login` and
 * bring them back to what they were doing. The return path is the only input
 * that leaves this app's control, so everything here funnels through
 * `safeReturnPath`.
 */

const PROBE_ORIGIN = 'https://return-path.invalid';

/**
 * A same-origin relative path, or null. Rejects absolute and protocol-relative
 * URLs, backslash tricks browsers normalise to `//`, `javascript:` and any
 * control character, by resolving against a dummy origin and requiring it back.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
	if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
	// eslint-disable-next-line no-control-regex -- the point is to refuse them
	if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null;
	let url: URL;
	try {
		url = new URL(raw, PROBE_ORIGIN);
	} catch {
		return null;
	}
	if (url.origin !== PROBE_ORIGIN) return null;
	// Returning to the sign-in page itself would loop.
	if (url.pathname === '/login') return null;
	return `${url.pathname}${url.search}${url.hash}`;
}

export interface SignInOptions {
	/** Where to come back to. Anything `safeReturnPath` refuses is dropped. */
	returnTo?: string | null;
	/** Open on the create-account form rather than sign in. */
	register?: boolean;
	/** What they were doing, in words: "RSVP to Spring Workshop". */
	intent?: string | null;
}

const MAX_INTENT = 120;

export function signInHref({ returnTo, register, intent }: SignInOptions = {}): ResolvedPathname {
	const params = new URLSearchParams();
	if (register) params.set('register', '');
	const back = safeReturnPath(returnTo);
	if (back) params.set('redirect', back);
	const label = intent?.trim().slice(0, MAX_INTENT);
	if (label) params.set('intent', label);
	const q = params.toString().replace(/^register=(&|$)/, 'register$1');
	return (q ? `/login?${q}` : '/login') as ResolvedPathname;
}

/** The current page as a return path, for an interrupt raised from it. */
export function here(url: URL): string {
	return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The interrupt for a remote's refusal: a 401 is "sign in first", so it maps
 * to the sign-in href with this page as the return. Anything else is null and
 * stays an error. Duck-typed, since a client-side `HttpError` crosses realms.
 */
export function signInInterruptFor(err: unknown, current: URL): ResolvedPathname | null {
	const status = (err as { status?: unknown } | null)?.status;
	if (status !== 401) return null;
	return signInHref({ returnTo: here(current) });
}

/**
 * What the sign-up request tells better-auth to put in the verification
 * link. The link redirects there once it verifies, so an intent survives the
 * inbox round trip; without it better-auth lands the member on `/`.
 */
export function verificationCallbackURL(redirect: string | null | undefined): string | undefined {
	return safeReturnPath(redirect) ?? undefined;
}
