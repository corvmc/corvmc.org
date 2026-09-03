import { z } from 'zod';
import { invalid } from '@sveltejs/kit';
import { form } from '$app/server';
import { mapDomainError } from '$lib/server/errors';
import { requireGroupRole } from '$lib/server/group/group-context';
import { DOCUMENT_DESCRIPTION_MAX } from '$lib/config';
import { validatePrivateUpload } from '$lib/server/private-storage';
import { remove, upload } from '$lib/server/group/file-service';

/**
 * Group documents — the two writes.
 *
 * The **download** is not here: it returns a stream rather than JSON, so it is
 * `/api/files/[id]`, which authorizes against the file's own stored group. The
 * spec's routes table listed a `DELETE` verb beside that `GET` only because the
 * `GET` was already in it; a remote form is what the repo's own rules ask for
 * (`$lib/components/ui/Form/`, never a hand-built `fetch`), and a `form()` does
 * carry a `File` — `band-events.remote.ts` has shipped one for months.
 *
 * There is deliberately **no `getGroupFiles(groupId)` query**. The club page
 * already awaits `getMemberGroup`, which returns its documents with everything
 * else in one round trip, and a component fetching its own list is exactly the
 * fan-out `custom/no-concurrent-remote-queries` exists to stop. `DocumentList`
 * takes its files as a prop and refreshes through `invalidateAll()`.
 *
 * Both guards take an explicit `{ id }` ref. A remote function's `params`
 * describe the *calling page* and are client-manipulable, so nothing here reads
 * one.
 */

const groupIdField = z.string().min(1);

/**
 * `admin`, and **without** `allowStaff`.
 *
 * Reads admit a staff non-member because a staff member looking at a program
 * needs to see it. Putting a document into a group's shared folder in its name
 * is a different act, and one CMC staff should do as a member of that group or
 * not at all — the same line `requireAuthor` draws for announcements.
 */
async function requireUploader(groupId: string) {
	return requireGroupRole({ id: groupId }, 'admin');
}

export const uploadDocument = form(
	z.object({
		groupId: groupIdField,
		file: z.instanceof(File),
		description: z.string().max(DOCUMENT_DESCRIPTION_MAX).optional()
	}),
	async (data, issue) => {
		const { user, group } = await requireUploader(data.groupId);

		// An empty file input still posts a zero-byte `File`, which would otherwise
		// reach the service as a valid upload of nothing.
		if (!data.file || data.file.size === 0) {
			invalid(issue.file('Choose a file to upload.'));
		}

		// Checked here as well as in the service, so type and size land on the
		// field rather than arriving as a toast. The service's copy is the one
		// that actually guards — a second caller must not be able to skip it.
		const reason = validatePrivateUpload(data.file);
		if (reason) invalid(issue.file(reason));

		try {
			await upload(group.id, user.id, { file: data.file, description: data.description });
		} catch (err) {
			// Quota and the band refusal are 422s, not faults.
			mapDomainError(err);
		}

		return { success: true };
	}
);

export const deleteDocument = form(
	z.object({ groupId: groupIdField, id: z.string().min(1) }),
	async (data) => {
		const { group } = await requireUploader(data.groupId);

		try {
			// `group.id` from the resolved group, not `data.groupId` — the guard
			// already proved this caller administers *that* group, and the service
			// scopes the row to it.
			await remove(data.id, group.id);
		} catch (err) {
			mapDomainError(err);
		}

		return { success: true };
	}
);
