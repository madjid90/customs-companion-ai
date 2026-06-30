import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  Brush,
  Eraser,
  Square,
  Wand2,
  Undo2,
  RotateCcw,
  Download,
  FileDown,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ImageOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { inpaint } from "@/lib/watermark/inpaint";
import {
  loadPages,
  canvasToPngBlob,
  canvasesToPdf,
  triggerDownload,
  type LoadedPage,
} from "@/lib/watermark/files";

type Tool = "brush" | "eraser" | "rect";

const MAX_HISTORY = 10;
const ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.bmp,.pdf,image/*,application/pdf";

/**
 * Watermark remover — load your own image or PDF, paint over the mark you want
 * gone, and the content-aware fill rebuilds the background underneath. Runs
 * entirely in the browser; files never leave the device.
 */
export default function WatermarkRemover() {
  const { toast } = useToast();

  // Editable, full-resolution page canvases (mutated in place on each apply).
  const workCanvasesRef = useRef<HTMLCanvasElement[]>([]);
  // Mask canvas per page: opaque where the user has marked pixels for removal.
  const maskCanvasesRef = useRef<HTMLCanvasElement[]>([]);
  // Per-page undo stacks of the work image.
  const historyRef = useRef<ImageData[][]>([]);

  const displayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pageCount, setPageCount] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(28);
  const [strength, setStrength] = useState(50);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string>("");
  const [canUndo, setCanUndo] = useState(false);

  // Pointer/drawing state kept in refs to avoid re-renders mid-stroke.
  const drawingRef = useRef(false);
  const lastPtRef = useRef<{ x: number; y: number } | null>(null);
  const rectStartRef = useRef<{ x: number; y: number } | null>(null);
  const rectCurrentRef = useRef<{ x: number; y: number } | null>(null);

  const baseName = fileName.replace(/\.[^.]+$/, "") || "image";

  /** Map a pointer event to full-resolution image coordinates. */
  const toImageCoords = useCallback((e: React.PointerEvent) => {
    const display = displayRef.current;
    const work = workCanvasesRef.current[pageIndex];
    if (!display || !work) return null;
    const rect = display.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * work.width;
    const y = ((e.clientY - rect.top) / rect.height) * work.height;
    return { x, y };
  }, [pageIndex]);

  /** Redraw the visible canvas: image + translucent mask + rectangle preview. */
  const redraw = useCallback(() => {
    const display = displayRef.current;
    const container = containerRef.current;
    const work = workCanvasesRef.current[pageIndex];
    const mask = maskCanvasesRef.current[pageIndex];
    if (!display || !work || !container) return;

    const maxW = container.clientWidth;
    const maxH = Math.max(320, window.innerHeight - 320);
    const scale = Math.min(maxW / work.width, maxH / work.height, 1.5);
    const w = Math.round(work.width * scale);
    const h = Math.round(work.height * scale);
    display.width = w;
    display.height = h;

    const ctx = display.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(work, 0, 0, w, h);

    if (mask) {
      // Tint the masked region red so the user sees what will be removed.
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.globalCompositeOperation = "source-over";
      const tinted = tintMask(mask);
      ctx.drawImage(tinted, 0, 0, w, h);
      ctx.restore();
    }

    // Live rectangle preview.
    const start = rectStartRef.current;
    const cur = rectCurrentRef.current;
    if (tool === "rect" && start && cur) {
      ctx.save();
      ctx.strokeStyle = "rgba(220,38,38,0.9)";
      ctx.fillStyle = "rgba(220,38,38,0.25)";
      ctx.lineWidth = 2;
      const x = Math.min(start.x, cur.x) * scale;
      const y = Math.min(start.y, cur.y) * scale;
      const rw = Math.abs(cur.x - start.x) * scale;
      const rh = Math.abs(cur.y - start.y) * scale;
      ctx.fillRect(x, y, rw, rh);
      ctx.strokeRect(x, y, rw, rh);
      ctx.restore();
    }
  }, [pageIndex, tool]);

  // Redraw whenever the page changes or the window resizes.
  useEffect(() => {
    redraw();
    const onResize = () => redraw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [redraw]);

  const refreshUndoState = useCallback(() => {
    setCanUndo((historyRef.current[pageIndex]?.length ?? 0) > 0);
  }, [pageIndex]);

  const handleFiles = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setBusy(true);
      try {
        const pages: LoadedPage[] = await loadPages(file);
        workCanvasesRef.current = pages.map((p) => p.canvas);
        maskCanvasesRef.current = pages.map((p) => {
          const c = document.createElement("canvas");
          c.width = p.width;
          c.height = p.height;
          return c;
        });
        historyRef.current = pages.map(() => []);
        setFileName(file.name);
        setPageCount(pages.length);
        setPageIndex(0);
        setCanUndo(false);
        // Defer redraw until refs + state have settled.
        requestAnimationFrame(redraw);
      } catch (err) {
        toast({
          title: "Chargement impossible",
          description: err instanceof Error ? err.message : "Fichier non pris en charge",
          variant: "destructive",
        });
      } finally {
        setBusy(false);
      }
    },
    [redraw, toast],
  );

  // ---- Drawing on the mask ------------------------------------------------

  const paintAt = useCallback(
    (x: number, y: number, prev: { x: number; y: number } | null) => {
      const mask = maskCanvasesRef.current[pageIndex];
      if (!mask) return;
      const ctx = mask.getContext("2d");
      if (!ctx) return;

      ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = brushSize;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.beginPath();
      ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();

      if (prev) {
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    },
    [pageIndex, tool, brushSize],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (busy || !workCanvasesRef.current[pageIndex]) return;
      const pt = toImageCoords(e);
      if (!pt) return;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      drawingRef.current = true;

      if (tool === "rect") {
        rectStartRef.current = pt;
        rectCurrentRef.current = pt;
      } else {
        lastPtRef.current = pt;
        paintAt(pt.x, pt.y, null);
        redraw();
      }
    },
    [busy, pageIndex, tool, toImageCoords, paintAt, redraw],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drawingRef.current) return;
      const pt = toImageCoords(e);
      if (!pt) return;

      if (tool === "rect") {
        rectCurrentRef.current = pt;
      } else {
        paintAt(pt.x, pt.y, lastPtRef.current);
        lastPtRef.current = pt;
      }
      redraw();
    },
    [tool, toImageCoords, paintAt, redraw],
  );

  const onPointerUp = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;

    if (tool === "rect") {
      const start = rectStartRef.current;
      const cur = rectCurrentRef.current;
      const mask = maskCanvasesRef.current[pageIndex];
      if (start && cur && mask) {
        const ctx = mask.getContext("2d");
        if (ctx) {
          ctx.globalCompositeOperation = "source-over";
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(
            Math.min(start.x, cur.x),
            Math.min(start.y, cur.y),
            Math.abs(cur.x - start.x),
            Math.abs(cur.y - start.y),
          );
        }
      }
      rectStartRef.current = null;
      rectCurrentRef.current = null;
    }
    lastPtRef.current = null;
    redraw();
  }, [tool, pageIndex, redraw]);

  // ---- Actions ------------------------------------------------------------

  const clearMask = useCallback(() => {
    const mask = maskCanvasesRef.current[pageIndex];
    if (!mask) return;
    mask.getContext("2d")?.clearRect(0, 0, mask.width, mask.height);
    redraw();
  }, [pageIndex, redraw]);

  const applyRemoval = useCallback(async () => {
    const work = workCanvasesRef.current[pageIndex];
    const mask = maskCanvasesRef.current[pageIndex];
    if (!work || !mask) return;

    const workCtx = work.getContext("2d");
    const maskCtx = mask.getContext("2d");
    if (!workCtx || !maskCtx) return;

    const maskImg = maskCtx.getImageData(0, 0, mask.width, mask.height);
    const binary = new Uint8Array(mask.width * mask.height);
    let any = false;
    for (let i = 0; i < binary.length; i++) {
      if (maskImg.data[i * 4 + 3] > 16) {
        binary[i] = 1;
        any = true;
      }
    }
    if (!any) {
      toast({
        title: "Rien à effacer",
        description: "Peins d'abord sur le filigrane à supprimer.",
      });
      return;
    }

    setBusy(true);
    // Yield so the spinner can paint before the (synchronous) heavy compute.
    await new Promise((r) => setTimeout(r, 20));
    try {
      const src = workCtx.getImageData(0, 0, work.width, work.height);

      // Save for undo (capped).
      const stack = historyRef.current[pageIndex];
      stack.push(new ImageData(new Uint8ClampedArray(src.data), src.width, src.height));
      if (stack.length > MAX_HISTORY) stack.shift();

      const result = inpaint(
        { data: src.data, width: src.width, height: src.height },
        binary,
        { iterations: strength },
      );
      workCtx.putImageData(new ImageData(result, src.width, src.height), 0, 0);
      clearMask();
      refreshUndoState();
      toast({ title: "Filigrane effacé", description: "Tu peux affiner ou télécharger." });
    } catch (err) {
      toast({
        title: "Échec du traitement",
        description: err instanceof Error ? err.message : "Erreur inconnue",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }, [pageIndex, strength, clearMask, refreshUndoState, toast]);

  const undo = useCallback(() => {
    const work = workCanvasesRef.current[pageIndex];
    const stack = historyRef.current[pageIndex];
    if (!work || !stack || stack.length === 0) return;
    const prev = stack.pop()!;
    work.getContext("2d")?.putImageData(prev, 0, 0);
    refreshUndoState();
    redraw();
  }, [pageIndex, refreshUndoState, redraw]);

  const downloadPng = useCallback(async () => {
    const work = workCanvasesRef.current[pageIndex];
    if (!work) return;
    const blob = await canvasToPngBlob(work);
    const suffix = pageCount > 1 ? `-p${pageIndex + 1}` : "";
    triggerDownload(blob, `${baseName}${suffix}-sans-filigrane.png`);
  }, [pageIndex, pageCount, baseName]);

  const downloadPdf = useCallback(() => {
    if (workCanvasesRef.current.length === 0) return;
    const blob = canvasesToPdf(workCanvasesRef.current);
    triggerDownload(blob, `${baseName}-sans-filigrane.pdf`);
  }, [baseName]);

  const goToPage = useCallback(
    (next: number) => {
      if (next < 0 || next >= pageCount) return;
      setPageIndex(next);
      requestAnimationFrame(() => {
        refreshUndoState();
        redraw();
      });
    },
    [pageCount, refreshUndoState, redraw],
  );

  const hasFile = pageCount > 0;

  return (
    <div className="container mx-auto max-w-5xl px-4 py-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Wand2 className="h-6 w-6 text-primary" />
          Suppression de filigrane
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Charge ton image ou PDF, peins sur ta marque, et le fond est reconstruit
          automatiquement. Tout se passe dans ton navigateur — aucun fichier n'est envoyé.
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files?.[0])}
      />

      {!hasFile ? (
        <Card
          className="border-dashed border-2 flex flex-col items-center justify-center gap-3 py-16 cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFiles(e.dataTransfer.files?.[0]);
          }}
        >
          {busy ? (
            <Loader2 className="h-10 w-10 text-primary animate-spin" />
          ) : (
            <Upload className="h-10 w-10 text-muted-foreground" />
          )}
          <p className="font-medium">Clique ou dépose un fichier ici</p>
          <p className="text-xs text-muted-foreground">PNG, JPG, WEBP, GIF, BMP ou PDF</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Toolbar */}
          <Card className="p-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              <ToolButton active={tool === "brush"} onClick={() => setTool("brush")} title="Pinceau">
                <Brush className="h-4 w-4" />
              </ToolButton>
              <ToolButton active={tool === "eraser"} onClick={() => setTool("eraser")} title="Gomme (masque)">
                <Eraser className="h-4 w-4" />
              </ToolButton>
              <ToolButton active={tool === "rect"} onClick={() => setTool("rect")} title="Rectangle">
                <Square className="h-4 w-4" />
              </ToolButton>
            </div>

            <div className="flex items-center gap-2 min-w-[160px]">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Taille {brushSize}</span>
              <Slider
                value={[brushSize]}
                min={4}
                max={120}
                step={2}
                onValueChange={(v) => setBrushSize(v[0])}
                className="w-28"
              />
            </div>

            <div className="flex items-center gap-2 min-w-[170px]">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Intensité {strength}</span>
              <Slider
                value={[strength]}
                min={10}
                max={120}
                step={5}
                onValueChange={(v) => setStrength(v[0])}
                className="w-28"
              />
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <Button size="sm" variant="ghost" onClick={clearMask} disabled={busy}>
                <RotateCcw className="h-4 w-4 mr-1" /> Masque
              </Button>
              <Button size="sm" variant="ghost" onClick={undo} disabled={busy || !canUndo}>
                <Undo2 className="h-4 w-4 mr-1" /> Annuler
              </Button>
              <Button size="sm" onClick={applyRemoval} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
                Effacer
              </Button>
            </div>
          </Card>

          {/* Canvas */}
          <Card className="p-3" ref={containerRef as React.RefObject<HTMLDivElement>}>
            <div className="flex justify-center bg-[repeating-conic-gradient(#f0f0f0_0_25%,#fafafa_0_50%)] bg-[length:20px_20px] rounded-md overflow-hidden">
              <canvas
                ref={displayRef}
                className={cn(
                  "max-w-full touch-none",
                  tool === "eraser" ? "cursor-cell" : "cursor-crosshair",
                )}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
              />
            </div>

            {pageCount > 1 && (
              <div className="flex items-center justify-center gap-3 mt-3">
                <Button size="icon" variant="outline" onClick={() => goToPage(pageIndex - 1)} disabled={pageIndex === 0}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {pageIndex + 1} / {pageCount}
                </span>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => goToPage(pageIndex + 1)}
                  disabled={pageIndex === pageCount - 1}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </Card>

          {/* Bottom actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={downloadPng}>
              <Download className="h-4 w-4 mr-1" /> Télécharger PNG
            </Button>
            <Button variant="outline" onClick={downloadPdf}>
              <FileDown className="h-4 w-4 mr-1" /> Télécharger PDF
            </Button>
            <Button
              variant="ghost"
              className="ml-auto text-muted-foreground"
              onClick={() => {
                workCanvasesRef.current = [];
                maskCanvasesRef.current = [];
                historyRef.current = [];
                setPageCount(0);
                setFileName("");
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            >
              <ImageOff className="h-4 w-4 mr-1" /> Nouveau fichier
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant={active ? "default" : "outline"}
      onClick={onClick}
      title={title}
      className="h-9 w-9"
    >
      {children}
    </Button>
  );
}

/**
 * Produce a red-tinted copy of the mask (white -> red, transparent stays
 * transparent) for the visual overlay.
 */
function tintMask(mask: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = mask.width;
  out.height = mask.height;
  const ctx = out.getContext("2d");
  if (!ctx) return out;
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "#dc2626";
  ctx.fillRect(0, 0, out.width, out.height);
  return out;
}
