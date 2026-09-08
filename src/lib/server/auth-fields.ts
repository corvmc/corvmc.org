/**
 * Extra `user` columns surfaced on the better-auth session user.
 *
 * Kept in its own dependency-free module (no `$env`, no DB) so it can be imported
 * by tests without pulling in the full auth/D1 graph.
 *
 * Do NOT add `fieldName` here. The drizzle adapter resolves each field by indexing
 * the drizzle schema model with this key, and our `user` table is keyed by the
 * camelCase property (e.g. `stripeId`, which drizzle itself maps to the `stripe_id`
 * column). A `fieldName: 'stripe_id'` makes the adapter look up
 * `schemaModel['stripe_id']` → undefined → the field is silently dropped from the
 * session (the "No billing account found" bug). drizzle owns the column-name
 * mapping, so the property key is all better-auth needs.
 * See auth.additional-fields.spec.ts.
 */
export const userAdditionalFields = {
	pronouns: { type: 'string', required: false },
	phone: { type: 'string', required: false },
	settings: { type: 'string', required: false },
	stripeId: { type: 'string', required: false },
	pmType: { type: 'string', required: false },
	pmLastFour: { type: 'string', required: false },
	subscription: { type: 'string', required: false },
	deletedAt: { type: 'date', required: false },
	dateOfBirth: { type: 'date', required: false }
} as const;
