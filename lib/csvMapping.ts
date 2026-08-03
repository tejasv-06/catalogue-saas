export function normalizeKey(key: string) {
  return key
    .replace(/\(.*?\)/g, '')       // strip anything in parentheses, e.g. "(Product Type eg: Shirt)"
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')   // collapse any non-alphanumeric run (spaces, colons, etc.) into one underscore
    .replace(/^_+|_+$/g, '')       // trim leading/trailing underscores left behind
}

export function pick(row: Record<string, string>, ...candidates: string[]) {
  const normalized: Record<string, string> = {}
  for (const key of Object.keys(row)) {
    normalized[normalizeKey(key)] = row[key]
  }
  for (const candidate of candidates) {
    const value = normalized[normalizeKey(candidate)]
    if (value !== undefined && value.trim() !== '') {
      return value.trim()
    }
  }
  return null
}
