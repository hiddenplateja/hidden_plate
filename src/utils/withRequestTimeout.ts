/** RN 0.81 provides AbortController, but not AbortSignal.timeout(). */
export async function withRequestTimeout<T>(
  milliseconds: number,
  request: (signal: AbortSignal) => PromiseLike<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try {
    return await request(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
