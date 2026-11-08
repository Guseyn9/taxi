/** Missing identities must never match each other or an authenticated user. */
export function sameUser(first: unknown, second: unknown): boolean {
  if (first === undefined || first === null || second === undefined || second === null) return false
  const a = String(first).trim(), b = String(second).trim()
  return a !== '' && b !== '' && a === b
}
/** Each record is a complete alternative identity, not another name fragment. */
export function participantName(...sources: ({ u_name?: unknown, u_family?: unknown } | null | undefined)[]): string {
  for (const source of sources) {
    const name = [source?.u_name, source?.u_family].filter(value => typeof value === 'string' && value.trim()).join(' ').trim()
    if (name) return name
  }
  return ''
}
