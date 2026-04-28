export async function fetchWithRetry<T>(url: string, init?: RequestInit): Promise<T> {
  const maxAttempts = 5;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response.json() as Promise<T>;

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable) throw new Error(`Request failed: ${response.status} ${response.statusText} — ${url}`);
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    if (attempt < maxAttempts) {
      const delay = 2000 * 2 ** (attempt - 1);
      console.warn(`Request failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay / 1000}s: ${lastError?.message}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
