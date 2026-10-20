import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatCents } from './money';

const ink = rgb(0.06, 0.18, 0.33);
const blue = rgb(0.04, 0.36, 0.72);
const muted = rgb(0.32, 0.43, 0.55);
const pale = rgb(0.92, 0.96, 1);
const safe = (value: unknown) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ')
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
  .replace(/[\u2013\u2014]/g, '-').replace(/[^\u0020-\u00ff€]/g, '?');
function wrap(font: PDFFont, value: string, width: number, size: number) {
  const words = safe(value).split(/\s+/).filter(Boolean);
  const lines: string[] = []; let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
    if (line) lines.push(line);
    line = '';
    for (const letter of word) {
      if (font.widthOfTextAtSize(line + letter, size) > width && line) { lines.push(line); line = letter; }
      else line += letter;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
export interface PdfProposal {
  title: string; organizationName: string; versionNumber: number; createdAt: string;
  snapshot: { description: string; scope: string; schedule: string; terms: string;
    expiresAt: string | null; totalCents: number; subtotalCents: number;
    discountCents: number; taxCents: number;
    lines: Array<{ name: string; description: string; quantity: string;
      unitPriceCents: number; discountBps: number; taxBps: number; totalCents: number }> };
}
/** Renders a server-validated, immutable version. This is a proposal, never an invoice. */
export async function renderProposalPdf(data: PdfProposal): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Propuesta ${data.title} · Altaria Lights`);
  doc.setAuthor('Altaria Lights');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = doc.addPage([595.28, 841.89]); let y = 774;
  const freshPage = (initial = false) => {
    if (!initial) page = doc.addPage([595.28, 841.89]);
    y = 774;
    page.drawRectangle({ x: 0, y: 805, width: 595.28, height: 37, color: ink });
    page.drawText('ALTARIA  /  LIGHTS', { x: 42, y: 818, size: 11, font: bold, color: rgb(1, 1, 1) });
    page.drawText('PROPUESTA COMERCIAL', { x: 42, y: 774, size: 8, font: bold, color: blue });
    y = 750;
  };
  const ensure = (height: number) => { if (y - height < 74) freshPage(); };
  const paragraph = (value: string, size = 10, font = regular, color = ink, width = 510) => {
    for (const line of wrap(font, value, width, size)) {
      ensure(16);
      page.drawText(line, { x: 42, y, size, font, color }); y -= size + 5;
    }
  };
  const heading = (value: string) => { ensure(35); y -= 13; paragraph(value.toUpperCase(), 9, bold, blue); y -= 3; };
  freshPage(true);
  paragraph(data.title, 21, bold, ink); y -= 5;
  paragraph(`Para ${data.organizationName}`, 12, regular, muted);
  paragraph(`Versión ${data.versionNumber}  ·  ${new Date(data.createdAt).toLocaleDateString('es-ES', { timeZone: 'UTC' })}`, 9, regular, muted);
  if (data.snapshot.expiresAt) paragraph(`Válida hasta ${new Date(data.snapshot.expiresAt).toLocaleDateString('es-ES', { timeZone: 'UTC' })}`, 9, regular, muted);
  if (data.snapshot.description) { heading('Introducción'); paragraph(data.snapshot.description); }
  if (data.snapshot.scope) { heading('Alcance'); paragraph(data.snapshot.scope); }
  if (data.snapshot.schedule) { heading('Plazos'); paragraph(data.snapshot.schedule); }
  heading('Inversión');
  for (const line of data.snapshot.lines) {
    const detail = `${line.quantity} × ${formatCents(line.unitPriceCents)}  ·  Dto. ${(line.discountBps / 100).toFixed(2)} %  ·  Imp. ${(line.taxBps / 100).toFixed(2)} %`;
    const nameLines = wrap(bold, line.name, 330, 10);
    const summaryLines = wrap(regular, detail, 470, 8);
    const detailLines = wrap(regular, line.description, 440, 9);
    const height = 40 + nameLines.length * 12 + summaryLines.length * 11 + detailLines.length * 12;
    ensure(height);
    page.drawRectangle({ x: 42, y: y - height + 9, width: 511, height, color: pale });
    const startY = y;
    for (const text of nameLines) { page.drawText(text, { x: 52, y: y - 8, size: 10, font: bold, color: ink }); y -= 12; }
    page.drawText(safe(formatCents(line.totalCents)), { x: 450, y: startY - 8, size: 10, font: bold, color: blue });
    y -= 14;
    for (const text of summaryLines) {
      page.drawText(text, { x: 52, y, size: 8, font: regular, color: muted }); y -= 11;
    }
    y -= 5;
    for (const text of detailLines) {
      page.drawText(text, { x: 52, y, size: 9, font: regular, color: muted }); y -= 12;
    }
    y -= 10;
  }
  ensure(76);
  const totals = [
    ['Base', data.snapshot.subtotalCents], ['Descuentos', -data.snapshot.discountCents],
    ['Impuestos', data.snapshot.taxCents], ['Total', data.snapshot.totalCents],
  ] as const;
  for (const [label, amount] of totals) {
    page.drawText(label, { x: 360, y, size: label === 'Total' ? 12 : 9,
      font: label === 'Total' ? bold : regular, color: label === 'Total' ? ink : muted });
    page.drawText(safe(formatCents(amount)), { x: 450, y, size: label === 'Total' ? 12 : 9,
      font: label === 'Total' ? bold : regular, color: label === 'Total' ? blue : ink }); y -= 18;
  }
  if (data.snapshot.terms) { heading('Condiciones'); paragraph(data.snapshot.terms); }
  ensure(35); y -= 16;
  paragraph('Documento comercial sujeto a aceptación. No es factura ni confirma un pedido pagado.', 8, regular, muted);
  const pages = doc.getPages();
  pages.forEach((item, index) => {
    item.drawLine({ start: { x: 42, y: 48 }, end: { x: 553, y: 48 }, thickness: 0.5, color: muted });
    item.drawText(`Altaria Lights  ·  ${index + 1} / ${pages.length}`, { x: 42, y: 33, size: 8, font: regular, color: muted });
  });
  return doc.save();
}
