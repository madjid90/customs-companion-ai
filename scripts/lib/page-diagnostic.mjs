export const DIAGNOSTIC_VERSION = "page-diagnostic-v2";

export function classifyPage(metrics) {
  const text = Number(metrics.textCharacters || 0);
  const ink = Number(metrics.inkRatio || 0);
  const images = Number(metrics.imageObjects || 0);
  const paths = Number(metrics.pathObjects || 0);
  const tableSignals = Boolean(metrics.hasTableSignals);
  const formSignals = Boolean(metrics.hasFormSignals);

  if (text < 5 && ink < 0.006) return decision("blank", "none", 95, ["negligible_text_and_ink"]);
  if (formSignals) return decision("form", text >= 20 ? "hybrid" : "vision", 82, ["form_signals"]);
  if (tableSignals) return decision("table", text >= 20 ? "layout" : "vision", 82, ["table_signals"]);
  if (text < 20 && images > 0 && ink >= 0.01) return decision("scanned", "ocr", 90, ["image_with_visible_ink"]);
  if (text >= 80 && images > 0) return decision("hybrid", "hybrid", 82, ["text_and_images"]);
  if (text >= 80) return decision("native_text", "native_pdf", 92, ["usable_text_layer"]);
  if (text < 80 && paths >= 20 && images === 0) return decision("vector_complex", "layout", 75, ["vector_content_without_text"]);
  if (text > 0) return decision("short_text", "compare", 65, ["short_text_requires_comparison"]);
  return decision("unknown", "vision", 35, ["content_not_classified"]);
}

function decision(pageClass, strategy, confidence, reasons) {
  return { pageClass, strategy, confidence, reasons };
}

