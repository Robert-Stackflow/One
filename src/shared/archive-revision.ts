// Legacy single-file identity, or a SHA-256 digest of the complete volume set's
// names and file identities. Neither token hashes the archive's file contents.
export function validArchiveRevision(value:unknown):value is string {
 return typeof value==='string'&&value.length<=256&&(/^[0-9]+(?::[0-9]+){6}$/.test(value)||/^v2:[0-9a-f]{64}$/.test(value));
}
