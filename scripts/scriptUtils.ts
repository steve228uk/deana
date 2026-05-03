import { createHash } from "node:crypto";

export interface ForceOptions {
  force: boolean;
}

export function parseForceOption(argv: string[]): ForceOptions {
  const options: ForceOptions = { force: false };
  for (const arg of argv) {
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function fileSha256(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const digest = createHash("sha256");
  const reader = file.stream().getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    digest.update(value);
  }
  return digest.digest("hex");
}

export function findZipTextEntry(
  entries: Record<string, Uint8Array>,
  namePattern: RegExp,
  errorMessage: string,
): Uint8Array {
  const match = Object.entries(entries).find(([name]) =>
    namePattern.test(name) && /\.(tsv|txt)$/i.test(name),
  );

  if (!match) {
    throw new Error(errorMessage);
  }

  return match[1];
}

export function findOptionalZipTextEntry(
  entries: Record<string, Uint8Array>,
  namePattern: RegExp,
): Uint8Array | null {
  const match = Object.entries(entries).find(([name]) =>
    namePattern.test(name) && /\.(tsv|txt)$/i.test(name),
  );
  return match ? match[1] : null;
}

export function runCli(importMetaUrl: string, main: () => Promise<void>): void {
  if (importMetaUrl !== `file://${process.argv[1]}`) return;

  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
