import { loadGroupRecord } from '../../groups/record.server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => loadGroupRecord('band', params.id);
