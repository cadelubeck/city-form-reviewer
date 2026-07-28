export function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 25_000
) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
}
