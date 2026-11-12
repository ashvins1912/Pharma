/** Convert unknown API/Axios failures into plain text safe for React children. */
export function getReadableErrorMessage(error, fallback = 'Something went wrong.') {
  const seen = new Set();

  const read = (value, depth = 0) => {
    if (depth > 8 || value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value !== 'object' || seen.has(value)) return '';

    seen.add(value);
    if (Array.isArray(value)) {
      return value.map(item => read(item, depth + 1)).filter(Boolean).join(', ');
    }

    // API payloads vary by service: support Axios envelopes, nested error
    // objects, validation details and common RFC-style problem fields.
    const candidates = [
      () => value.response?.data?.message,
      () => value.response?.data?.error,
      () => value.data?.message,
      () => value.data?.error,
      () => value.message,
      () => value.error?.message,
      () => value.error,
      () => value.details?.message,
      () => value.details,
      () => value.detail,
      () => value.errors,
      () => value.error_description,
      () => value.title,
      () => value.code
    ];

    for (const getCandidate of candidates) {
      try {
        const message = read(getCandidate(), depth + 1);
        if (message) return message;
      } catch {
        // Ignore hostile/throwing getters and continue to the next field.
      }
    }
    return '';
  };

  const safeFallback = typeof fallback === 'string' ? fallback : read(fallback) || 'Something went wrong.';
  try {
    return read(error) || safeFallback;
  } catch {
    return safeFallback;
  }
}
