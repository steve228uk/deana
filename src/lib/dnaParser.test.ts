import { gzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseDnaBytes, parseDnaText } from "./dnaParser";

const nebulaLikeVcf = [
  "##fileformat=VCFv4.2",
  "##source=Nebula Genomics",
  "##reference=file:///reference/GRCh38.fna",
  "##contig=<ID=chr1,length=248956422>",
  "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE",
  "chr1\t101\trs111\tA\tG\t.\tPASS\t.\tGT:AD:DP:GQ:PL\t0/1:7,8:15:99:1,2,3",
  "chr2\t202\trs222\tC\tT\t.\tPASS\t.\tGT:AD:DP:GQ:PL\t1/1:0,20:20:99:1,2,3",
  "chr3\t303\trs333\tG\tA,T\t.\tPASS\t.\tGT:AD:DP:GQ:PL\t2/1:0,9,8:17:99:1,2,3",
  "chr4\t404\trs444\tT\tC\t.\tPASS\t.\tGT:AD:DP:GQ:PL\t1/0:5,5:10:99:1,2,3",
  "chr5\t505\trs555\tA\tC\t.\tPASS\t.\tGT:AD:DP:GQ:PL\t0|1:4,6:10:99:1,2,3",
  "chr6\t606\trs666\tA\tC\t.\tPASS\t.\tGT:AD:DP:GQ:PL\t0/0:10,0:10:99:1,2,3",
].join("\n");

describe("dnaParser", () => {
  it("parses Nebula-like VCF rows into compact markers", () => {
    const parsed = parseDnaText("nebula.vcf", nebulaLikeVcf, "text");

    expect(parsed.provider).toBe("Nebula Genomics");
    expect(parsed.build).toBe("GRCh38");
    expect(parsed.fileName).toBe("nebula.vcf");
    expect(parsed.markerCount).toBe(6);
    expect(parsed.markers).toEqual([
      ["rs111", "1", 101, "AG"],
      ["rs222", "2", 202, "TT"],
      ["rs333", "3", 303, "AT"],
      ["rs444", "4", 404, "TC"],
      ["rs555", "5", 505, "AC"],
      ["rs666", "6", 606, "AA"],
    ]);
  });

  it("decodes gzip-compressed VCF files", () => {
    const bytes = gzipSync(new TextEncoder().encode(nebulaLikeVcf));
    const parsed = parseDnaBytes("nebula.vcf.gz", bytes);

    expect(parsed.importedFrom).toBe("gzip");
    expect(parsed.fileName).toBe("nebula.vcf");
    expect(parsed.markerCount).toBe(6);
    expect(parsed.markers[0]).toEqual(["rs111", "1", 101, "AG"]);
  });

  it("skips VCF rows that cannot become rsID single-nucleotide genotypes", () => {
    const vcf = [
      "##fileformat=VCFv4.2",
      "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE",
      "chr1\t101\t.\tA\tG\t.\tPASS\t.\tGT\t0/1",
      "chr1\t102\trs102\tA\tAT\t.\tPASS\t.\tGT\t0/1",
      "chr1\t103\trs103\tA\tG\t.\tPASS\t.\tGT\t./.",
      "chr1\t104\trs104\tA\t<NON_REF>\t.\tPASS\t.\tGT\t0/1",
      "chr1\t105\trs105\tA\tG\t.\tPASS\t.\tAD:DP\t1,2:3",
      "chr1\t106\trs106\tC\tT\t.\tPASS\t.\tGT\t0/1",
    ].join("\n");

    const parsed = parseDnaText("generic.vcf", vcf, "text");

    expect(parsed.provider).toBe("VCF");
    expect(parsed.markers).toEqual([["rs106", "1", 106, "CT"]]);
  });

  it("explains valid VCFs that lack rsID identifiers", () => {
    const vcf = [
      "##fileformat=VCFv4.2",
      "##reference=gi|251831106|ref|NC_012920.1| Homo sapiens mitochondrion, complete genome",
      "##contig=<ID=MT,length=16569,assembly=b37>",
      "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tHG00096\tHG00097",
      "MT\t73\t.\tA\tG\t.\tPASS\t.\tGT\t0\t1",
      "MT\t150\t.\tC\tT\t.\tPASS\t.\tGT\t0\t0",
    ].join("\n");

    expect(() => parseDnaText("ALL.chrMT.phase3.vcf", vcf, "text")).toThrow(
      "variant rows do not contain rsID identifiers",
    );
  });

  it("keeps existing tabular genotype parsing behavior", () => {
    const text = [
      "# 23andMe raw data",
      "rsid\tchromosome\tposition\tgenotype",
      "RS429358\t19\t45411941\tCT",
      "rs7412\t19\t45412079\tCC",
    ].join("\n");

    const parsed = parseDnaText("23andme.txt", text, "text");

    expect(parsed.provider).toBe("23andMe");
    expect(parsed.build).toBe("Unknown");
    expect(parsed.markers).toEqual([
      ["rs429358", "19", 45411941, "CT"],
      ["rs7412", "19", 45412079, "CC"],
    ]);
  });
});
