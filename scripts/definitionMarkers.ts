// rsids declared in the 12 hand-crafted EVIDENCE_DEFINITIONS, grouped by definition id
export const DEFINITION_MARKERS: Record<string, string[]> = {
  "medical-apoe":        ["rs429358", "rs7412"],
  "medical-factor-v":    ["rs6025"],
  "medical-prothrombin": ["rs1799963"],
  "medical-hfe":         ["rs1800562", "rs1799945"],
  "medical-mthfr":       ["rs1801133"],
  "trait-eye-colour":    ["rs12913832"],
  "trait-lactase":       ["rs4988235"],
  "trait-caffeine":      ["rs762551"],
  "trait-actn3":         ["rs1815739"],
  "drug-cyp2c19":        ["rs4244285"],
  "drug-warfarin":       ["rs1057910", "rs9923231"],
  "drug-slco1b1":        ["rs4149056"],
};

export const MANUAL_RSIDS = new Set(Object.values(DEFINITION_MARKERS).flat());

export const DEFINITION_TITLES: Record<string, string> = {
  "medical-apoe":        "APOE / Alzheimer's & cardiovascular risk",
  "medical-factor-v":    "Factor V Leiden / thrombosis risk",
  "medical-prothrombin": "Prothrombin G20210A / thrombosis risk",
  "medical-hfe":         "HFE / hereditary haemochromatosis",
  "medical-mthfr":       "MTHFR C677T / folate metabolism",
  "trait-eye-colour":    "HERC2 / eye colour",
  "trait-lactase":       "LCT / lactase persistence",
  "trait-caffeine":      "CYP1A2 / caffeine metabolism",
  "trait-actn3":         "ACTN3 / athletic performance",
  "drug-cyp2c19":        "CYP2C19 *2 / clopidogrel response",
  "drug-warfarin":       "CYP2C9 & VKORC1 / warfarin dosing",
  "drug-slco1b1":        "SLCO1B1 / statin myopathy risk",
};
