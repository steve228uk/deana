import { gzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildDbsnpAnnotationLookup } from "./dbsnpAnnotation";
import { annotationRetryBuild, parseDnaBytes, parseDnaText } from "./dnaParser";

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

    let error: unknown;
    try {
      parseDnaText("ALL.chrMT.phase3.vcf", vcf, "text");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("variant rows do not contain rsID identifiers");
    expect(annotationRetryBuild(error)).toBe("GRCh37");
  });

  it("annotates unannotated GRCh37 VCF rows from a local dbSNP index", () => {
    const annotationLookup = buildDbsnpAnnotationLookup({
      GRCh37: [["19", 45411941, "T", "C", ["rs429358"]]],
    });
    const vcf = [
      "##fileformat=VCFv4.2",
      "##reference=GRCh37",
      "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE",
      "19\t45411941\t.\tT\tC\t.\tPASS\t.\tGT\t0/1",
    ].join("\n");

    const parsed = parseDnaText("grch37.vcf", vcf, "text", { annotationLookup });

    expect(parsed.build).toBe("GRCh37");
    expect(parsed.markers).toEqual([["rs429358", "19", 45411941, "TC"]]);
    expect(parsed.annotation).toEqual({
      build: "GRCh37",
      annotatedMarkers: 1,
      eligibleRows: 1,
      unannotatedRows: 0,
      skippedNonSnvRows: 0,
    });
  });

  it("detects b37 mitochondrial VCF metadata and annotates matching unannotated rows", () => {
    const annotationLookup = buildDbsnpAnnotationLookup({
      GRCh37: [["MT", 73, "A", "G", ["rs869183622"]]],
    });
    const vcf = [
      "##fileformat=VCFv4.2",
      "##reference=gi|251831106|ref|NC_012920.1| Homo sapiens mitochondrion, complete genome",
      "##contig=<ID=MT,length=16569,assembly=b37>",
      "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tHG00096\tHG00097",
      "MT\t73\t.\tA\tG\t.\tPASS\t.\tGT\t0\t1",
    ].join("\n");

    const parsed = parseDnaText("ALL.chrMT.phase3.vcf", vcf, "text", { annotationLookup });

    expect(parsed.build).toBe("GRCh37");
    expect(parsed.markers).toEqual([["rs869183622", "MT", 73, "AA"]]);
    expect(parsed.annotation).toEqual({
      build: "GRCh37",
      annotatedMarkers: 1,
      eligibleRows: 1,
      unannotatedRows: 0,
      skippedNonSnvRows: 0,
    });
  });

  it("annotates unannotated GRCh38 VCF rows from a local dbSNP index", () => {
    const annotationLookup = buildDbsnpAnnotationLookup({
      GRCh38: [["19", 44908684, "T", "C", ["rs429358"]]],
    });
    const vcf = [
      "##fileformat=VCFv4.2",
      "##reference=GRCh38",
      "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE",
      "chr19\t44908684\t.\tT\tC\t.\tPASS\t.\tGT\t1/1",
    ].join("\n");

    const parsed = parseDnaText("grch38.vcf", vcf, "text", { annotationLookup });

    expect(parsed.build).toBe("GRCh38");
    expect(parsed.markers).toEqual([["rs429358", "19", 44908684, "CC"]]);
    expect(parsed.annotation?.build).toBe("GRCh38");
  });

  it("detects b38 and RefSeq GRCh38 VCF metadata for local annotation", () => {
    const annotationLookup = buildDbsnpAnnotationLookup({
      GRCh38: [["1", 101, "A", "G", ["rs101"]]],
    });
    const b38Vcf = [
      "##fileformat=VCFv4.2",
      "##contig=<ID=1,length=248956422,assembly=b38>",
      "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE",
      "1\t101\t.\tA\tG\t.\tPASS\t.\tGT\t0/1",
    ].join("\n");
    const refseqVcf = [
      "##fileformat=VCFv4.2",
      "##contig=<ID=NC_000001.11,length=248956422>",
      "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE",
      "1\t101\t.\tA\tG\t.\tPASS\t.\tGT\t0/1",
    ].join("\n");

    expect(parseDnaText("b38.vcf", b38Vcf, "text", { annotationLookup }).build).toBe("GRCh38");
    expect(parseDnaText("refseq.vcf", refseqVcf, "text", { annotationLookup }).build).toBe("GRCh38");
  });

  it("fails unannotated VCF rows clearly when the build is unknown", () => {
    const annotationLookup = buildDbsnpAnnotationLookup({
      GRCh37: [["19", 45411941, "T", "C", ["rs429358"]]],
    });
    const vcf = [
      "##fileformat=VCFv4.2",
      "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE",
      "19\t45411941\t.\tT\tC\t.\tPASS\t.\tGT\t0/1",
    ].join("\n");

    expect(() => parseDnaText("unknown-build.vcf", vcf, "text", { annotationLookup })).toThrow(
      "could not detect a supported GRCh37 or GRCh38 build",
    );
  });

  it("does not request annotation retry for unannotated VCF rows with unknown build", () => {
    const vcf = [
      "##fileformat=VCFv4.2",
      "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE",
      "19\t45411941\t.\tT\tC\t.\tPASS\t.\tGT\t0/1",
    ].join("\n");

    let error: unknown;
    try {
      parseDnaText("unknown-build.vcf", vcf, "text");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("could not detect a supported GRCh37 or GRCh38 build");
    expect(annotationRetryBuild(error)).toBeNull();
  });

  it("fails unannotated VCF rows clearly when no local annotation rows match", () => {
    const annotationLookup = buildDbsnpAnnotationLookup({
      GRCh37: [["19", 45411941, "T", "C", ["rs429358"]]],
    });
    const vcf = [
      "##fileformat=VCFv4.2",
      "##contig=<ID=MT,length=16569,assembly=b37>",
      "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE",
      "MT\t73\t.\tA\tG\t.\tPASS\t.\tGT\t0/1",
    ].join("\n");

    expect(() => parseDnaText("unmatched.vcf", vcf, "text", { annotationLookup })).toThrow(
      "appears to be GRCh37",
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

  it("parses H600-listed rsID-backed microarray table layouts", () => {
    const cases = [
      {
        fileName: "AncestryDNA.txt",
        text: [
          "#This file was generated by AncestryDNA at: 06/27/2015 09:23:22 MDT",
          "#of the SNP using human reference build 37.1 coordinates.",
          "rsid\tchromosome\tposition\tallele1\tallele2",
          "rs4477212\t1\t82154\tT\tT",
          "rs3094315\t23\t752566\t0\t0",
        ].join("\r\n"),
        provider: "AncestryDNA",
        build: "GRCh37",
        markers: [
          ["rs4477212", "1", 82154, "TT"],
          ["rs3094315", "X", 752566, "--"],
        ],
      },
      {
        fileName: "FamilyTreeDNA_Family_Finder.csv",
        text: [
          "RSID,CHROMOSOME,POSITION,RESULT",
          "\"rs4477212\",\"1\",\"72017\",\"AA\"",
          "\"VG123\",\"0\",\"0\",\"--\"",
        ].join("\r\n"),
        provider: "FamilyTreeDNA",
        build: "Unknown",
        markers: [["rs4477212", "1", 72017, "AA"]],
      },
      {
        fileName: "LivingDNA.txt",
        text: [
          "# Living DNA customer genotype data download file version: 1.0.1",
          "# Human Genome Reference Build 37 (GRCh37.p13).",
          "# rsid\tchromosome\tposition\tgenotype",
          "rs9283150\t1\t565508\tAA",
          "1:726912\t1\t726912\tAA",
        ].join("\n"),
        provider: "LivingDNA",
        build: "GRCh37",
        markers: [["rs9283150", "1", 565508, "AA"]],
      },
      {
        fileName: "MyHeritage.csv",
        text: [
          "# MyHeritage DNA raw data.",
          "# human reference build 37.",
          "RSID,CHROMOSOME,POSITION,RESULT",
          "\"rs3094315\",\"17\",\"12,345\",\"AG\"",
        ].join("\n"),
        provider: "MyHeritage",
        build: "GRCh37",
        markers: [["rs3094315", "17", 12345, "AG"]],
      },
      {
        fileName: "tellmeGen.csv",
        text: [
          "# rsid\tchromosome\tposition\tgenotype",
          "rs12564807\t1\t734462\tAA",
          "chr1:734462\t1\t734462\tGG",
        ].join("\n"),
        provider: "tellmeGen",
        build: "Unknown",
        markers: [["rs12564807", "1", 734462, "AA"]],
      },
      {
        fileName: "meuDNA.csv",
        text: [
          "RSID,CHROMOSOME,POSITION,RESULT",
          "rs10000081,4,122345,TT",
          "GSA-rs123,4,122346,CC",
        ].join("\n"),
        provider: "meuDNA",
        build: "Unknown",
        markers: [["rs10000081", "4", 122345, "TT"]],
      },
      {
        fileName: "Genera.csv",
        text: [
          "RSID,CHROMOSOME,POSITION,RESULT",
          "rs1000014,16,756432,G",
        ].join("\n"),
        provider: "Genera",
        build: "Unknown",
        markers: [["rs1000014", "16", 756432, "G"]],
      },
      {
        fileName: "MTHFR_Genetics.txt",
        text: [
          "rsid\tchromosome\tposition\tgenotype",
          "RS1801133\t1\t11856378\tAG",
        ].join("\r\n"),
        provider: "MTHFR Genetics",
        build: "Unknown",
        markers: [["rs1801133", "1", 11856378, "AG"]],
      },
      {
        fileName: "SelfDecode.txt",
        text: [
          "# SelfDecode raw data",
          "# Build38",
          "rsid\tchromosome\tposition\tgenotype",
          "rs10000092\t4\t12345\tA",
          "JHU_1\t4\t12346\tT",
        ].join("\n"),
        provider: "SelfDecode",
        build: "GRCh38",
        markers: [["rs10000092", "4", 12345, "A"]],
      },
      {
        fileName: "Reich_1240K.txt",
        text: [
          "# Reich 1240K",
          "rsid\tchromosome\tposition\tgenotype",
          "rs1000014\t16\t762223\tGG",
          "Affx-123\t16\t762224\tAA",
        ].join("\r\n"),
        provider: "Reich",
        build: "Unknown",
        markers: [["rs1000014", "16", 762223, "GG"]],
      },
      {
        fileName: "NGGeno.csv",
        text: [
          "SNP,Chr,Allele1,Allele2",
          "kgp10004422,12,A,G",
          "rs10000081,4,T,T",
        ].join("\n"),
        provider: "National Geographic Geno",
        build: "Unknown",
        markers: [["rs10000081", "4", 0, "TT"]],
      },
      {
        fileName: "Geno2.0_NextGen.csv",
        text: [
          "RSID,CHROMOSOME,POSITION,RESULT",
          "rs3748597\",\"1\",\"878522\",\"TC",
          "rs28415373\",\"1\",\"883844\",\"--",
        ].join("\n"),
        provider: "National Geographic Geno",
        build: "Unknown",
        markers: [
          ["rs3748597", "1", 878522, "TC"],
          ["rs28415373", "1", 883844, "--"],
        ],
      },
    ] as const;

    for (const testCase of cases) {
      const parsed = parseDnaText(testCase.fileName, testCase.text, "text");

      expect(parsed.provider, testCase.fileName).toBe(testCase.provider);
      expect(parsed.build, testCase.fileName).toBe(testCase.build);
      expect(parsed.markers, testCase.fileName).toEqual(testCase.markers);
    }
  });

  it("explains recognized sidecar files that do not contain rsIDs", () => {
    const livingDnaY = [
      "SnpName\tChromosome\tResult",
      "CTS10083\tY\tCC",
      "M245\tY\tII",
    ].join("\n");

    expect(() => parseDnaText("LivingDNA-Y.txt", livingDnaY, "text")).toThrow(
      "recognized raw-DNA layout, but its rows do not contain rsID identifiers",
    );
  });

  it("merges rsID-backed entries from multi-file zip exports", () => {
    const bytes = Uint8Array.from([
      80, 75, 3, 4, 20, 0, 0, 0, 8, 0, 130, 160, 154, 92, 55, 28, 81, 102, 31, 0, 0, 0, 29, 0, 0, 0, 10, 0, 0, 0, 82, 69, 65, 68, 77, 69, 46, 116, 120, 116, 115, 75, 204, 205, 204, 169, 12, 41, 74, 77, 117, 241, 115, 84, 40, 74, 44, 87, 72, 73, 44, 73, 84, 72, 173, 40, 200, 47, 42, 1, 0,
      80, 75, 3, 4, 20, 0, 0, 0, 8, 0, 130, 160, 154, 92, 229, 43, 18, 187, 50, 0, 0, 0, 54, 0, 0, 0, 13, 0, 0, 0, 97, 117, 116, 111, 115, 111, 109, 97, 108, 46, 99, 115, 118, 11, 10, 246, 116, 209, 113, 246, 8, 242, 247, 245, 15, 246, 247, 117, 213, 9, 240, 15, 246, 12, 241, 244, 247, 211, 9, 114, 13, 14, 245, 9, 225, 82, 42, 42, 54, 52, 52, 84, 210, 81, 2, 99, 3, 16, 233, 232, 174, 4, 0,
      80, 75, 3, 4, 20, 0, 0, 0, 8, 0, 130, 160, 154, 92, 46, 204, 179, 71, 52, 0, 0, 0, 54, 0, 0, 0, 5, 0, 0, 0, 120, 46, 99, 115, 118, 11, 10, 246, 116, 209, 113, 246, 8, 242, 247, 245, 15, 246, 247, 117, 213, 9, 240, 15, 246, 12, 241, 244, 247, 211, 9, 114, 13, 14, 245, 9, 225, 82, 42, 42, 54, 50, 50, 82, 210, 81, 138, 0, 98, 35, 3, 16, 203, 217, 89, 9, 0,
      80, 75, 3, 4, 20, 0, 0, 0, 8, 0, 130, 160, 154, 92, 63, 73, 254, 93, 39, 0, 0, 0, 39, 0, 0, 0, 5, 0, 0, 0, 121, 46, 99, 115, 118, 11, 206, 43, 240, 75, 204, 77, 213, 113, 206, 40, 202, 207, 205, 47, 206, 7, 50, 131, 82, 139, 75, 115, 74, 184, 156, 67, 130, 13, 13, 12, 44, 140, 117, 34, 117, 156, 157, 1,
      80, 75, 1, 2, 20, 0, 20, 0, 0, 0, 8, 0, 130, 160, 154, 92, 55, 28, 81, 102, 31, 0, 0, 0, 29, 0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 82, 69, 65, 68, 77, 69, 46, 116, 120, 116,
      80, 75, 1, 2, 20, 0, 20, 0, 0, 0, 8, 0, 130, 160, 154, 92, 229, 43, 18, 187, 50, 0, 0, 0, 54, 0, 0, 0, 13, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 71, 0, 0, 0, 97, 117, 116, 111, 115, 111, 109, 97, 108, 46, 99, 115, 118,
      80, 75, 1, 2, 20, 0, 20, 0, 0, 0, 8, 0, 130, 160, 154, 92, 46, 204, 179, 71, 52, 0, 0, 0, 54, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 164, 0, 0, 0, 120, 46, 99, 115, 118,
      80, 75, 1, 2, 20, 0, 20, 0, 0, 0, 8, 0, 130, 160, 154, 92, 63, 73, 254, 93, 39, 0, 0, 0, 39, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 251, 0, 0, 0, 121, 46, 99, 115, 118,
      80, 75, 5, 6, 0, 0, 0, 0, 4, 0, 4, 0, 217, 0, 0, 0, 69, 1, 0, 0, 0, 0,
    ]);

    const parsed = parseDnaBytes("FamilyTreeDNA.zip", bytes);

    expect(parsed.importedFrom).toBe("zip");
    expect(parsed.fileName).toBe("FamilyTreeDNA.zip");
    expect(parsed.provider).toBe("FamilyTreeDNA");
    expect(parsed.markers).toEqual([
      ["rs111", "1", 101, "AG"],
      ["rs222", "X", 202, "CC"],
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
