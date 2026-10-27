import { getContext, hasContext, setContext } from 'svelte';

/**
 * Whether the viewer is signed in, for controls that interrupt to sign-in
 * (#1999) without a server round trip. Provided by a layout that already knows
 * (`SignedInProvider`); undefined where none does, and a control then behaves
 * normally — the remote's 401 is still caught by `Form`.
 */
const KEY = Symbol('signed-in');

export function provideSignedIn(get: () => boolean): void {
	setContext(KEY, get);
}

export function signedIn(): (() => boolean) | undefined {
	return hasContext(KEY) ? getContext<() => boolean>(KEY) : undefined;
}
