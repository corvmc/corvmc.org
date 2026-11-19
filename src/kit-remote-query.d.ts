// Kit's client-side query internals, which the `client` vitest project aliases
// for src/remote-query-redirect.svelte.spec.ts. Kit ships no types for them.
declare module 'kit-remote-query' {
	export class Query<T> implements PromiseLike<T> {
		constructor(key: string, fn: () => Promise<unknown>);
		get loading(): boolean;
		set(value: T): void;
		then: PromiseLike<T>['then'];
	}
}

declare module 'kit-remote-shared' {
	/** What a query's fetch resolves with after following a redirect. */
	export const QUERY_REDIRECTED: unique symbol;
}
