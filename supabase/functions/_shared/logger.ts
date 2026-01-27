// ============================================================================
// STRUCTURED LOGGING
// ============================================================================

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

interface LogContext {
  [key: string]: unknown;
}

export class Logger {
  private functionName: string;
  private requestId: string;
  private clientId: string;
  private startTime: number;
  
  constructor(functionName: string, request: Request) {
    this.functionName = functionName;
    this.requestId = request.headers.get("x-request-id") || crypto.randomUUID();
    this.clientId = 
      request.headers.get("x-client-id") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("cf-connecting-ip") ||
      "anonymous";
    this.startTime = Date.now();
  }
  
  private formatLog(level: LogLevel, message: string, context: LogContext = {}): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      function: this.functionName,
      requestId: this.requestId,
      clientId: this.clientId,
      durationMs: Date.now() - this.startTime,
      message,
      ...context
    });
  }
  
  debug(message: string, context?: LogContext) {
    console.debug(this.formatLog("DEBUG", message, context));
  }
  
  info(message: string, context?: LogContext) {
    console.log(this.formatLog("INFO", message, context));
  }
  
  warn(message: string, context?: LogContext) {
    console.warn(this.formatLog("WARN", message, context));
  }
  
  error(message: string, error?: Error, context?: LogContext) {
    console.error(this.formatLog("ERROR", message, {
      ...context,
      errorName: error?.name,
      errorMessage: error?.message,
      errorStack: error?.stack?.split("\n").slice(0, 5).join("\n")
    }));
  }
  
  getRequestId(): string {
    return this.requestId;
  }
  
  getResponseHeaders(): Record<string, string> {
    return { "x-request-id": this.requestId };
  }
}

export function createLogger(functionName: string, request: Request): Logger {
  return new Logger(functionName, request);
}
