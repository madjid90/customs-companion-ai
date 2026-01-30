import { useState, useCallback } from "react";
import { Bot, User, ThumbsUp, ThumbsDown, Database, FileText, AlertTriangle, ExternalLink, Eye, Image } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { InteractiveQuestions, parseQuestionsFromResponse } from "./InteractiveQuestions";
import { DocumentPreviewDialog } from "./DocumentPreviewDialog";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface MessageContext {
  hs_codes_found: number;
  tariffs_found: number;
  controlled_found: number;
  documents_found: number;
  pdfs_used: number;
}

export interface AttachedFile {
  name: string;
  type: "image" | "document";
  preview: string; // base64 or blob URL
  size: number;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  confidence?: "high" | "medium" | "low";
  feedback?: "up" | "down";
  conversationId?: string;
  context?: MessageContext;
  attachedFiles?: AttachedFile[];
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

// Check if a URL is a document (PDF, etc.)
const isDocumentUrl = (url: string) => {
  return url.includes('.pdf') || 
         url.includes('/storage/') || 
         url.includes('pdf-documents') ||
         url.includes('supabase.co/storage') ||
         url.startsWith('source://');
};

// Extract title from URL or link text
const extractDocTitle = (url: string, linkText?: string) => {
  if (linkText && linkText.length > 3) {
    return linkText.replace(/[\[\]📥📄📁]/g, '').trim();
  }
  try {
    const urlParts = url.split('/');
    const filename = urlParts[urlParts.length - 1];
    return decodeURIComponent(filename.replace(/_/g, ' ').replace(/\d{13}_/, ''));
  } catch {
    return "Document";
  }
};

// Check if a string is a valid URL
const isValidUrl = (str: string): boolean => {
  if (!str) return false;
  // Must start with http, https, or be a relative path starting with /
  return str.startsWith('http://') || 
         str.startsWith('https://') || 
         str.startsWith('/') ||
         str.startsWith('source://');
};

// Fix broken markdown links (URLs with spaces) and remove invalid links
const fixMarkdownLinks = (content: string): string => {
  return content.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (match, text, url) => {
      // If the URL is not valid (e.g., just text), remove the link syntax
      if (!isValidUrl(url.trim())) {
        // Remove fake download/source links entirely
        if (text.includes('📥') || text.includes('Télécharger') || text.includes('Accès')) {
          return ''; 
        }
        return text; // Keep the text but remove the broken link syntax
      }
      // Fix spaces in valid URLs
      const fixedUrl = url.replace(/ /g, '%20');
      return `[${text}](${fixedUrl})`;
    }
  );
};

// Extract HS code chapter from message content
const extractChapterFromContent = (content: string): string | null => {
  // Look for HS codes like 8301.30, 8301300000, etc.
  const hsCodeMatch = content.match(/\b(\d{2})\d{2}[.\s]?\d{0,6}\b/);
  if (hsCodeMatch) {
    return hsCodeMatch[1]; // Return first 2 digits (chapter)
  }
  // Also try to find "Code SH : XXXX" or "**Code SH :** XXXX" patterns
  const codeSHMatch = content.match(/Code\s*SH\s*[:\s]*\*?\*?\s*(\d{2})/i);
  if (codeSHMatch) {
    return codeSHMatch[1];
  }
  return null;
};

// Transform source patterns into clickable links with chapter info
// IMPORTANT: Keep real HTTP URLs as-is, only transform text-based source references
const transformSourcePatterns = (content: string): string => {
  // Extract chapter from the content for use in links
  const chapter = extractChapterFromContent(content);
  
  // Pattern 1: Clean up "Source: Chapitre SH XX - [Consulter](URL)" format
  // Replace with simple "Consulter la source" link
  let transformed = content.replace(
    /\*?\*?Source\s*:?\*?\*?\s*([^[\n]+?)\s*-?\s*\[Consulter\]\(([^)]+)\)/gi,
    (match, sourceTitle, url) => {
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        return `[Consulter la source](${url})`;
      }
      return match;
    }
  );
  
  // Pattern 2: Handle standalone [Consulter](URL) links - keep as-is if valid HTTP
  transformed = transformed.replace(
    /\[Consulter\]\(([^)]+)\)/gi,
    (match, url) => {
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        return match;
      }
      return '';
    }
  );
  
  // Pattern 3: "Source:" followed by text (not a link) - convert to "Consulter la source" link
  transformed = transformed.replace(
    /\*?\*?Source\s*:?\*?\*?\s*([^\n\[]+?)(?=\n|$)/gi,
    (match, title) => {
      // Skip if already processed or contains a link
      if (match.includes('](') || match.includes('[')) return match;
      const cleanTitle = title.trim().replace(/\*+/g, '').replace(/-\s*$/, '').trim();
      // Skip generic/invalid titles
      if (!cleanTitle || cleanTitle.length < 5 || cleanTitle.includes('intégré') || cleanTitle.includes('officiel')) return match;
      // Include chapter in URL if found
      const chapterParam = chapter ? `&chapter=${chapter}` : '';
      return `[Consulter la source](source://lookup?title=${encodeURIComponent(cleanTitle)}${chapterParam})`;
    }
  );
  
  return transformed;
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
  const [isSearchingDoc, setIsSearchingDoc] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<AttachedFile | null>(null);
  
  const isUser = message.role === "user";
  const isError = message.content.startsWith("⚠️");

  // Search for PDF document by chapter number
  const searchAndOpenDocument = useCallback(async (sourceTitle: string, chapterFromUrl?: string) => {
    setIsSearchingDoc(true);
    
    try {
      // Priority 1: Use chapter from URL parameter
      // Priority 2: Extract from source title "Chapitre XX" or "Chapitre SH XX"
      // Priority 3: Extract from title containing chapter number
      let chapter = chapterFromUrl;
      
      if (!chapter) {
        // Match "Chapitre SH 83" or "Chapitre 83"
        const chapterMatch = sourceTitle.match(/Chapitre\s*(?:SH\s*)?(\d{1,2})/i);
        if (chapterMatch) {
          chapter = chapterMatch[1].padStart(2, '0');
        }
      }
      
      if (!chapter) {
        // Try to extract from title like "SH CODE 83" or "SH 83"
        const codeMatch = sourceTitle.match(/SH\s*(?:CODE\s*)?(\d{1,2})/i);
        if (codeMatch) {
          chapter = codeMatch[1].padStart(2, '0');
        }
      }

      if (!chapter) {
        // Last resort: any 2-digit number in the title
        const numMatch = sourceTitle.match(/\b(\d{2})\b/);
        if (numMatch) {
          chapter = numMatch[1];
        }
      }

      console.log("Searching for document, chapter:", chapter, "title:", sourceTitle);

      if (!chapter) {
        console.log("No chapter found in title:", sourceTitle);
        setPreviewDoc({
          url: '',
          title: `Document non trouvé: impossible d'identifier le chapitre`
        });
        return;
      }

      const paddedChapter = chapter.padStart(2, '0');
      
      // Search specifically for SH_CODE_XX format in file_name
      const { data: docs, error } = await supabase
        .from("pdf_documents")
        .select("id, file_name, file_path, title")
        .eq("is_active", true)
        .eq("category", "tarif")
        .ilike("file_name", `%SH_CODE_${paddedChapter}%`)
        .limit(1);

      console.log("Document search results:", docs, error);

      if (error) {
        console.error("Error searching document:", error);
        setPreviewDoc({
          url: '',
          title: `Erreur lors de la recherche du document`
        });
        return;
      }

      if (docs && docs.length > 0) {
        const doc = docs[0];
        // Get public URL from storage
        const { data: urlData } = supabase.storage
          .from("pdf-documents")
          .getPublicUrl(doc.file_path);

        console.log("Document found:", doc.title, "URL:", urlData?.publicUrl);

        if (urlData?.publicUrl) {
          setPreviewDoc({
            url: urlData.publicUrl,
            title: doc.title || doc.file_name || sourceTitle
          });
        } else {
          setPreviewDoc({
            url: '',
            title: `Document non trouvé: Chapitre ${paddedChapter}`
          });
        }
      } else {
        // Document not found - show a fallback message
        console.log("Document not found for chapter:", chapter, "title:", sourceTitle);
        setPreviewDoc({
          url: '',
          title: `Document non trouvé: Chapitre SH ${paddedChapter}`
        });
      }
    } catch (err) {
      console.error("Error in searchAndOpenDocument:", err);
      setPreviewDoc({
        url: '',
        title: `Erreur lors de la recherche du document`
      });
    } finally {
      setIsSearchingDoc(false);
    }
  }, []);

  // Handle link clicks including source:// protocol
  const handleLinkClick = useCallback((url: string, linkText: string) => {
    if (url.startsWith('source://')) {
      // Extract parameters from URL
      const params = new URLSearchParams(url.split('?')[1] || '');
      const directUrl = params.get('url');
      const title = params.get('title') || linkText;
      const chapter = params.get('chapter') || undefined;
      
      // If we have a direct URL, use it
      if (directUrl) {
        setPreviewDoc({ url: decodeURIComponent(directUrl), title: decodeURIComponent(title) });
      } else {
        // Otherwise search by title/chapter
        searchAndOpenDocument(decodeURIComponent(title), chapter);
      }
    } else if (isDocumentUrl(url)) {
      setPreviewDoc({ url, title: extractDocTitle(url, linkText) });
    }
  }, [searchAndOpenDocument]);

  // Process content to add source links
  const processedContent = transformSourcePatterns(
    fixMarkdownLinks(removeQuestions(cleanContent(message.content)))
  );

  return (
    <div
      className={cn(
        "flex gap-2 md:gap-4 animate-slide-up",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {/* Bot avatar - hidden on mobile for more space */}
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 md:w-10 md:h-10 rounded-xl bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center shadow-sm border border-accent/10 hidden sm:flex">
          <Bot className="h-4 w-4 md:h-5 md:w-5 text-accent" />
        </div>
      )}

      <div
        className={cn(
          "max-w-[92%] sm:max-w-[85%] md:max-w-[80%] rounded-2xl px-3 py-2.5 md:px-5 md:py-4 transition-all",
          isUser
            ? "bg-chat-user text-chat-user-foreground chat-message-user shadow-md"
            : "bg-chat-ai text-chat-ai-foreground chat-message-ai"
        )}
      >
        {!isUser && !isError ? (
          <div 
            className="prose prose-sm dark:prose-invert max-w-none"
            onClick={(e) => {
              // Event delegation for source links - capture clicks on <a> elements
              const target = e.target as HTMLElement;
              const link = target.closest('a[data-source-url], a[href^="source://"]');
              if (link) {
                e.preventDefault();
                e.stopPropagation();
                const url = link.getAttribute('data-source-url') || link.getAttribute('href') || '';
                const linkText = link.textContent || 'Document';
                handleLinkClick(url, linkText);
              }
            }}
          >
            <ReactMarkdown
              rehypePlugins={[[rehypeSanitize, {
                ...defaultSchema,
                tagNames: [
                  ...(defaultSchema.tagNames || []),
                  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'span'
                ],
                attributes: {
                  ...defaultSchema.attributes,
                  '*': ['className', 'style'],
                  'a': ['href', 'target', 'rel', 'data-source-url', 'data-source-title', 'data-source-link'],
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
                  const linkText = typeof children === 'string' ? children : 
                    (Array.isArray(children) ? children.map(c => typeof c === 'string' ? c : '').join('') : '');
                  
                  // Handle source:// links (our custom protocol for source references)
                  if (url.startsWith('source://') || isDocumentUrl(url)) {
                    return (
                      <a 
                        href="#"
                        data-source-url={url}
                        data-source-title={linkText}
                        data-source-link="true"
                        className={cn(
                          "inline-flex items-center gap-1.5 text-primary hover:text-primary/80 underline underline-offset-2 transition-colors font-medium cursor-pointer",
                          isSearchingDoc && "opacity-50 cursor-wait pointer-events-none"
                        )}
                      >
                        <span>{children || "Consulter"}</span>
                        <ExternalLink className="h-3 w-3 flex-shrink-0" />
                      </a>
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
              {processedContent}
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
          <div>
            {/* User message text */}
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {message.content}
            </p>
            
            {/* Attached files in user message */}
            {isUser && message.attachedFiles && message.attachedFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-white/20">
                {message.attachedFiles.map((file, index) => (
                  <button
                    key={index}
                    onClick={() => setPreviewAttachment(file)}
                    className={cn(
                      "relative group flex items-center gap-2 bg-white/10 rounded-lg p-2 pr-3",
                      "hover:bg-white/20 transition-all duration-200 cursor-pointer"
                    )}
                  >
                    {file.type === "image" ? (
                      <div className="relative w-10 h-10 rounded overflow-hidden">
                        <img
                          src={file.preview}
                          alt={file.name}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Eye className="h-3 w-3 text-white" />
                        </div>
                      </div>
                    ) : (
                      <div className="relative w-10 h-10 flex items-center justify-center bg-white/10 rounded">
                        <FileText className="h-5 w-5 text-white/80" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded">
                          <Eye className="h-3 w-3 text-white" />
                        </div>
                      </div>
                    )}
                    <div className="flex flex-col items-start min-w-0">
                      <span className="text-xs font-medium text-white/90 max-w-[80px] truncate">
                        {file.name}
                      </span>
                      <span className="text-[10px] text-white/60">
                        {(file.size / 1024).toFixed(0)} Ko
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
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

      {/* User avatar - smaller on mobile */}
      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 md:w-10 md:h-10 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-md">
          <User className="h-3.5 w-3.5 md:h-5 md:w-5 text-primary-foreground" />
        </div>
      )}

      {/* Attachment Preview Dialog for history files */}
      {previewAttachment && (
        <Dialog open={!!previewAttachment} onOpenChange={(open) => !open && setPreviewAttachment(null)}>
          <DialogContent className="max-w-[95vw] md:max-w-4xl max-h-[85vh] md:max-h-[90vh] p-0 overflow-hidden">
            <DialogHeader className="p-3 md:p-4 pb-2 border-b bg-card/80 backdrop-blur-sm">
              <DialogTitle className="flex items-center gap-2 text-sm md:text-base font-medium truncate pr-4">
                {previewAttachment.type === "image" ? (
                  <Image className="h-4 w-4 md:h-5 md:w-5 text-primary flex-shrink-0" />
                ) : (
                  <FileText className="h-4 w-4 md:h-5 md:w-5 text-primary flex-shrink-0" />
                )}
                <span className="truncate">{previewAttachment.name}</span>
                <span className="text-xs text-muted-foreground font-normal hidden sm:inline">
                  ({(previewAttachment.size / 1024).toFixed(1)} Ko)
                </span>
              </DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-auto p-2 md:p-4 bg-muted/20 min-h-[300px] md:min-h-[400px] max-h-[calc(85vh-80px)] md:max-h-[calc(90vh-80px)]">
              {previewAttachment.type === "image" ? (
                <div className="flex items-center justify-center h-full">
                  <img
                    src={previewAttachment.preview}
                    alt={previewAttachment.name}
                    className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
                  <div className="w-24 h-24 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <FileText className="h-12 w-12 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-lg">{previewAttachment.name}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {(previewAttachment.size / 1024).toFixed(1)} Ko
                    </p>
                  </div>
                  {previewAttachment.preview && previewAttachment.preview.startsWith("data:application/pdf") && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        const link = document.createElement('a');
                        link.href = previewAttachment.preview;
                        link.download = previewAttachment.name;
                        link.click();
                      }}
                    >
                      Télécharger
                    </Button>
                  )}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
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