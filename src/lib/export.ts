"use client";
// Exportación de reportes a Excel (exceljs) y PDF (jsPDF) con la marca RUPÍCOLA.
type Row = Record<string, unknown>;
const pretty = (k: string) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export async function toExcel(title: string, rows: Row[], filename: string, subtitle?: string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "RUPÍCOLA";
  const ws = wb.addWorksheet(title.slice(0, 31));
  const cols = Object.keys(rows[0] ?? {});
  ws.addRow([`RUPÍCOLA · ${title}`]).font = { bold: true, size: 14, color: { argb: "FF791522" } };
  if (subtitle) ws.addRow([subtitle]).font = { italic: true, color: { argb: "FF6B6460" } };
  ws.addRow([]);
  const head = ws.addRow(cols.map(pretty));
  head.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF791522" } }; });
  rows.forEach((r) => ws.addRow(cols.map((c) => { const v = r[c]; return typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v as string | number; })));
  cols.forEach((_, i) => { ws.getColumn(i + 1).width = Math.min(40, Math.max(12, pretty(cols[i]).length + 4)); });
  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${filename}.xlsx`);
}

export async function toPDF(title: string, rows: Row[], filename: string, subtitle?: string) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const cols = Object.keys(rows[0] ?? {});
  const doc = new jsPDF({ orientation: cols.length > 5 ? "landscape" : "portrait" });
  // Marca: círculo borgoña con iniciales (el símbolo vectorial completo está en /brand)
  doc.setFillColor(121, 21, 34); doc.circle(18, 16, 7, "F");
  doc.setTextColor(215, 197, 162); doc.setFontSize(11); doc.text("R", 16.3, 19);
  doc.setTextColor(41, 37, 36); doc.setFontSize(15); doc.text(`RUPÍCOLA · ${title}`, 30, 15);
  if (subtitle) { doc.setFontSize(9); doc.setTextColor(110, 100, 96); doc.text(subtitle, 30, 21); }
  autoTable(doc, {
    startY: 28, head: [cols.map(pretty)], body: rows.map((r) => cols.map((c) => String(r[c] ?? ""))),
    headStyles: { fillColor: [121, 21, 34], textColor: 255 }, alternateRowStyles: { fillColor: [247, 245, 240] }, styles: { fontSize: 8 },
  });
  doc.save(`${filename}.pdf`);
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
