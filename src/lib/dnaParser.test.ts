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

const gatkHaplotypeCallerVcf = [
  "##fileformat=VCFv4.2",
  "##ALT=<ID=NON_REF,Description=\"Represents any possible alternative allele at this location\">",
  "##GATKCommandLine.HaplotypeCaller=<ID=HaplotypeCaller,Version=3.8-1_MGI-6.2-0-g941feaa,CommandLineOptions=\"analysis_type=HaplotypeCaller input_file=[/mnt/ssd/MegaBOLT_scheduler/tmpDir/272/1/NG1JSQ3L76.mm2.sortdup.bqsr.bam]\">",
  "##INFO=<ID=DB,Number=0,Type=Flag,Description=\"dbSNP Membership\">",
  "##contig=<ID=chr1,length=248956422>",
  "##contig=<ID=chr19,length=58617616>",
  "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tNG1JSQ3L76",
  "chr1\t13273\trs531730856\tG\tC\t165.77\t.\tAC=1;AF=0.500;AN=2;DB;DP=19\tGT:AD:DP:GQ:PL\t0/1:9,9:18:99:194,0,201",
  "chr1\t13417\trs777038595\tC\tCGAGA\t286.73\t.\tAC=1;AF=0.500;AN=2;DB;DP=13\tGT:AD:DP:GQ:PL\t0/1:4,8:12:99:324,0,230",
  "chr1\t16298\trs2747966\tC\tT\t52.77\t.\tAC=1;AF=0.500;AN=2;DB;DP=46\tGT:AD:DP:GQ:PL\t0/1:40,5:45:81:81,0,1203",
  "chr1\t54712\trs1213680103\tTTTTCTTTC\tT,TTTTC\t590.73\t.\tAC=1,1;AF=0.500,0.500;AN=2;DB;DP=19\tGT:AD:DP:GQ:PL\t1/2:0,6,9:15:99:628,378,395,249,0,222",
  "chr19\t45411941\trs429358\tT\tC\t999\tPASS\tAC=1;AF=0.5\tGT:AD:DP:GQ:PL\t0/1:12,11:23:99:255,0,255",
  "chr1\t202\trs777;rs888\tA\tG,<NON_REF>\t999\tPASS\tAC=1;AF=0.5\tGT:AD:DP:GQ:PL\t0/1:8,7,0:15:99:255,0,255",
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

  it("parses plain GATK HaplotypeCaller VCF files", () => {
    const parsed = parseDnaText("NG1JSQ3L76.mm2.sortdup.bqsr.hc.vcf", gatkHaplotypeCallerVcf, "text");

    expect(parsed.provider).toBe("Nebula Genomics");
    expect(parsed.build).toBe("GRCh38");
    expect(parsed.markers).toEqual([
      ["rs531730856", "1", 13273, "GC"],
      ["rs2747966", "1", 16298, "CT"],
      ["rs429358", "19", 45411941, "TC"],
      ["rs777", "1", 202, "AG"],
      ["rs888", "1", 202, "AG"],
    ]);
  });

  it("decodes gzip-compressed HaplotypeCaller VCF files by content", () => {
    const bytes = gzipSync(new TextEncoder().encode(gatkHaplotypeCallerVcf));
    const parsed = parseDnaBytes("NG1JSQ3L76.mm2.sortdup.bqsr.hc.vcf.gz", bytes);

    expect(parsed.importedFrom).toBe("gzip");
    expect(parsed.fileName).toBe("NG1JSQ3L76.mm2.sortdup.bqsr.hc.vcf");
    expect(parsed.markers[0]).toEqual(["rs531730856", "1", 13273, "GC"]);
    expect(parsed.markers).toContainEqual(["rs429358", "19", 45411941, "TC"]);
  });

  it("decodes generic .gz files that contain VCF text", () => {
    const bytes = gzipSync(new TextEncoder().encode(gatkHaplotypeCallerVcf));
    const parsed = parseDnaBytes("NG1JSQ3L76.mm2.sortdup.bqsr.hc.gz", bytes);

    expect(parsed.importedFrom).toBe("gzip");
    expect(parsed.fileName).toBe("NG1JSQ3L76.mm2.sortdup.bqsr.hc");
    expect(parsed.markers[0]).toEqual(["rs531730856", "1", 13273, "GC"]);
    expect(parsed.provider).toBe("Nebula Genomics");
  });

  it("detects VCF after a byte order mark and leading whitespace", () => {
    const parsed = parseDnaText("export.gz", `\ufeff\n  ${gatkHaplotypeCallerVcf}`, "gzip");

    expect(parsed.provider).toBe("Nebula Genomics");
    expect(parsed.markers[0]).toEqual(["rs531730856", "1", 13273, "GC"]);
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

  it("parses 23andMe zip exports with a commented column header", () => {
    const bytes = Uint8Array.from([
      80, 75, 3, 4, 20, 0, 0, 0, 0, 0, 206, 148, 250, 86, 142, 22, 67, 199, 6, 1, 0, 0, 6, 1, 0,
      0, 45, 0, 0, 0, 103, 101, 110, 111, 109, 101, 95, 74, 97, 109, 101, 115, 95, 74, 111, 110,
      101, 115, 95, 118, 53, 95, 70, 117, 108, 108, 95, 50, 48, 50, 51, 48, 55, 50, 54, 49, 55,
      51, 56, 50, 56, 46, 116, 120, 116, 35, 32, 84, 104, 105, 115, 32, 100, 97, 116, 97, 32,
      102, 105, 108, 101, 32, 103, 101, 110, 101, 114, 97, 116, 101, 100, 32, 98, 121, 32, 50, 51,
      97, 110, 100, 77, 101, 32, 97, 116, 58, 32, 87, 101, 100, 32, 74, 117, 108, 32, 50, 54, 32,
      49, 55, 58, 51, 56, 58, 50, 56, 32, 50, 48, 50, 51, 10, 35, 10, 35, 32, 87, 101, 32, 97,
      114, 101, 32, 117, 115, 105, 110, 103, 32, 114, 101, 102, 101, 114, 101, 110, 99, 101, 32,
      104, 117, 109, 97, 110, 32, 97, 115, 115, 101, 109, 98, 108, 121, 32, 98, 117, 105, 108,
      100, 32, 51, 55, 32, 40, 97, 108, 115, 111, 32, 107, 110, 111, 119, 110, 32, 97, 115, 32,
      65, 110, 110, 111, 116, 97, 116, 105, 111, 110, 32, 82, 101, 108, 101, 97, 115, 101, 32,
      49, 48, 52, 41, 46, 10, 35, 10, 35, 32, 114, 115, 105, 100, 9, 99, 104, 114, 111, 109, 111,
      115, 111, 109, 101, 9, 112, 111, 115, 105, 116, 105, 111, 110, 9, 103, 101, 110, 111, 116,
      121, 112, 101, 10, 114, 115, 53, 52, 56, 48, 52, 57, 49, 55, 48, 9, 49, 9, 54, 57, 56, 54,
      57, 9, 84, 84, 10, 105, 55, 49, 51, 52, 50, 54, 9, 49, 9, 55, 50, 54, 57, 49, 50, 9, 65,
      65, 10, 82, 83, 52, 50, 57, 51, 53, 56, 9, 49, 57, 9, 52, 53, 52, 49, 49, 57, 52, 49, 9,
      67, 84, 80, 75, 1, 2, 20, 0, 20, 0, 0, 0, 0, 0, 206, 148, 250, 86, 142, 22, 67, 199, 6, 1,
      0, 0, 6, 1, 0, 0, 45, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 103, 101, 110,
      111, 109, 101, 95, 74, 97, 109, 101, 115, 95, 74, 111, 110, 101, 115, 95, 118, 53, 95, 70,
      117, 108, 108, 95, 50, 48, 50, 51, 48, 55, 50, 54, 49, 55, 51, 56, 50, 56, 46, 116, 120,
      116, 80, 75, 5, 6, 0, 0, 0, 0, 1, 0, 1, 0, 91, 0, 0, 0, 81, 1, 0, 0, 0, 0,
    ]);

    const parsed = parseDnaBytes("genome_James_Jones_v5_Full_20230726173828.zip", bytes);

    expect(parsed.importedFrom).toBe("zip");
    expect(parsed.fileName).toBe("genome_James_Jones_v5_Full_20230726173828.txt");
    expect(parsed.provider).toBe("23andMe");
    expect(parsed.build).toBe("GRCh37");
    expect(parsed.markerCount).toBe(2);
    expect(parsed.markers).toEqual([
      ["rs548049170", "1", 69869, "TT"],
      ["rs429358", "19", 45411941, "CT"],
    ]);
  });
});
