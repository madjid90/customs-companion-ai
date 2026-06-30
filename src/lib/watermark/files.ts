/**
 * File <-> canvas helpers for the watermark remover.
 *
 * Supported inputs: raster images (png/jpg/webp/gif/bmp) directly, and PDF
 * documents (each page is rasterised to a canvas via pdf.js — the same engine
 * already used by the in-app PDF viewer).
 */

import { pdfjs } from "react-pdf";
import { jsPDF } from "jspdf";

// Reuse the worker configuration pattern from src/components/chat/PdfViewer.tsx
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

/** A single editable page (image files yield exactly one). */
export interface LoadedPage {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function canvasFromImage(img: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D non disponible");
  ctx.drawImage(img, 0, 0);
  return canvas;
}

async function loadImage(file: File): Promise<LoadedPage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Image illisible"));
      el.src = url;
    });
    const canvas = canvasFromImage(img);
    return { canvas, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Cap the rasterisation scale so very large PDF pages stay responsive while
 * still being sharp enough to edit.
 */
const MAX_PDF_PAGE_DIMENSION = 2000;

async function loadPdf(file: File): Promise<LoadedPage[]> {
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: LoadedPage[] = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const baseViewport = page.getViewport({ scale: 1 });
    const longest = Math.max(baseViewport.width, baseViewport.height);
    const scale = longest > MAX_PDF_PAGE_DIMENSION ? MAX_PDF_PAGE_DIMENSION / longest : 2;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D non disponible");
    // White background so transparent PDF regions export cleanly.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;

    pages.push({ canvas, width: canvas.width, height: canvas.height });
  }

  return pages;
}

/** Load any supported file into one or more editable pages. */
export async function loadPages(file: File): Promise<LoadedPage[]> {
  if (isPdfFile(file)) return loadPdf(file);
  if (isImageFile(file)) return [await loadImage(file)];
  throw new Error("Format non pris en charge — utilise une image ou un PDF");
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Export PNG impossible"));
    }, "image/png");
  });
}

/** Assemble cleaned page canvases into a single PDF (one page each). */
export function canvasesToPdf(canvases: HTMLCanvasElement[]): Blob {
  if (canvases.length === 0) throw new Error("Aucune page à exporter");

  const first = canvases[0];
  const doc = new jsPDF({
    orientation: first.width >= first.height ? "landscape" : "portrait",
    unit: "px",
    format: [first.width, first.height],
  });

  canvases.forEach((canvas, index) => {
    if (index > 0) {
      doc.addPage(
        [canvas.width, canvas.height],
        canvas.width >= canvas.height ? "landscape" : "portrait",
      );
    }
    const dataUrl = canvas.toDataURL("image/png");
    doc.addImage(dataUrl, "PNG", 0, 0, canvas.width, canvas.height);
  });

  return doc.output("blob");
}
