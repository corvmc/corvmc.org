/**
 * Turning a submitted `File` into what the event creators take.
 *
 * Here rather than in one of the remotes because three of them need it and two
 * already carried byte-identical copies.
 */

/** An empty file input still posts a zero-byte `File`, which is not an upload. */
export function readPosterFile(file: File | undefined) {
	if (!file || file.size === 0) return undefined;
	return file;
}

export async function toPosterParam(file: File | undefined) {
	if (!file) return undefined;
	return { buffer: await file.arrayBuffer(), contentType: file.type };
}
