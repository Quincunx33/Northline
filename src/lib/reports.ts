import type { Analysis, MachineConfig } from "@/lib/types";
import { ADVISORY } from "@/lib/utils";

export type ReportMeta = {
  fileName: string;
  fileSize: number;
  generatedAt: string;
};

export function reportDocument(analysis: Analysis, config: MachineConfig, meta: ReportMeta) {
  return {
    advisory: ADVISORY,
    generatedAt: meta.generatedAt,
    file: { name: meta.fileName, bytes: meta.fileSize },
    machine: {
      name: config.name,
      illustrative: config.illustrative,
      note: config.note,
      controllerPreset: config.controllerPreset,
      travelMm: {
        x: [config.xMin, config.xMax],
        y: [config.yMin, config.yMax],
        z: [config.zMin, config.zMax],
      },
      rapidMmMin: config.rapidRate,
      maxFeedMmMin: config.maxFeed,
      accelerationMmS2: config.acceleration,
      clearanceZ: config.clearanceZ,
    },
    dialect: analysis.dialect,
    assumptions: [...analysis.assumptions, ...analysis.time.assumptions],
    stats: analysis.stats,
    bbox: analysis.bbox,
    time: analysis.time,
    commands: analysis.commands,
    findings: analysis.findings,
    segments: analysis.segments.map(({ points: _points, ...rest }) => rest),
    notes: [
      "Polyline samples are omitted from this file. Lengths are analytic.",
      "Billing is not configured. This export is produced locally.",
    ],
  };
}

export function findingsCsv(analysis: Analysis): string {
  const header = ["severity", "line", "code", "message", "suggestion", "values"];
  const rows = analysis.findings.map((f) => [
    f.severity,
    f.line == null ? "" : String(f.line),
    f.code,
    f.message,
    f.suggestion,
    f.values.map((v) => `${v.key}=${v.value}`).join("; "),
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export function pdfBytes(lines: string[]): Uint8Array {
  const wrapped: string[] = [];
  for (const line of lines) {
    const clean = line.replace(/[^\x20-\x7E]/g, "?");
    if (clean.length === 0) {
      wrapped.push("");
      continue;
    }
    for (let i = 0; i < clean.length; i += 90) wrapped.push(clean.slice(i, i + 90));
  }
  const perPage = 46;
  const pages: string[][] = [];
  const source = wrapped.length ? wrapped : ["(empty report)"];
  for (let i = 0; i < source.length; i += perPage) pages.push(source.slice(i, i + perPage));

  const fontId = 3;
  let next = 4;
  const kids: string[] = [];
  const body: { id: number; text: string }[] = [];
  for (const page of pages) {
    const pageId = next++;
    const contentId = next++;
    kids.push(`${pageId} 0 R`);
    let stream = "BT\n/F1 9 Tf\n40 760 Td\n14 TL\n";
    page.forEach((ln, idx) => {
      const op = `(${escapePdf(ln)}) Tj\n`;
      stream += idx === 0 ? op : `T*\n${op}`;
    });
    stream += "ET\n";
    body.push({
      id: contentId,
      text: `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    });
    body.push({
      id: pageId,
      text: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`,
    });
  }
  const all = [
    { id: 1, text: "<< /Type /Catalog /Pages 2 0 R >>" },
    { id: 2, text: `<< /Type /Pages /Count ${pages.length} /Kids [${kids.join(" ")}] >>` },
    { id: 3, text: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
    ...body,
  ].sort((a, b) => a.id - b.id);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of all) {
    offsets[obj.id] = pdf.length;
    pdf += `${obj.id} 0 obj\n${obj.text}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${all.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= all.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${all.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

export function downloadBlob(filename: string, data: BlobPart, type: string) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
