import { useState, useCallback } from "react";
import { User, ThumbsUp, ThumbsDown, Database, FileText, AlertTriangle, ExternalLink, Eye, Image, Scale } from "lucide-react";
import { BotAvatar } from "./BotAvatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { DocumentPreviewDialog } from "./DocumentPreviewDialog";
import { CitedCirculars, type CircularReference } from "./CitedCirculars";
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
  citedCirculars?: CircularReference[];
  hasDbEvidence?: boolean;
  validationMessage?: string;
  isStreaming?: boolean;
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
  high: { color: "bg-success", label: "Confiance haute", className: "text-success" },
  medium: { color: "bg-warning", label: "Confiance moyenne", className: "text-warning" },
  low: { color: "bg-destructive", label: "Confiance faible", className: "text-destructive" },
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

// Filter cited sources to only keep those actually referenced in the response text
const filterCitedSources = (circulars: CircularReference[], content: string): CircularReference[] => {
  if (!circulars || circulars.length === 0) return [];
  
  const contentLower = content.toLowerCase();
  // Normalized version without dots/dashes/spaces for code matching
  const normalizedContent = contentLower.replace(/[.\-\s]/g, '');
  
  // Extract all HS code chapters mentioned in the content
  const mentionedChapters = new Set<string>();
  const hsCodePatterns = content.matchAll(/\b(\d{2})\d{2}[.\s]?\d{0,6}\b/g);
  for (const m of hsCodePatterns) {
    mentionedChapters.add(m[1]);
  }
  // Also from "Code SH : XXXX" patterns
  const codeSHPatterns = content.matchAll(/Code\s*SH\s*[:\s]*\*?\*?\s*(\d{2})/gi);
  for (const m of codeSHPatterns) {
    mentionedChapters.add(m[1]);
  }
  
  const matched = circulars.filter((c) => {
    // 1. Articles: check if "Art. X" or "Article X" appears in text
    if (c.reference_type === "Article" || c.reference_type === "Preuve") {
      const articleMatch = c.reference_number?.match(/Art\.?\s*(\d+(?:\s*(?:bis|ter|quater))?(?:\s*-\s*\d+)?)/i)
        || c.title?.match(/Art(?:icle)?\.?\s*(\d+(?:\s*(?:bis|ter|quater))?(?:\s*-\s*\d+)?)/i);
      if (articleMatch) {
        const artNum = articleMatch[1].trim();
        const artPattern = new RegExp(`(?:Art\\.?\\s*|Article\\s+|l[''\u2019]article\\s+|المادة\\s+)${artNum}\\b`, 'i');
        if (artPattern.test(content)) return true;
      }
    }
    
    // 2. Tariff lines / HS codes: check if the code digits appear
    if (c.reference_type === "Ligne tarifaire" || c.reference_type === "Tarif") {
      const code = (c.reference_number || '').replace(/[.\-\s]/g, '');
      if (code.length >= 4) {
        if (normalizedContent.includes(code)) return true;
        if (code.length >= 6 && normalizedContent.includes(code.substring(0, 6))) return true;
        if (code.length >= 6) {
          const formatted = code.substring(0, 4) + '.' + code.substring(4, 6);
          if (contentLower.includes(formatted)) return true;
        }
      }
    }
    
    // 3. Circulaires: check if the circulaire number or document name is mentioned
    if (c.reference_type === "Circulaire") {
      const circNum = c.reference_number?.match(/(\d[\d\/\-]+\d)/);
      if (circNum) {
        const numPattern = new RegExp(`circulaire\\s+(?:n[°o]?\\.?\\s*)?${circNum[1].replace(/[\/\-]/g, '[/\\-]')}`, 'i');
        if (numPattern.test(content)) return true;
      }
      if (c.reference_number?.toLowerCase().includes('codedesdouanes') || 
          c.pdf_title?.toLowerCase().includes('code des douanes') ||
          c.reference_number?.toLowerCase().includes('codedesDouanesimpotsindirects')) {
        if (contentLower.includes('code des douanes') || contentLower.includes('cdii')) return true;
      }
    }
    
    // 4. SH Code chapter PDFs: match against mentioned HS code chapters
    const pdfTitle = (c.pdf_title || c.title || c.reference_number || '').toUpperCase();
    const shCodeChapterMatch = pdfTitle.match(/SH[_\s]?CODE[_\s]?(\d{2})/i);
    if (shCodeChapterMatch && mentionedChapters.has(shCodeChapterMatch[1])) {
      return true;
    }
    // Also match "Chapitre XX" or "Chapter XX" in title
    const chapterMatch = pdfTitle.match(/CHAPITRE?\s*(\d{1,2})/i);
    if (chapterMatch) {
      const chapNum = chapterMatch[1].padStart(2, '0');
      if (mentionedChapters.has(chapNum)) return true;
    }
    
    // 5. Generic: check if reference_number digits/text appear in content
    if (c.reference_number) {
      const ref = c.reference_number.replace(/[.\-\s]/g, '').toLowerCase();
      if (ref.length >= 6 && normalizedContent.includes(ref)) return true;
    }
    
    return false;
  });
  
  // If articles are matched, also include the parent document (Circulaire) they come from
  if (matched.length > 0) {
    const matchedPdfTitles = new Set(
      matched.filter(m => m.pdf_title).map(m => m.pdf_title!.toLowerCase())
    );
    
    for (const c of circulars) {
      if (matched.includes(c)) continue;
      if (c.reference_type === "Circulaire" && c.pdf_title && matchedPdfTitles.has(c.pdf_title.toLowerCase())) {
        matched.push(c);
      }
    }
  }
  
  return matched;
};

// Remove any generated links from AI response - sources are handled automatically by CitedCirculars
const cleanSourceLinks = (content: string): string => {
  // Remove entire "Sources:" or "📎 Sources:" sections generated by AI
  // These are hallucinated links - real sources come from CitedCirculars
  let cleaned = content.replace(
    /(?:\n|^)(?:📎\s*)?(?:\*\*)?Sources?(?:\*\*)?:?\s*(?:\n[-•*]\s*\[.+?\]\(.+?\))+/gi,
    ''
  );
  
  // Also remove bullet lists of links under Sources header
  cleaned = cleaned.replace(
    /(?:\n|^)(?:📎\s*)?(?:\*\*)?Sources?\s*(?:utilisées?)?(?:\*\*)?:?\s*\n(?:[-•*]\s*.+\n?)+/gi,
    ''
  );
  
  // Remove [Consulter la source](URL) patterns generated by AI
  cleaned = cleaned.replace(
    /\[Consulter(?:\s+la\s+source)?\]\([^)]+\)/gi,
    ''
  );
  
  // Remove [Consulter](URL) patterns
  cleaned = cleaned.replace(
    /\[Consulter\]\([^)]+\)/gi,
    ''
  );
  
  // Remove any source://lookup links
  cleaned = cleaned.replace(
    /\[([^\]]+)\]\(source:\/\/[^)]+\)/gi,
    '$1'
  );
  
  // Clean up empty lines created by removal
  cleaned = cleaned.replace(/\n\n\n+/g, '\n\n');
  
  return cleaned;
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
  const [previewDoc, setPreviewDoc] = useState<{ url: string; title: string; pageNumber?: number } | null>(null);
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
      
      // If chapter from URL, ensure it's properly formatted
      if (chapter) {
        chapter = chapter.replace(/^0+/, '') || chapter; // Remove leading zeros for consistency
      }
      
      if (!chapter) {
        // Match "Chapitre SH 83" or "Chapitre 83" or "Chapitre SH 07"
        const chapterMatch = sourceTitle.match(/Chapitre\s*(?:SH\s*)?0?(\d{1,2})/i);
        if (chapterMatch) {
          chapter = chapterMatch[1];
        }
      }
      
      if (!chapter) {
        // Try to extract from title like "SH CODE 83" or "SH 83" or "SH_CODE_07"
        const codeMatch = sourceTitle.match(/SH[_\s]*(?:CODE[_\s]*)?0?(\d{1,2})/i);
        if (codeMatch) {
          chapter = codeMatch[1];
        }
      }

      if (!chapter) {
        // Last resort: any 1-2 digit number in the title
        const numMatch = sourceTitle.match(/\b0?(\d{1,2})\b/);
        if (numMatch) {
          chapter = numMatch[1];
        }
      }

      // Always use padded format for file lookup (SH_CODE_07.pdf format)
      const paddedChapter = chapter?.padStart(2, '0');
      
      console.log("Searching for document, raw chapter:", chapterFromUrl, "normalized:", chapter, "padded:", paddedChapter, "title:", sourceTitle);

      if (!paddedChapter) {
        console.log("No chapter found in title:", sourceTitle);
        setPreviewDoc({
          url: '',
          title: `Document non trouvé: impossible d'identifier le chapitre`
        });
        return;
      }

      // Search using EXACT match for file_name pattern: SH_CODE_XX.pdf
      const exactFileName = `SH_CODE_${paddedChapter}.pdf`;
      console.log("Searching for exact file_name:", exactFileName);
      
      const { data: docs, error } = await supabase
        .from("pdf_documents")
        .select("id, file_name, file_path, title")
        .eq("is_active", true)
        .eq("category", "tarif")
        .eq("file_name", exactFileName)
        .limit(1);

      console.log("Document search results (exact):", docs, error);

      // If exact match fails, try ilike with padding
      let foundDocs = docs;
      if ((!docs || docs.length === 0) && !error) {
        console.log("Exact match failed, trying ilike pattern");
        const { data: ilikeResults } = await supabase
          .from("pdf_documents")
          .select("id, file_name, file_path, title")
          .eq("is_active", true)
          .eq("category", "tarif")
          .or(`file_name.ilike.%SH_CODE_${paddedChapter}.%,title.ilike.%Chapitre SH ${paddedChapter}%`)
          .limit(1);
        
        console.log("ilike search results:", ilikeResults);
        foundDocs = ilikeResults;
      }

      if (error) {
        console.error("Error searching document:", error);
        setPreviewDoc({
          url: '',
          title: `Erreur lors de la recherche du document`
        });
        return;
      }

      if (foundDocs && foundDocs.length > 0) {
        const doc = foundDocs[0];
        // Get public URL from storage
        const { data: urlData } = supabase.storage
          .from("pdf-documents")
          .getPublicUrl(doc.file_path);

        // Build display title based on chapter number, not file name
        const displayTitle = paddedChapter 
          ? `Chapitre ${paddedChapter}` 
          : (doc.title || sourceTitle);
        
        console.log("Document found:", displayTitle, "file:", doc.file_name, "URL:", urlData?.publicUrl);

        if (urlData?.publicUrl) {
          setPreviewDoc({
            url: urlData.publicUrl,
            title: displayTitle
          });
        } else {
          setPreviewDoc({
            url: '',
            title: `Document non trouvé: Chapitre ${paddedChapter}`
          });
        }
      } else {
        // Document not found - show a fallback message
        console.log("Document not found for chapter:", chapter, "padded:", paddedChapter, "title:", sourceTitle);
        setPreviewDoc({
          url: '',
          title: `Document non trouvé: Chapitre ${paddedChapter}`
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
  const handleLinkClick = useCallback((url: string, linkText: string, pageNumber?: number) => {
    if (url.startsWith('source://')) {
      // Extract parameters from URL
      const params = new URLSearchParams(url.split('?')[1] || '');
      const directUrl = params.get('url');
      const title = params.get('title') || linkText;
      const chapter = params.get('chapter') || undefined;
      const page = params.get('page') ? parseInt(params.get('page')!) : pageNumber;
      
      // If we have a direct URL, use it
      if (directUrl) {
        setPreviewDoc({ 
          url: decodeURIComponent(directUrl), 
          title: decodeURIComponent(title),
          pageNumber: page
        });
      } else {
        // Otherwise search by title/chapter
        searchAndOpenDocument(decodeURIComponent(title), chapter);
      }
    } else if (isDocumentUrl(url)) {
      setPreviewDoc({ url, title: extractDocTitle(url, linkText), pageNumber });
    }
  }, [searchAndOpenDocument]);

  // Process content - remove any AI-generated source links (sources are displayed via CitedCirculars)
  const processedContent = cleanSourceLinks(
    fixMarkdownLinks(removeQuestions(cleanContent(message.content)))
  );

  return (
    <div
      className={cn(
        "flex gap-2.5 md:gap-3 animate-slide-up px-1 md:px-0",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {/* Bot avatar */}
      {!isUser && (
        <BotAvatar size="sm" className="hidden md:flex" />
      )}

      <div
        className={cn(
          "max-w-[92%] md:max-w-[75%] rounded-2xl px-3.5 py-3 md:px-5 md:py-4 transition-all",
          isUser
            ? "bg-primary/10 text-foreground"
            : "bg-card border border-border/40 text-foreground shadow-sm"
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
                strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                code: ({ children }) => <code className="bg-muted/50 px-1.5 py-0.5 rounded text-xs font-mono text-primary">{children}</code>,
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
                      <span 
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleLinkClick(url, linkText);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleLinkClick(url, linkText);
                          }
                        }}
                        className={cn(
                          "inline-flex items-center gap-1.5 text-primary hover:text-primary/80 underline underline-offset-2 transition-colors font-medium cursor-pointer",
                          isSearchingDoc && "opacity-50 cursor-wait pointer-events-none"
                        )}
                      >
                        <span>{children || "Consulter"}</span>
                        <ExternalLink className="h-3 w-3 flex-shrink-0" />
                      </span>
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
            
            {/* Streaming cursor */}
            {message.isStreaming && (
              <span className="inline-block w-1.5 h-4 bg-primary/70 animate-pulse rounded-sm ml-0.5 align-text-bottom" />
            )}
            
            {/* Display validated sources - only after streaming is complete */}
            {!message.isStreaming && (message.citedCirculars || message.validationMessage) && (
              <CitedCirculars
                circulars={filterCitedSources(message.citedCirculars || [], message.content)}
                onDocumentClick={handleLinkClick}
                isSearchingDoc={isSearchingDoc}
                hasDbEvidence={message.hasDbEvidence}
                validationMessage={message.validationMessage}
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
              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-primary/15">
                {message.attachedFiles.map((file, index) => (
                  <button
                    key={index}
                    onClick={() => setPreviewAttachment(file)}
                    className={cn(
                      "relative group flex items-center gap-2 bg-primary/5 border border-primary/15 rounded-lg p-2 pr-3",
                      "hover:bg-primary/10 transition-all duration-200 cursor-pointer"
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
                      <div className="relative w-10 h-10 flex items-center justify-center bg-muted rounded">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded">
                          <Eye className="h-3 w-3 text-white" />
                        </div>
                      </div>
                    )}
                    <div className="flex flex-col items-start min-w-0">
                      <span className="text-xs font-medium text-foreground max-w-[80px] truncate">
                        {file.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
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
            {message.context && (message.context.hs_codes_found > 0 || message.context.tariffs_found > 0 || message.context.controlled_found > 0 || (message.citedCirculars && filterCitedSources(message.citedCirculars, message.content).length > 0)) && (
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
                  <span className="inline-flex items-center gap-1 text-xs bg-muted text-muted-foreground px-2 py-1 rounded-full font-medium">
                    <FileText className="h-3 w-3" />
                    {message.context.pdfs_used} PDFs
                  </span>
                )}
                {message.citedCirculars && (() => {
                  const filtered = filterCitedSources(message.citedCirculars, message.content);
                  return filtered.length > 0 ? (
                    <span className="inline-flex items-center gap-1 text-xs bg-success/15 text-success px-2 py-1 rounded-full font-medium">
                      <Scale className="h-3 w-3" />
                      {filtered.length} source{filtered.length > 1 ? 's' : ''}
                    </span>
                  ) : null;
                })()}
              </div>
            )}

            <div className="flex items-center justify-between">
              {message.confidence && (
                <span className={cn(
                  "text-xs flex items-center gap-1.5 font-medium",
                  confidenceConfig[message.confidence].className
                )}>
                  <span className={cn("inline-block w-2.5 h-2.5 rounded-full", confidenceConfig[message.confidence].color)} />
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

      {/* User avatar */}
      {isUser && (
        <div className="flex-shrink-0 w-7 h-7 md:w-8 md:h-8 flex items-center justify-center hidden md:flex">
          <User className="h-5 w-5 md:h-5 md:w-5 text-primary" />
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

      {/* Document Preview Dialog */}
      {previewDoc && (
        <DocumentPreviewDialog
          open={!!previewDoc}
          onOpenChange={(open) => !open && setPreviewDoc(null)}
          url={previewDoc.url}
          title={previewDoc.title}
          pageNumber={previewDoc.pageNumber}
        />
      )}
    </div>
  );
}

export function ChatTypingIndicator() {
  return (
    <div className="flex gap-2.5 md:gap-3 animate-fade-in px-1 md:px-0">
      <BotAvatar size="sm" className="hidden md:flex" />
      <div className="bg-card border border-border/40 text-foreground rounded-2xl px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="typing-indicator flex gap-1">
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