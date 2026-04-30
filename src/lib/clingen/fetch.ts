export async function fetchText(url: string, accept: string): Promise<string> {
  const res = await fetch(url, {
    headers: { Accept: accept },
  });

  if (!res.ok) {
    throw new Error(`ClinGen fetch failed for ${url}: ${res.status} ${res.statusText}`);
  }

  return await res.text();
}

export async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`ClinGen fetch failed for ${url}: ${res.status} ${res.statusText}`);
  }

  return await res.json();
}
