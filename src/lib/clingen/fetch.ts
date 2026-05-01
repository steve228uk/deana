export async function fetchText(url: string, accept: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      Accept: accept,
      "User-Agent": "Mozilla/5.0 (compatible; deana-evidence-sync/1.0; +https://github.com/steve228uk/deana)",
    },
  });

  if (!res.ok) {
    throw new Error(`ClinGen fetch failed for ${url}: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    throw new Error(
      `ClinGen returned HTML instead of source data for ${url}. First 200 chars:\n${text.slice(0, 200)}`,
    );
  }

  return text;
}

export async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; deana-evidence-sync/1.0; +https://github.com/steve228uk/deana)",
    },
  });

  if (!res.ok) {
    throw new Error(`ClinGen fetch failed for ${url}: ${res.status} ${res.statusText}`);
  }

  return await res.json();
}
