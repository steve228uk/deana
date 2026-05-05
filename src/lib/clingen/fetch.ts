const USER_AGENT =
  "Mozilla/5.0 (compatible; deana-evidence-sync/1.0; +https://github.com/DeanaDNA/deana)";

async function fetchClinGen(url: string, accept: string): Promise<Response> {
  const res = await fetch(url, {
    headers: {
      Accept: accept,
      "User-Agent": USER_AGENT,
    },
  });

  if (!res.ok) {
    throw new Error(`ClinGen fetch failed for ${url}: ${res.status} ${res.statusText}`);
  }

  return res;
}

export async function fetchText(url: string, accept: string): Promise<string> {
  const res = await fetchClinGen(url, accept);
  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    throw new Error(
      `ClinGen returned HTML instead of source data for ${url}. First 200 chars:\n${text.slice(0, 200)}`,
    );
  }

  return text;
}

export async function fetchHtml(url: string): Promise<string> {
  const res = await fetchClinGen(url, "text/html,*/*");
  return await res.text();
}

export async function fetchJson(url: string): Promise<unknown> {
  const res = await fetchClinGen(url, "application/json");
  return await res.json();
}
