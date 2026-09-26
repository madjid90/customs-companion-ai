import type { PDFPageProxy } from "pdfjs-dist";
import type { Worker as TesseractWorker } from "tesseract.js";

export async function createPdfOcrWorker(): Promise<TesseractWorker> {
  const { createWorker } = await import("tesseract.js");
  return createWorker(["fra", "ara", "eng"]);
}

export async function recognizePdfPage(page: PDFPageProxy, worker: TesseractWorker) {
  const natural = page.getViewport({ scale: 1 });
  const scale = Math.min(2.5, 2400 / Math.max(natural.width, natural.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas OCR indisponible");
  try {
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const { data } = await worker.recognize(canvas);
    return { text: data.text.trim(), confidence: data.confidence };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
