/** Convert API/Axios error payloads into safe React text children. */
export function getReadableErrorMessage(error, fallback = 'Something went wrong.') {
  const seen = new Set();
  const read = (value, depth = 0) => {
    if (depth > 5 || value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value !== 'object' || seen.has(value)) return '';
    seen.add(value);
    if (Array.isArray(value)) return value.map(item => read(item, depth + 1)).filter(Boolean).join(', ');
    for (const candidate of [value.response?.data?.message, value.data?.message, value.message, value.error?.message, value.error, value.details?.message, value.code]) {
      const message = read(candidate, depth + 1);
      if (message) return message;
    }
    return '';
  };
  return read(error) || fallback;
}
