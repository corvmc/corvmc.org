import { locators, type Locator } from 'vitest/browser';

/**
 * `getByCss`: a lazy, retrying locator for structure the role queries cannot
 * name — `button[type=submit]`, `[data-dialog-close]`, `input[name=…]` (#2189).
 * vitest's `Locator` has no typed `.locator(selector)`. Import this module for
 * its side effect in any browser spec that needs it.
 */
locators.extend({
	getByCss(selector: string) {
		return selector;
	}
});

declare module 'vitest/browser' {
	interface LocatorSelectors {
		getByCss(selector: string): Locator;
	}
}
