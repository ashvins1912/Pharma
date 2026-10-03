const STATUS_MESSAGES = {
  401: 'Your session has expired. Please sign in again.',
  403: 'You do not have permission to do that.',
  404: 'The requested item could not be found.',
  408: 'The request took too long. Please try again.',
  409: 'This information changed. Refresh and try again.',
  422: 'Please check the information and try again.',
  429: 'Too many attempts. Please wait a moment and try again.',
  500: 'Something went wrong. Please try again in a moment.',
  502: 'The service is temporarily unavailable. Please try again.',
  503: 'The service is temporarily unavailable. Please try again.',
  504: 'The service took too long to respond. Please try again.'
};

export class ApiError extends Error {
  constructor({ status = 0, code = 'UNKNOWN_ERROR', requestId = null, retryable = false, message }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryable = retryable;
  }
}

export function normalizeApiError(error) {
  if (error instanceof ApiError) return error;
  const response = error?.response;
  const status = Number(response?.status || 0);
  const body = response?.data;
  const contentType = String(response?.headers?.['content-type'] || '').toLowerCase();
  const bodyCode = body?.error?.code || body?.code || body?.errorCode;
  const infrastructure404 = status === 404 && (
    contentType.includes('text/html')
    || (typeof body === 'string' && /<!doctype|<html|cannot (get|post|put|delete)/i.test(body))
    || (!bodyCode && !/not found|does not exist|no .+ found|cannot find/i.test(String(body?.message || '')))
  );
  const code = infrastructure404 ? 'SERVICE_UNAVAILABLE'
    : bodyCode || ({ 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 408: 'TIMEOUT', 409: 'CONFLICT', 422: 'VALIDATION_ERROR', 429: 'RATE_LIMITED', 500: 'INTERNAL_ERROR', 502: 'UPSTREAM_ERROR', 503: 'SERVICE_UNAVAILABLE', 504: 'TIMEOUT' }[status])
      || (['ECONNABORTED', 'ETIMEDOUT'].includes(error?.code) ? 'TIMEOUT' : error?.request ? 'NETWORK_ERROR' : 'UNKNOWN_ERROR');
  const message = infrastructure404 ? STATUS_MESSAGES[503]
    : status === 0 ? (['ECONNABORTED', 'ETIMEDOUT'].includes(error?.code) ? STATUS_MESSAGES[408] : error?.request ? 'Unable to connect to the service. Check your connection and try again.' : 'Something went wrong. Please try again in a moment.')
      : STATUS_MESSAGES[status] || 'Something went wrong. Please try again in a moment.';
  return new ApiError({
    status: infrastructure404 ? 503 : status,
    code,
    requestId: response?.headers?.['x-request-id'] || body?.error?.requestId || body?.requestId || null,
    retryable: infrastructure404 || status === 408 || status === 429 || status >= 500 || !response,
    message
  });
}

export function friendlyAuthError(error, action = 'login') {
  const status = Number(error?.status || error?.response?.status || 0);
  if ((status === 401 || /invalid.*(credential|password)|invalid login/i.test(String(error?.message || ''))) && ['login', 'signup'].includes(action)) {
    return 'Email or password is incorrect.';
  }
  if (status === 429) return STATUS_MESSAGES[429];
  if (status === 503 || status >= 500) return `${action === 'login' ? 'Login' : 'Authentication'} service is temporarily unavailable. Please try again in a moment.`;
  if (!status && (error?.request || error?.code === 'ECONNABORTED' || error?.name === 'AuthRetryableFetchError')) {
    return 'Unable to connect to the server. Check your connection and try again.';
  }
  return action === 'login' ? 'Unable to sign in. Please check your details and try again.' : 'Authentication could not be completed. Please try again.';
}
