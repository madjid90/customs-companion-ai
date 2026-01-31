// ============================================================================
// JSON PARSING RESILIENT - Production Hardening
// ============================================================================
// Robust JSON parsing with fallback extraction and partial data recovery
// ============================================================================

export interface ParseResult<T> {
  success: boolean;
  data: T | null;
  partial: boolean;
  error?: string;
  recoveredFields?: string[];
}

/**
 * Repair common JSON truncation issues
 */
function repairTruncatedJson(text: string): string {
  let repaired = text.trim();
  
  // Remove trailing commas before closing brackets
  repaired = repaired.replace(/,\s*([}\]])/g, '$1');
  
  // Remove incomplete key-value pairs at the end
  repaired = repaired.replace(/,\s*"[^"]*":\s*$/g, '');
  repaired = repaired.replace(/,\s*"[^"]*":\s*"[^"]*$/g, '');
  
  // Count and balance brackets
  const openBraces = (repaired.match(/\{/g) || []).length;
  const closeBraces = (repaired.match(/\}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;
  
  // Close unclosed arrays first, then objects
  for (let i = 0; i < openBrackets - closeBrackets; i++) {
    repaired += "]";
  }
  for (let i = 0; i < openBraces - closeBraces; i++) {
    repaired += "}";
  }
  
  return repaired;
}

/**
 * Extract JSON from markdown code blocks
 */
function extractJsonFromMarkdown(text: string): string | null {
  // Try ```json block
  const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    return jsonBlockMatch[1].trim();
  }
  
  // Try generic ``` block
  const codeBlockMatch = text.match(/```\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    const content = codeBlockMatch[1].trim();
    if (content.startsWith("{") || content.startsWith("[")) {
      return content;
    }
  }
  
  return null;
}

/**
 * Find the largest valid JSON object in text
 */
function extractLargestJsonObject(text: string): string | null {
  // Find all potential JSON objects
  const objectPattern = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
  const matches = text.match(objectPattern);
  
  if (!matches || matches.length === 0) {
    // Try to find incomplete object
    const startIdx = text.indexOf("{");
    if (startIdx !== -1) {
      return text.slice(startIdx);
    }
    return null;
  }
  
  // Return the largest match
  return matches.reduce((a, b) => a.length > b.length ? a : b);
}

/**
 * Extract specific fields from partial/malformed JSON
 */
function extractPartialFields(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  
  // Extract string fields: "fieldName": "value"
  const stringPattern = /"([^"]+)":\s*"([^"]*(?:\\.[^"]*)*)"/g;
  let match;
  while ((match = stringPattern.exec(text)) !== null) {
    const [, key, value] = match;
    result[key] = value.replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }
  
  // Extract number fields: "fieldName": 123.45
  const numberPattern = /"([^"]+)":\s*(-?\d+(?:\.\d+)?)/g;
  while ((match = numberPattern.exec(text)) !== null) {
    const [, key, value] = match;
    result[key] = parseFloat(value);
  }
  
  // Extract boolean fields: "fieldName": true/false
  const boolPattern = /"([^"]+)":\s*(true|false)/g;
  while ((match = boolPattern.exec(text)) !== null) {
    const [, key, value] = match;
    result[key] = value === "true";
  }
  
  // Extract null fields: "fieldName": null
  const nullPattern = /"([^"]+)":\s*null/g;
  while ((match = nullPattern.exec(text)) !== null) {
    const [, key] = match;
    result[key] = null;
  }
  
  // Extract arrays (shallow): "fieldName": [...]
  const arrayPattern = /"([^"]+)":\s*\[([\s\S]*?)\]/g;
  while ((match = arrayPattern.exec(text)) !== null) {
    const [, key, content] = match;
    try {
      result[key] = JSON.parse(`[${content}]`);
    } catch {
      // If array parsing fails, store as raw string
      result[key] = content.split(",").map(s => s.trim().replace(/^["']|["']$/g, ""));
    }
  }
  
  return result;
}

/**
 * Main function: Parse JSON with multiple fallback strategies
 */
export function parseJsonResilient<T = unknown>(text: string): ParseResult<T> {
  if (!text || typeof text !== "string") {
    return { success: false, data: null, partial: false, error: "Invalid input" };
  }
  
  const cleanText = text.trim();
  
  // Strategy 1: Direct parse
  try {
    const data = JSON.parse(cleanText) as T;
    return { success: true, data, partial: false };
  } catch {
    // Continue to fallbacks
  }
  
  // Strategy 2: Extract from markdown code block
  const fromMarkdown = extractJsonFromMarkdown(cleanText);
  if (fromMarkdown) {
    try {
      const data = JSON.parse(fromMarkdown) as T;
      return { success: true, data, partial: false };
    } catch {
      // Try repairing the markdown extract
      const repaired = repairTruncatedJson(fromMarkdown);
      try {
        const data = JSON.parse(repaired) as T;
        return { success: true, data, partial: true, recoveredFields: ["repaired_from_markdown"] };
      } catch {
        // Continue
      }
    }
  }
  
  // Strategy 3: Repair truncated JSON
  const repaired = repairTruncatedJson(cleanText);
  try {
    const data = JSON.parse(repaired) as T;
    return { success: true, data, partial: true, recoveredFields: ["repaired_truncation"] };
  } catch {
    // Continue
  }
  
  // Strategy 4: Extract largest JSON object
  const largestJson = extractLargestJsonObject(cleanText);
  if (largestJson) {
    const repairedLargest = repairTruncatedJson(largestJson);
    try {
      const data = JSON.parse(repairedLargest) as T;
      return { success: true, data, partial: true, recoveredFields: ["extracted_object"] };
    } catch {
      // Continue
    }
  }
  
  // Strategy 5: Extract partial fields
  const partialData = extractPartialFields(cleanText);
  if (Object.keys(partialData).length > 0) {
    return {
      success: true,
      data: partialData as T,
      partial: true,
      recoveredFields: Object.keys(partialData),
      error: "Partial extraction only",
    };
  }
  
  // All strategies failed
  return {
    success: false,
    data: null,
    partial: false,
    error: "Failed to parse JSON after all fallback strategies",
  };
}

/**
 * Parse with expected schema validation
 */
export function parseJsonWithSchema<T>(
  text: string,
  requiredFields: string[],
  defaults: Partial<T> = {}
): ParseResult<T> {
  const result = parseJsonResilient<Record<string, unknown>>(text);
  
  if (!result.success || !result.data) {
    // Return defaults if parsing completely failed
    if (Object.keys(defaults).length > 0) {
      return {
        success: true,
        data: defaults as T,
        partial: true,
        error: "Used defaults due to parse failure",
        recoveredFields: Object.keys(defaults),
      };
    }
    return { success: false, data: null, partial: false, error: result.error };
  }
  
  // Merge with defaults for missing required fields
  const data = { ...defaults, ...result.data } as T;
  const missingFields: string[] = [];
  
  for (const field of requiredFields) {
    if (!(field in (data as Record<string, unknown>)) || (data as Record<string, unknown>)[field] === undefined) {
      missingFields.push(field);
    }
  }
  
  if (missingFields.length > 0) {
    return {
      success: true,
      data,
      partial: true,
      error: `Missing required fields: ${missingFields.join(", ")}`,
      recoveredFields: result.recoveredFields,
    };
  }
  
  return {
    success: true,
    data,
    partial: result.partial,
    recoveredFields: result.recoveredFields,
  };
}
