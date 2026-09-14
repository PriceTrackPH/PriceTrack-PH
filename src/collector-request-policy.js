const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function withCollectorRetry(operation, policy = {}) {
  const attempts = Math.max(1, Number(policy.attempts) || 3);
  const delays = Array.isArray(policy.delays) ? policy.delays : [300, 900];
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (error?.retryable === false || attempt === attempts - 1) throw error;
      await pause(Math.max(0, Number(delays[attempt] ?? delays.at(-1) ?? 0)));
    }
  }
  throw lastError;
}
