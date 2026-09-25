import { createHash } from "node:crypto";

export const FUSION_PIPELINE_VERSION = "page-fusion-v1";
export const FUSION_ALGORITHM_VERSION = "deterministic-page-fusion-v1";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value) => Math.round(value * 100) / 100;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function normalizeExtractedText(value = "") {
  return value
    .replaceAll("\u0000", "")
    .normalize("NFC")
    .replace(/[ \t]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function tokens(value) {
  return new Set(normalizeExtractedText(value).toLocaleLowerCase("fr").match(/[\p{L}\p{N}]{2,}/gu) || []);
}

export function tokenSimilarity(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function assessCandidate(candidate) {
  const text = normalizeExtractedText(candidate.text);
  const length = text.length;
  const words = text.match(/[\p{L}\p{N}]+/gu) || [];
  const replacementCount = (text.match(/�/gu) || []).length;
  const controlCount = (text.match(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/gu) || []).length;
  const usefulCount = (text.match(/[\p{L}\p{N}\p{P}\p{S}]/gu) || []).length;
  const usefulRatio = length ? usefulCount / length : 0;
  const uniqueRatio = words.length ? new Set(words.map((word) => word.toLocaleLowerCase("fr"))).size / words.length : 0;
  const confidence = clamp(Number(candidate.confidence ?? 50), 0, 100);

  const coverage = clamp(Math.log10(Math.max(length, 1)) / 3.5, 0, 1);
  const lexical = clamp(words.length / 40, 0, 1) * 0.55 + clamp(uniqueRatio / 0.45, 0, 1) * 0.45;
  const corruptionPenalty = clamp((replacementCount * 6 + controlCount * 10) / Math.max(length, 1), 0, 0.5);
  const score = clamp(
    coverage * 42 + lexical * 23 + usefulRatio * 15 + confidence * 0.2 - corruptionPenalty * 100,
    0,
    100,
  );

  const issues = [];
  if (length < 80) issues.push("short_text");
  if (replacementCount > 0) issues.push("replacement_characters");
  if (controlCount > 0) issues.push("control_characters");
  if (usefulRatio < 0.55) issues.push("low_useful_character_ratio");

  return {
    ...candidate,
    text,
    textSha256: sha256(text),
    score: round(score),
    metrics: {
      characters: length,
      words: words.length,
      confidence: round(confidence),
      usefulRatio: round(usefulRatio),
      uniqueWordRatio: round(uniqueRatio),
      replacementCount,
      controlCount,
    },
    issues,
  };
}

export function decidePageFusion(candidates, options = {}) {
  const minimumScore = options.minimumScore ?? 55;
  const minimumMargin = options.minimumMargin ?? 6;
  const assessed = candidates.map(assessCandidate).sort((a, b) => b.score - a.score || a.source.localeCompare(b.source));
  const usable = assessed.filter((candidate) => candidate.text.length > 0);
  if (!usable.length) {
    return {
      status: "rejected",
      selected: null,
      reasonCodes: ["no_usable_candidate"],
      candidates: assessed,
      inputSignature: sha256(JSON.stringify(assessed.map(candidateIdentity))),
    };
  }

  const selected = usable[0];
  const runnerUp = usable[1];
  const margin = runnerUp ? selected.score - runnerUp.score : selected.score;
  const similarity = runnerUp ? tokenSimilarity(selected.text, runnerUp.text) : 1;
  const reasonCodes = [`selected_${selected.source}`];
  let status = "selected";
  if (selected.score < minimumScore) {
    status = "review_required";
    reasonCodes.push("score_below_threshold");
  }
  if (runnerUp && margin < minimumMargin && similarity < 0.72) {
    status = "review_required";
    reasonCodes.push("close_scores_with_text_disagreement");
  }
  if (selected.issues.length) reasonCodes.push(...selected.issues.map((issue) => `selected_${issue}`));

  return {
    status,
    selected,
    reasonCodes: [...new Set(reasonCodes)],
    candidates: assessed,
    inputSignature: sha256(JSON.stringify(assessed.map(candidateIdentity))),
    comparison: { margin: round(margin), runnerUpSimilarity: round(similarity) },
  };
}

function candidateIdentity(candidate) {
  return {
    source: candidate.source,
    engineOutputId: candidate.engineOutputId || null,
    textSha256: candidate.textSha256,
    confidence: candidate.metrics.confidence,
    score: candidate.score,
  };
}

export function serializeFusionCandidates(decision) {
  return decision.candidates.map((candidate) => ({
    ...candidateIdentity(candidate),
    metrics: candidate.metrics,
    issues: candidate.issues,
  }));
}

