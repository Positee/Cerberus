import PDFDocument from 'pdfkit';
import { ACTION_LABEL, type AuditEvent } from '../../../shared/audit.js';

/**
 * The audit report, as a PDF.
 *
 * A person hands this to an auditor, so the head of every page says what the
 * report covers, when it was made, and who made it. A page of rows with no
 * provenance proves nothing.
 */

type Cover = {
  workspace: string;
  /** What the filter covered, in words. */
  filter: string;
  by: string;
  /** True when the filter matched more rows than the report carries. */
  truncated?: boolean;
};

/** Landscape, because six columns do not fit across a portrait page. */
const PAGE = { size: 'A4' as const, layout: 'landscape' as const, margin: 36 };

/** Column widths in points. They total the printable width. */
const COLUMNS = [
  { key: 'actor', head: 'Actor', width: 150 },
  { key: 'action', head: 'Action', width: 150 },
  { key: 'resource', head: 'Resource', width: 190 },
  { key: 'ip', head: 'Source IP', width: 95 },
  { key: 'at', head: 'When', width: 125 },
  { key: 'result', head: 'Result', width: 60 },
] as const;

const ROW_HEIGHT = 16;
const HEAD_HEIGHT = 18;

/** Reads a time the way the table does, so the PDF matches the screen. */
function when(iso: string): string {
  const at = new Date(iso);
  const date = at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

/** Cuts a value that will not fit, so a long resource cannot break the grid. */
function fit(doc: PDFKit.PDFDocument, value: string, width: number): string {
  if (doc.widthOfString(value) <= width - 6) return value;

  let cut = value;
  while (cut.length > 1 && doc.widthOfString(`${cut}...`) > width - 6) {
    cut = cut.slice(0, -1);
  }
  return `${cut}...`;
}

function drawHead(doc: PDFKit.PDFDocument, top: number): number {
  let x = doc.page.margins.left;

  doc.save();
  doc
    .rect(doc.page.margins.left, top, COLUMNS.reduce((sum, column) => sum + column.width, 0), HEAD_HEIGHT)
    .fill('#EFEBF5');
  doc.restore();

  doc.font('Helvetica-Bold').fontSize(8).fillColor('#3A125E');
  for (const column of COLUMNS) {
    doc.text(column.head.toUpperCase(), x + 3, top + 5, { width: column.width - 6, lineBreak: false });
    x += column.width;
  }

  return top + HEAD_HEIGHT;
}

export function buildPdf(events: AuditEvent[], cover: Cover): Promise<Buffer> {
  const doc = new PDFDocument(PAGE);
  const chunks: Buffer[] = [];

  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const made = new Date().toLocaleString('en-GB', { timeZone: 'UTC' });

  // The provenance block. It is what turns a table into evidence.
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#3A125E').text('Cerberus audit log');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(9).fillColor('#444444');
  doc.text(`Workspace: ${cover.workspace}`);
  doc.text(`Covers: ${cover.filter}`);
  doc.text(`Rows: ${events.length}${cover.truncated ? ' (capped, narrow the filter for the rest)' : ''}`);
  doc.text(`Exported: ${made} UTC, by ${cover.by}`);
  doc.moveDown(0.6);

  let y = drawHead(doc, doc.y);
  const bottom = doc.page.height - doc.page.margins.bottom - ROW_HEIGHT;

  events.forEach((event, index) => {
    if (y > bottom) {
      doc.addPage(PAGE);
      y = drawHead(doc, doc.page.margins.top);
    }

    // A faint band on every other row, so the eye tracks across six columns.
    if (index % 2 === 1) {
      doc.save();
      doc
        .rect(doc.page.margins.left, y, COLUMNS.reduce((sum, column) => sum + column.width, 0), ROW_HEIGHT)
        .fill('#F7F5FA');
      doc.restore();
    }

    const values: Record<string, string> = {
      actor: event.actor,
      action: ACTION_LABEL[event.action] ?? event.action,
      resource: event.resource,
      ip: event.ip ?? '',
      at: when(event.at),
      result: event.result === 'allowed' ? 'Allowed' : 'Denied',
    };

    let x = doc.page.margins.left;
    for (const column of COLUMNS) {
      // A denied row says so in bold as well as in colour, never colour alone.
      const denied = column.key === 'result' && event.result === 'denied';
      doc
        .font(denied ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(8)
        .fillColor(denied ? '#B3132B' : '#222222');

      doc.text(fit(doc, values[column.key] ?? '', column.width), x + 3, y + 4, {
        width: column.width - 6,
        lineBreak: false,
      });
      x += column.width;
    }

    y += ROW_HEIGHT;
  });

  if (events.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#666666');
    doc.text('No events match this filter.', doc.page.margins.left, y + 8);
  }

  doc.end();
  return done;
}
