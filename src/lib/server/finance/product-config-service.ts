// Pricing config for Stripe products, stored in Cloudflare KV.
//
// Each product is persisted as a JSON object under the `product-config:` prefix:
//   { stripeProductId, name, description, unitAmountCents, unitLabel }
//
// Stripe products are created lazily and their IDs cached back into KV. Stable
// Stripe product IDs matter — subscription line items are matched by product ID
// (see subscription-service.ts) — so getStripeProductId reuses an existing
// product tagged with `metadata.corvmc_key` before creating a new one. That keeps
// IDs stable across an empty-KV cutover without a data-port step.
import type Stripe from 'stripe';
import { getJson, putJson } from '$lib/server/kv';
import { stripe } from '$lib/server/stripe';
import type { CheckoutLineItem } from './payment-service';

const KV_PREFIX = 'product-config:';

// ---------------------------------------------------------------------------
// Product config defaults — used when no KV entry exists yet
// ---------------------------------------------------------------------------

export type ProductKey =
	'contribution' | 'fee_coverage' | 'ticket' | 'ticket_contribution' | 'band_premium';

interface ProductDefault {
	name: string;
	description: string;
	unitAmountCents: number;
	unitLabel: string;
}

const DEFAULTS: Record<ProductKey, ProductDefault> = {
	contribution: {
		name: 'Monthly Contribution',
		description: 'Recurring membership contribution to the Corvallis Music Collective',
		unitAmountCents: 500,
		unitLabel: 'per unit/month'
	},
	fee_coverage: {
		name: 'Processing Fee Coverage',
		description: 'Optional fee to cover payment processing costs',
		unitAmountCents: 0,
		unitLabel: 'per transaction'
	},
	ticket: {
		name: 'Event Ticket',
		description: 'Ticket for a Corvallis Music Collective event',
		unitAmountCents: 0,
		unitLabel: 'per ticket'
	},
	// Its own product, deliberately not folded into `ticket` or `contribution`:
	// gifts on a show stay separable from ticket revenue and from recurring
	// membership contributions in Stripe reporting.
	ticket_contribution: {
		name: 'Show Support',
		description: 'Optional contribution to the band and the venue on top of a ticket',
		unitAmountCents: 0,
		unitLabel: 'per order'
	},
	band_premium: {
		name: 'Band Premium Page',
		description: 'Premium band website with block editor, EPK, and a custom domain',
		// $5/mo. The launch price, deliberately low: this is an upsell to bands who
		// already have a free directory profile, and it has never been switched on.
		// Staff Settings → Pricing is the way to change it — and note that
		// `getProductConfig` persists this default on first read, so an environment
		// that has already read it keeps its stored value and is unaffected by
		// editing this line.
		unitAmountCents: 500,
		unitLabel: 'per month'
	}
};

const PRODUCT_KEYS = Object.keys(DEFAULTS) as ProductKey[];

// ---------------------------------------------------------------------------
// Core access
// ---------------------------------------------------------------------------

export interface ProductConfigRow {
	key: string;
	stripeProductId: string | null;
	name: string;
	description: string | null;
	unitAmountCents: number;
	unitLabel: string | null;
}

/** The shape persisted in KV (the key is encoded in the KV key, not the value). */
type StoredProduct = Omit<ProductConfigRow, 'key'>;

function defaultRow(key: ProductKey): ProductConfigRow {
	const d = DEFAULTS[key];
	return {
		key,
		stripeProductId: null,
		name: d.name,
		description: d.description,
		unitAmountCents: d.unitAmountCents,
		unitLabel: d.unitLabel
	};
}

async function readStored(key: ProductKey): Promise<StoredProduct | null> {
	return getJson<StoredProduct>(`${KV_PREFIX}${key}`);
}

async function writeRow(row: ProductConfigRow): Promise<void> {
	const { stripeProductId, name, description, unitAmountCents, unitLabel } = row;
	await putJson<StoredProduct>(`${KV_PREFIX}${row.key}`, {
		stripeProductId,
		name,
		description,
		unitAmountCents,
		unitLabel
	});
}

/**
 * Get a product config, seeding it from defaults (and persisting) if absent.
 */
export async function getProductConfig(key: ProductKey): Promise<ProductConfigRow> {
	const stored = await readStored(key);
	if (stored) return { key, ...stored };

	const row = defaultRow(key);
	await writeRow(row);
	return row;
}

/**
 * Get all product configs, seeding any missing ones from defaults.
 */
export async function getAllProductConfigs(): Promise<ProductConfigRow[]> {
	const configs: ProductConfigRow[] = [];
	for (const key of PRODUCT_KEYS) {
		configs.push(await getProductConfig(key));
	}
	return configs;
}

// ---------------------------------------------------------------------------
// Stripe product auto-creation
// ---------------------------------------------------------------------------

/**
 * Find an existing Stripe product previously created for this key (tagged via
 * `metadata.corvmc_key`). Lets the cutover reuse products even when KV is empty.
 */
async function findStripeProductByKey(key: ProductKey): Promise<string | null> {
	const list = await stripe.products.list({ active: true, limit: 100 });
	const found = list.data.find((p) => p.metadata?.corvmc_key === key);
	return found?.id ?? null;
}

/**
 * Get the Stripe product ID for a product key, reusing an existing tagged
 * product or creating one, then caching the ID in KV.
 */
export async function getStripeProductId(key: ProductKey): Promise<string> {
	const config = await getProductConfig(key);
	if (config.stripeProductId) return config.stripeProductId;

	let productId = await findStripeProductByKey(key);
	if (!productId) {
		const product = await stripe.products.create({
			name: config.name,
			...(config.description && { description: config.description }),
			metadata: { corvmc_key: key }
		});
		productId = product.id;
	}

	await writeRow({ ...config, stripeProductId: productId });
	return productId;
}

// ---------------------------------------------------------------------------
// Line item builders
// ---------------------------------------------------------------------------

/**
 * Build a checkout line item for a one-time charge using inline pricing.
 */
export async function buildLineItem(
	key: ProductKey,
	unitAmountCents: number,
	quantity: number
): Promise<CheckoutLineItem> {
	const productId = await getStripeProductId(key);

	return {
		price_data: {
			currency: 'usd',
			product: productId,
			unit_amount: unitAmountCents
		},
		quantity
	};
}

/**
 * Build a checkout line item for a recurring subscription using inline pricing.
 */
export async function buildSubscriptionLineItem(
	key: ProductKey,
	unitAmountCents: number,
	quantity: number,
	interval: Stripe.PriceCreateParams.Recurring.Interval = 'month'
): Promise<CheckoutLineItem> {
	const productId = await getStripeProductId(key);

	return {
		price_data: {
			currency: 'usd',
			product: productId,
			unit_amount: unitAmountCents,
			recurring: { interval }
		},
		quantity
	};
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

export interface UpdateProductConfigInput {
	name?: string;
	description?: string | null;
	unitAmountCents?: number;
}

/**
 * Update a product config. If the name or description changed and a Stripe
 * product exists, sync the changes to Stripe.
 */
export async function updateProductConfig(
	key: ProductKey,
	input: UpdateProductConfigInput
): Promise<ProductConfigRow> {
	const current = await getProductConfig(key);

	const updated: ProductConfigRow = {
		...current,
		...(input.name !== undefined && { name: input.name }),
		...(input.description !== undefined && { description: input.description }),
		...(input.unitAmountCents !== undefined && { unitAmountCents: input.unitAmountCents })
	};

	await writeRow(updated);

	// Sync name/description to Stripe if the product exists
	if (current.stripeProductId) {
		const stripeUpdates: Record<string, string> = {};
		if (input.name !== undefined && input.name !== current.name) {
			stripeUpdates.name = input.name;
		}
		if (input.description !== undefined && input.description !== current.description) {
			stripeUpdates.description = input.description ?? '';
		}

		if (Object.keys(stripeUpdates).length > 0) {
			await stripe.products.update(current.stripeProductId, stripeUpdates);
		}
	}

	return updated;
}
