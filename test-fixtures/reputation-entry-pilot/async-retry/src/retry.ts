export async function retry<T>(
  operation: (attempt: number) => Promise<T>,
  maxRetries: number,
): Promise<T> {
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3) {
    throw new RangeError("maxRetries must be an integer from 0 through 3");
  }

  let lastError: unknown = new Error("operation was not attempted");
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
