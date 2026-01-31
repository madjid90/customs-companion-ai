// ============================================================================
// DATA MASKING UTILITY - Production Hardening
// ============================================================================
// Masks sensitive data in logs (DUM numbers, names, addresses, phone numbers)
// ============================================================================

/**
 * Patterns for sensitive data detection
 */
const SENSITIVE_PATTERNS = {
  // DUM numbers: 123456/2024, DUM-123456
  dum_number: /\b(?:DUM[- ]?)?\d{5,8}(?:\/\d{2,4})?\b/gi,
  
  // ICE (Identifiant Commun de l'Entreprise): 15 digits
  ice: /\b\d{15}\b/g,
  
  // Moroccan phone numbers: +212... or 06/07...
  phone_ma: /(?:\+212|0)[5-7]\d{8}\b/g,
  
  // International phone: +XX XXXXXXXXX
  phone_intl: /\+\d{1,4}[\s.-]?\d{6,12}\b/g,
  
  // Email addresses
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
  
  // Moroccan addresses: common patterns
  address_ma: /(?:rue|avenue|bd|boulevard|lot|résidence|immeuble|n[°o])\s+[^\n,]{5,50}/gi,
  
  // Credit card / bank account patterns
  card_number: /\b\d{4}[\s.-]?\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b/g,
  
  // RC (Registre de Commerce)
  rc_number: /\bRC[\s:]?\d{4,10}\b/gi,
  
  // Passport / CIN numbers
  identity_doc: /\b[A-Z]{1,2}\d{6,8}\b/g,
  
  // Names (basic pattern for Arabic/French names after keywords)
  name_after_keyword: /(?:importateur|exportateur|client|fournisseur|société|ste|sarl|sa)[\s:]+([A-Za-zÀ-ÿ\u0600-\u06FF\s]{3,40})/gi,
};

/**
 * Mask a string value with asterisks, keeping first/last chars
 */
function maskValue(value: string, keepStart = 2, keepEnd = 2): string {
  if (value.length <= keepStart + keepEnd + 2) {
    return "*".repeat(value.length);
  }
  const start = value.slice(0, keepStart);
  const end = value.slice(-keepEnd);
  const middle = "*".repeat(Math.min(value.length - keepStart - keepEnd, 8));
  return `${start}${middle}${end}`;
}

/**
 * Mask a phone number
 */
function maskPhone(phone: string): string {
  // Keep country code + last 2 digits
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  const prefix = digits.slice(0, 3);
  const suffix = digits.slice(-2);
  return `${prefix}*****${suffix}`;
}

/**
 * Mask an email address
 */
function maskEmail(email: string): string {
  const parts = email.split("@");
  if (parts.length !== 2) return "***@***";
  const local = parts[0];
  const domain = parts[1];
  const maskedLocal = local.length > 2 ? local[0] + "***" + local.slice(-1) : "***";
  return `${maskedLocal}@${domain}`;
}

/**
 * Mask a DUM number (keep structure visible)
 */
function maskDumNumber(dum: string): string {
  // "123456/2024" -> "12***6/2024"
  const match = dum.match(/^(.*?)(\d{5,8})(\/\d{2,4})?$/);
  if (match) {
    const prefix = match[1] || "";
    const num = match[2];
    const suffix = match[3] || "";
    return `${prefix}${num.slice(0, 2)}***${num.slice(-1)}${suffix}`;
  }
  return maskValue(dum);
}

/**
 * Main function: Mask all sensitive data in a string
 */
export function maskSensitiveData(text: string): string {
  if (!text || typeof text !== "string") return text;
  
  let masked = text;
  
  // DUM numbers
  masked = masked.replace(SENSITIVE_PATTERNS.dum_number, (match) => maskDumNumber(match));
  
  // ICE
  masked = masked.replace(SENSITIVE_PATTERNS.ice, (match) => maskValue(match, 3, 2));
  
  // Phone numbers
  masked = masked.replace(SENSITIVE_PATTERNS.phone_ma, (match) => maskPhone(match));
  masked = masked.replace(SENSITIVE_PATTERNS.phone_intl, (match) => maskPhone(match));
  
  // Emails
  masked = masked.replace(SENSITIVE_PATTERNS.email, (match) => maskEmail(match));
  
  // Addresses
  masked = masked.replace(SENSITIVE_PATTERNS.address_ma, (match) => {
    const parts = match.split(/\s+/);
    if (parts.length > 2) {
      return parts[0] + " " + parts[1] + " ***";
    }
    return parts[0] + " ***";
  });
  
  // Card numbers
  masked = masked.replace(SENSITIVE_PATTERNS.card_number, (match) => {
    const digits = match.replace(/\D/g, "");
    return `${digits.slice(0, 4)}-****-****-${digits.slice(-4)}`;
  });
  
  // RC numbers
  masked = masked.replace(SENSITIVE_PATTERNS.rc_number, (match) => maskValue(match, 3, 2));
  
  // Identity docs
  masked = masked.replace(SENSITIVE_PATTERNS.identity_doc, (match) => maskValue(match, 2, 2));
  
  // Names after keywords
  masked = masked.replace(SENSITIVE_PATTERNS.name_after_keyword, (match, name) => {
    const keyword = match.slice(0, match.length - name.length);
    return keyword + maskValue(name.trim(), 2, 1);
  });
  
  return masked;
}

/**
 * Mask sensitive fields in an object (deep)
 */
export function maskSensitiveObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === "string") {
    return maskSensitiveData(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => maskSensitiveObject(item));
  }
  
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    
    // Sensitive field names that should be fully masked
    const sensitiveFields = new Set([
      "name", "importer_name", "exporter_name", "client_name",
      "address", "adresse", "rue", "street",
      "phone", "telephone", "tel", "mobile",
      "email", "mail", "courriel",
      "ice", "rc", "cin", "passport",
      "dum_number", "numero_dum",
      "bank_account", "compte_bancaire", "iban",
      "importer_id", "exporter_id",
    ]);
    
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      
      if (sensitiveFields.has(lowerKey) && typeof value === "string") {
        result[key] = maskValue(value, 2, 2);
      } else {
        result[key] = maskSensitiveObject(value);
      }
    }
    
    return result;
  }
  
  return obj;
}

/**
 * Create a masked log message for production
 */
export function createMaskedLog(
  functionName: string,
  action: string,
  data: Record<string, unknown> = {}
): string {
  const maskedData = maskSensitiveObject(data);
  
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    function: functionName,
    action,
    data: maskedData,
  });
}

/**
 * Safely log without exposing sensitive data
 */
export function safeLog(
  level: "debug" | "info" | "warn" | "error",
  functionName: string,
  message: string,
  data?: Record<string, unknown>
): void {
  const maskedMessage = maskSensitiveData(message);
  const logEntry = createMaskedLog(functionName, maskedMessage, data || {});
  
  switch (level) {
    case "debug":
      console.debug(logEntry);
      break;
    case "info":
      console.log(logEntry);
      break;
    case "warn":
      console.warn(logEntry);
      break;
    case "error":
      console.error(logEntry);
      break;
  }
}
