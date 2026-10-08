// Regenerates paper.pdf. Run: node tests/fixtures/sites/site/pdf/make-pdf.ts
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function png(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): Uint8Array {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) raw.set(paint(x, y), y * (width * 3 + 1) + 1 + x * 3);
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const doc = await PDFDocument.create();
doc.setTitle("Photosynthesis: A Short Primer");
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const figure = await doc.embedPng(
  png(240, 140, (x, y) =>
    (x - 120) ** 2 / 100 ** 2 + (y - 70) ** 2 / 55 ** 2 < 1 ? [80, 160, 90] : [235, 245, 235],
  ),
);
const scan = await doc.embedPng(
  png(400, 300, (x, y) => (Math.floor(x / 20 + y / 20) % 2 ? [30, 30, 30] : [250, 250, 250])),
);

function writer(page: ReturnType<typeof doc.addPage>) {
  let y = 740;
  return {
    heading(text: string, size: number) {
      y -= size + 10;
      page.drawText(text, { x: 72, y, size, font: bold });
      y -= 6;
    },
    paragraph(text: string, size = 11) {
      const words = text.split(" ");
      let line = "";
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > 468) {
          y -= size + 4;
          page.drawText(line, { x: 72, y, size, font });
          line = word;
        } else line = next;
      }
      y -= size + 4;
      page.drawText(line, { x: 72, y, size, font });
      y -= 10;
    },
    bullet(text: string) {
      y -= 15;
      page.drawText(`• ${text}`, { x: 84, y, size: 11, font });
    },
    gap(points: number) {
      y -= points;
    },
    image(img: typeof figure, w: number, h: number) {
      y -= h;
      page.drawImage(img, { x: 72, y, width: w, height: h });
      y -= 8;
    },
    row(cells: string[], boldRow = false) {
      y -= 16;
      cells.forEach((cell, i) =>
        page.drawText(cell, { x: 72 + i * 150, y, size: 11, font: boldRow ? bold : font }),
      );
      page.drawLine({
        start: { x: 72, y: y - 4 },
        end: { x: 522, y: y - 4 },
        thickness: 0.5,
        color: rgb(0.6, 0.6, 0.6),
      });
    },
  };
}

const p1 = writer(doc.addPage([612, 792]));
p1.heading("Photosynthesis: A Short Primer", 22);
p1.paragraph("Prepared as a fixture for faithful note capture.", 10);
p1.heading("1. Introduction", 15);
p1.paragraph(
  "Photosynthesis is the process by which plants, algae and some bacteria convert light energy into chemical energy. The energy is stored in sugars that power nearly every food chain on Earth.",
);
p1.paragraph(
  "The process takes place in chloroplasts and has two linked stages: the light reactions and the Calvin cycle.",
);
p1.bullet("Light reactions capture energy from photons.");
p1.bullet("The Calvin cycle fixes carbon dioxide into sugar.");
p1.bullet("Oxygen is released as a by-product.");
p1.gap(10);
p1.heading("2. Light reactions", 15);
p1.paragraph(
  "In the thylakoid membranes, chlorophyll absorbs light and drives electrons through a transport chain. Water is split to replace those electrons, and the energy is stored as ATP and NADPH.",
);
p1.image(figure, 240, 140);
p1.paragraph("Figure 1. Schematic chloroplast with stacked thylakoids.", 9);

const p2 = writer(doc.addPage([612, 792]));
p2.heading("3. Calvin cycle", 15);
p2.paragraph(
  "In the stroma, the enzyme rubisco attaches carbon dioxide to a five carbon sugar. ATP and NADPH from the light reactions then reduce the product into three carbon sugars that the plant uses to build glucose.",
);
p2.row(["Input", "Output", "Location"], true);
p2.row(["Carbon dioxide", "Glucose", "Stroma"]);
p2.row(["ATP", "ADP", "Stroma"]);
p2.row(["NADPH", "NADP+", "Stroma"]);
p2.gap(16);
p2.heading("4. Summary", 15);
p2.paragraph(
  "Light energy becomes chemical energy in two stages, and the oxygen we breathe is a side effect of splitting water.",
);

const p3 = writer(doc.addPage([612, 792]));
p3.image(scan, 400, 300);

writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "paper.pdf"), await doc.save());
