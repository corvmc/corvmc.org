import type { PartyRef } from './activity-service';

/** One string per party, so organizations and people share a map without colliding. */
export const partyKey = (party: PartyRef): string => `${party.type}:${party.id}`;
