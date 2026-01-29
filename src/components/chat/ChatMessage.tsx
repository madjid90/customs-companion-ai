import { useState } from "react";
import { Bot, User, ThumbsUp, ThumbsDown, Database, FileText, AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { InteractiveQuestions, parseQuestionsFromResponse } from "./InteractiveQuestions";
import { DocumentPreviewDialog } from "./DocumentPreviewDialog";

interface MessageContext {
  hs_codes_found: number;
  tariffs_found: number;
  controlled_found: number;
  documents_found: number;
  pdfs_used: number;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  confidence?: "high" | "medium" | "low";
  feedback?: "up" | "down";
  conversationId?: string;
  context?: MessageContext;
}

interface ChatMessageProps {
  message: Message;
  isLastMessage: boolean;
  isLoading: boolean;
  onFeedback: (messageId: string, type: "up" | "down") => void;
  onAnswer: (answer: string) => void;
  cleanContent: (content: string) => string;
  removeQuestions: (content: string) => string;
}

const confidenceConfig = {
  high: { icon: "🟢", label: "Confiance haute", className: "text-success" },
  medium: { icon: "🟡", label: "Confiance moyenne", className: "text-warning" },
  low: { icon: "🔴", label: "Confiance faible", className: "text-destructive" },
};

export function ChatMessage({
  message,
  isLastMessage,
  isLoading,
  onFeedback,
  onAnswer,
  cleanContent,
  removeQuestions,
}: ChatMessageProps) {
  const [previewDoc, setPreviewDoc] = useState<{ url: string; title: string } | null>(null);
  
  const isUser = message.role === "user";
  const isError = message.content.startsWith("⚠️");

  // Check if a URL is a document (PDF, etc.)
  const isDocumentUrl = (url: string) => {
    return url.includes('.pdf') || 
           url.includes('/storage/') || 
           url.includes('pdf-documents') ||
           url.includes('supabase.co/storage');
  };

  // Extract title from URL or link text
  const extractDocTitle = (url: string, linkText?: string) => {
    if (linkText && linkText.length > 3) {
      return linkText.replace(/[\[\]📥📄]/g, '').trim();
    }
    try {
      const urlParts = url.split('/');
      const filename = urlParts[urlParts.length - 1];
      return decodeURIComponent(filename.replace(/_/g, ' ').replace(/\d{13}_/, ''));
    } catch {
      return "Document";
    }
  };

  return (
    <div
      className={cn(
        "flex gap-3 md:gap-4 animate-slide-up",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <div className="flex-shrink-0 w-9 h-9 md:w-10 md:h-10 rounded-xl bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center shadow-sm border border-accent/10">
          <Bot className="h-4 w-4 md:h-5 md:w-5 text-accent" />
        </div>
      )}

      <div
        className={cn(
          "max-w-[85%] md:max-w-[80%] rounded-2xl px-4 py-3 md:px-5 md:py-4 transition-all",
          isUser
            ? "bg-chat-user text-chat-user-foreground chat-message-user shadow-md"
            : "bg-chat-ai text-chat-ai-foreground chat-message-ai"
        )}
      >
        {!isUser && !isError ? (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown
              rehypePlugins={[[rehypeSanitize, {
                ...defaultSchema,
                tagNames: [
                  ...(defaultSchema.tagNames || []),
                  'table', 'thead', 'tbody', 'tr', 'th', 'td'
                ],
                attributes: {
                  ...defaultSchema.attributes,
                  '*': ['className'],
                },
              }]]}
              components={{
                h2: ({ children }) => <h2 className="text-base font-semibold mt-4 mb-2 first:mt-0 text-foreground">{children}</h2>,
                h3: ({ children }) => <h3 className="text-sm font-semibold mt-3 mb-1 text-foreground">{children}</h3>,
                ul: ({ children }) => <ul className="my-2 space-y-1.5">{children}</ul>,
                ol: ({ children }) => <ol className="my-2 space-y-1.5 list-decimal pl-4">{children}</ol>,
                li: ({ children }) => <li className="text-sm leading-relaxed">{children}</li>,
                p: ({ children }) => <p className="text-sm leading-relaxed my-2 first:mt-0 last:mb-0">{children}</p>,
                strong: ({ children }) => <strong className="font-semibold text-accent">{children}</strong>,
                code: ({ children }) => <code className="bg-muted/50 px-1.5 py-0.5 rounded text-xs font-mono text-accent">{children}</code>,
                table: ({ children }) => (
                  <div className="overflow-x-auto my-3 rounded-lg border border-border">
                    <table className="min-w-full text-sm border-collapse">{children}</table>
                  </div>
                ),
                th: ({ children }) => <th className="border-b border-border px-3 py-2 bg-muted/30 font-medium text-left text-xs uppercase tracking-wide">{children}</th>,
                td: ({ children }) => <td className="border-b border-border/50 px-3 py-2">{children}</td>,
                a: ({ href, children }) => {
                  const url = href || '';
                  const linkText = typeof children === 'string' ? children : '';
                  
                  if (isDocumentUrl(url)) {
                    return (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          setPreviewDoc({ url, title: extractDocTitle(url, linkText) });
                        }}
                        className="inline-flex items-center gap-1.5 text-primary hover:text-primary/80 underline underline-offset-2 transition-colors font-medium cursor-pointer"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        {children || "Voir le document"}
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    );
                  }
                  
                  return (
                    <a 
                      href={url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-primary hover:text-primary/80 underline underline-offset-2 transition-colors"
                    >
                      {children}
                    </a>
                  );
                },
              }}
            >
              {removeQuestions(cleanContent(message.content))}
            </ReactMarkdown>
            
            {/* Always show interactive questions if they exist */}
            {(() => {
              const questions = parseQuestionsFromResponse(cleanContent(message.content));
              if (questions.length > 0) {
                return (
                  <InteractiveQuestions
                    questions={questions}
                    onAnswer={(questionId, answer) => onAnswer(answer)}
                    disabled={isLoading || !isLastMessage}
                  />
                );
              }
              return null;
            })()}
            
            {/* Document Preview Dialog */}
            {previewDoc && (
              <DocumentPreviewDialog
                open={!!previewDoc}
                onOpenChange={(open) => !open && setPreviewDoc(null)}
                url={previewDoc.url}
                title={previewDoc.title}
              />
            )}
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {message.content}
          </p>
        )}

        {!isUser && !isError && (
          <div className="mt-4 pt-3 border-t border-border/30">
            {/* Context info */}
            {message.context && (message.context.hs_codes_found > 0 || message.context.tariffs_found > 0 || message.context.controlled_found > 0) && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {message.context.hs_codes_found > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-1 rounded-full font-medium">
                    <Database className="h-3 w-3" />
                    {message.context.hs_codes_found} codes SH
                  </span>
                )}
                {message.context.tariffs_found > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-1 rounded-full font-medium">
                    <Database className="h-3 w-3" />
                    {message.context.tariffs_found} tarifs
                  </span>
                )}
                {message.context.controlled_found > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs bg-warning/20 text-warning px-2 py-1 rounded-full font-medium">
                    <AlertTriangle className="h-3 w-3" />
                    {message.context.controlled_found} contrôles
                  </span>
                )}
                {message.context.pdfs_used > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs bg-accent/10 text-accent px-2 py-1 rounded-full font-medium">
                    <FileText className="h-3 w-3" />
                    {message.context.pdfs_used} PDFs
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center justify-between">
              {message.confidence && (
                <span className={cn(
                  "text-xs flex items-center gap-1.5 font-medium",
                  confidenceConfig[message.confidence].className
                )}>
                  <span className="text-sm">{confidenceConfig[message.confidence].icon}</span>
                  {confidenceConfig[message.confidence].label}
                </span>
              )}
              <div className="flex gap-0.5 ml-auto">
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-8 w-8 rounded-full transition-all",
                    message.feedback === "up" 
                      ? "text-success bg-success/15 hover:bg-success/20" 
                      : "hover:bg-muted/50"
                  )}
                  onClick={() => onFeedback(message.id, "up")}
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-8 w-8 rounded-full transition-all",
                    message.feedback === "down" 
                      ? "text-destructive bg-destructive/15 hover:bg-destructive/20" 
                      : "hover:bg-muted/50"
                  )}
                  onClick={() => onFeedback(message.id, "down")}
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {isUser && (
        <div className="flex-shrink-0 w-9 h-9 md:w-10 md:h-10 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-md">
          <User className="h-4 w-4 md:h-5 md:w-5 text-primary-foreground" />
        </div>
      )}
    </div>
  );
}

export function ChatTypingIndicator() {
  return (
    <div className="flex gap-3 md:gap-4 animate-fade-in">
      <div className="flex-shrink-0 w-9 h-9 md:w-10 md:h-10 rounded-xl bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center shadow-sm border border-accent/10">
        <Bot className="h-4 w-4 md:h-5 md:w-5 text-accent" />
      </div>
      <div className="bg-chat-ai text-chat-ai-foreground chat-message-ai rounded-2xl px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="typing-indicator flex gap-1.5">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <span className="text-sm text-muted-foreground">Analyse en cours...</span>
        </div>
      </div>
    </div>
  );
}
