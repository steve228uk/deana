import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type GenomeBuild = "GRCh37" | "GRCh38";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = path.join(repoRoot, ".evidence-cache", "dbsnp");

const sources: Record<GenomeBuild, { url: string; fileName: string }> = {
  GRCh37: {
    url: "https://ftp.ncbi.nlm.nih.gov/refseq/H_sapiens/annotation/GRCh37_latest/refseq_identifiers/GRCh37_latest_dbSNP_all.vcf.gz",
    fileName: "dbsnp.vcf.gz",
  },
  GRCh38: {
    url: "https://ftp.ncbi.nlm.nih.gov/refseq/H_sapiens/annotation/GRCh38_latest/refseq_identifiers/GRCh38_latest_dbSNP_all.vcf.gz",
    fileName: "dbsnp.vcf.gz",
  },
};

interface Options {
  force: boolean;
  dryRun: boolean;
  index: boolean;
  builds: GenomeBuild[];
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    force: false,
    dryRun: false,
    index: false,
    builds: ["GRCh37", "GRCh38"],
  };

  for (const arg of argv) {
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--index") {
      options.index = true;
      continue;
    }
    if (arg.startsWith("--build=")) {
      const build = arg.slice("--build=".length);
      if (build !== "GRCh37" && build !== "GRCh38") {
        throw new Error(`Unsupported dbSNP build: ${build}`);
      }
      options.builds = [build];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed with exit ${code}`));
      }
    });
  });
}

async function download(build: GenomeBuild, force: boolean, dryRun: boolean, index: boolean): Promise<void> {
  const source = sources[build];
  const targetDir = path.join(cacheRoot, build);
  const targetPath = path.join(targetDir, source.fileName);
  const completePath = `${targetPath}.complete`;
  await mkdir(targetDir, { recursive: true });

  if (!force && existsSync(targetPath) && existsSync(completePath)) {
    console.log(`${build} dbSNP VCF cached at ${path.relative(repoRoot, targetPath)}`);
  } else if (dryRun) {
    console.log(`${existsSync(targetPath) ? "Would resume" : "Would download"} ${build} dbSNP VCF to ${path.relative(repoRoot, targetPath)}`);
  } else {
    console.log(`${existsSync(targetPath) ? "Resuming" : "Downloading"} ${build} dbSNP VCF to ${path.relative(repoRoot, targetPath)}`);
    await run("curl", ["-L", "--fail", "--continue-at", "-", "--output", targetPath, source.url]);
    await Bun.write(completePath, `${new Date().toISOString()}\n`);
  }

  if (!index) {
    return;
  }

  const indexPath = `${targetPath}.tbi`;
  if (!force && existsSync(indexPath)) {
    console.log(`${build} dbSNP tabix index cached at ${path.relative(repoRoot, indexPath)}`);
    return;
  }
  if (dryRun) {
    console.log(`Would create ${build} dbSNP tabix index at ${path.relative(repoRoot, indexPath)}`);
    return;
  }

  console.log(`Creating ${build} dbSNP tabix index at ${path.relative(repoRoot, indexPath)}`);
  await run("tabix", ["-f", "-p", "vcf", targetPath]);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  for (const build of options.builds) {
    await download(build, options.force, options.dryRun, options.index);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
