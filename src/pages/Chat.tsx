import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { getAuthHeaders } from "@/lib/authHeaders";
import { useToast } from "@/hooks/use-toast";
import { ChatMessage, ChatTypingIndicator } from "@/components/chat/ChatMessage";
import { ChatWelcome } from "@/components/chat/ChatWelcome";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatHistory } from "@/components/chat/ChatHistory";
import { ClassificationView } from "@/components/chat/ClassificationView";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { useAppHeaderContext } from "@/components/layout/AppLayout";
import { useChatSidebarStore } from "@/stores/chatSidebarStore";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
// Custom flex-based dual-pane (replaces react-resizable-panels for predictable sizing)
import { PanelRightOpen, Quote } from "lucide-react";
import type { UploadedFile } from "@/components/chat/ImageUploadButton";

type ChatMode = "chat" | "classification";

interface AttachedFile {
  name: string;
  type: "image" | "document";
  preview: string;
  size: number;
}

interface CircularReference {
  id: string;
  reference_type: string;
  reference_number: string;
  title?: string;
  reference_date?: string;
  download_url?: string;
  pdf_title?: string;
  validated?: boolean;
  page_number?: number;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  confidence?: "high" | "medium" | "low";
  feedback?: "up" | "down";
  conversationId?: string;
  attachedFiles?: AttachedFile[];
  citedCirculars?: CircularReference[];
  hasDbEvidence?: boolean;
  validationMessage?: string;
  isStreaming?: boolean;
  context?: {
    hs_codes_found: number;
    tariffs_found: number;
    controlled_found: number;
    documents_found: number;
    pdfs_used: number;
    legal_references_found?: number;
    sources_validated?: number;
  };
}

// Stream chat response via SSE with JSON fallback for cache hits
const CHAT_STREAM_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

async function streamChatResponse(params: {
  question: string;
  sessionId: string;
  images?: { type: "image"; base64: string; mediaType: string }[];
  pdfDocuments?: { type: "pdf"; base64: string; fileName: string }[];
  conversationHistory?: { role: string; content: string }[];
  onChunk: (text: string) => void;
  onDone: (metadata: any) => void;
  onError: (error: string) => void;
}) {
  // Get authenticated headers (JWT token)
  let headers: Record<string, string>;
  try {
    headers = await getAuthHeaders(true);
    headers['Accept'] = 'text/event-stream';
  } catch (e: any) {
    params.onError(e.message || "Session expirée. Veuillez vous reconnecter.");
    return;
  }

  let response: Response;
  const MAX_RETRIES = 2;
  const FETCH_TIMEOUT_MS = 120_000; // 2 minutes timeout
  let lastError = '';
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    
    try {
      response = await fetch(CHAT_STREAM_URL, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          question: params.question,
          sessionId: params.sessionId,
          images: params.images,
          pdfDocuments: params.pdfDocuments,
          conversationHistory: params.conversationHistory,
        }),
      });
      clearTimeout(timeoutId);
      
      if (response!.ok || response!.status < 500 || attempt === MAX_RETRIES) {
        break;
      }
      
      // Retry on 5xx errors
      const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(`[Chat] Retry ${attempt + 1}/${MAX_RETRIES} after ${response!.status}`);
      await new Promise(r => setTimeout(r, delay));
    } catch (networkErr: any) {
      clearTimeout(timeoutId);
      const isAbort = networkErr?.name === 'AbortError' || networkErr?.message?.includes('abort');
      lastError = isAbort 
        ? 'La réponse a pris trop de temps. Veuillez réessayer.' 
        : (networkErr?.message || 'Erreur réseau');
      if (attempt === MAX_RETRIES) {
        params.onError(isAbort
          ? "La réponse a pris trop de temps. Veuillez réessayer avec une question plus courte."
          : "Connexion impossible. Vérifiez votre connexion internet et réessayez.");
        return;
      }
      const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500;
      console.warn(`[Chat] ${isAbort ? 'Timeout' : 'Network error'}, retry ${attempt + 1}/${MAX_RETRIES}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  if (!response!) {
    params.onError(lastError || "Erreur de connexion");
    return;
  }

  if (!response!.ok) {
    let errorMsg = `Erreur ${response!.status}`;
    try {
      const errorData = await response!.json();
      errorMsg = errorData.error || errorMsg;
    } catch { /* ignore */ }
    
    if (response!.status === 429) errorMsg = "Trop de requêtes. Veuillez patienter quelques instants.";
    if (response!.status === 402) errorMsg = "Limite d'utilisation atteinte.";
    
    params.onError(errorMsg);
    return;
  }

  const contentType = response!.headers.get('Content-Type') || '';

  // JSON response (cache hit or non-streaming fallback)
  if (contentType.includes('application/json')) {
    const data = await response!.json();
    if (data.response) {
      params.onChunk(data.response);
      params.onDone({
        confidence: data.confidence,
        cited_circulars: data.cited_circulars || [],
        has_db_evidence: data.has_db_evidence ?? true,
        validation_message: data.validation_message,
        context: data.context,
        conversationId: data.conversationId,
      });
    } else {
      params.onError('Réponse invalide du serveur');
    }
    return;
  }

  // SSE stream
  const reader = response!.body?.getReader();
  if (!reader) {
    params.onError('Streaming non supporté');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content' && parsed.content) {
            params.onChunk(parsed.content);
          } else if (parsed.type === 'done') {
            params.onDone(parsed.metadata);
          } else if (parsed.type === 'error') {
            params.onError(parsed.error || 'Erreur inconnue');
          }
        } catch {
          // Ignore parse errors (partial JSON)
        }
      }
    }
  } catch {
    params.onError('Connexion interrompue');
  }
}

// Remove confidence indicators, emojis, and decorative icons from AI response content
const cleanConfidenceFromContent = (content: string): string => {
  let cleaned = content
    // Remove confidence indicators
    .replace(/^[🟢🟡🔴]\s*\*?\*?Confiance[^]*?\n/gim, '')
    .replace(/[🟢🟡🔴]\s*\*?\*?Confiance\s*(haute|moyenne|faible|élevée)[^]*?(?=\n\n|\n##|\n\*\*|$)/gim, '')
    .replace(/^\*?\*?Niveau de confiance\s*:\s*(élevé|moyen|faible)[^\n]*\n?/gim, '')
    .replace(/^\*?\*?Confiance\s*:\s*(haute|moyenne|faible|élevée)[^\n]*\n?/gim, '')
    .replace(/^[❓❔ℹ️🔍]\s*$/gm, '')
    .replace(/\n[❓❔]\s*\n/g, '\n')
    // Remove ALL emojis from the response
    .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2300}-\u{23FF}]|[\u{2B50}]|[\u{203C}\u{2049}]|[\u{20E3}]|[\u{FE00}-\u{FE0F}]|[\u{1F900}-\u{1F9FF}]|[✅✓✔️❌❎⚠️ℹ️📁📂📄📥📜🔗💡🎯🚨]/gu, '')
    // Remove invented markdown links [text](url)
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    // Remove HTML links
    .replace(/<a[^>]*href="[^"]*"[^>]*>([^<]*)<\/a>/gi, '$1')
    // Remove raw Supabase storage URLs leaked by AI
    .replace(/https?:\/\/mefyrysrlmzzcsyyysqp\.supabase\.co[^\s)"']*/g, '')
    // Remove "📎 Sources:" sections generated by AI (handled by CitedCirculars component)
    .replace(/📎\s*\*?\*?Sources?\*?\*?\s*:?[\s\S]*?(?=\n\n[^-\[]|\n##|$)/gi, '')
    // Remove raw JSON blocks that shouldn't be displayed
    .replace(/```json[\s\S]*?```/g, '')
    .replace(/"[a-z_]+"\s*:\s*(?:"[^"]*"|[0-9.]+|null|true|false)\s*,?/gi, '')
    // Clean up extra whitespace
    .replace(/\n{3,}/g, '\n\n');
  
  return cleaned.trim();
};

// Remove interactive question options from content (they're shown as buttons)
const removeInteractiveQuestions = (content: string): string => {
  const lines = content.split('\n');
  const resultLines: string[] = [];
  
  let skipUntilNextSection = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const originalLine = lines[i];
    
    const isQuestionLine = /^\*\*([^*]+)\*\*\s*[-–]?\s*.*$/.test(line);
    
    if (isQuestionLine) {
      let hasOptions = false;
      for (let j = i + 1; j < lines.length && j < i + 10; j++) {
        const nextLine = lines[j].trim();
        if (nextLine.startsWith('- ') || nextLine.startsWith('• ')) {
          hasOptions = true;
        } else if (nextLine === '') {
          continue;
        } else if (hasOptions) {
          break;
        }
      }
      
      if (hasOptions) {
        skipUntilNextSection = true;
        continue;
      }
    }
    
    if (skipUntilNextSection && (line.startsWith('- ') || line.startsWith('• '))) {
      continue;
    }
    
    if (skipUntilNextSection && line === '') {
      let nextContentLine = '';
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() !== '') {
          nextContentLine = lines[j].trim();
          break;
        }
      }
      if (!nextContentLine.startsWith('- ') && !nextContentLine.startsWith('• ')) {
        skipUntilNextSection = false;
      }
    }
    
    if (!skipUntilNextSection) {
      resultLines.push(originalLine);
    }
  }
  
  return resultLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

// Convert file to base64
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export default function Chat() {
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  const { setHistoryControls } = useAppHeaderContext();
  
  const [chatMode, setChatMode] = useState<ChatMode>("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState(initialQuery);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [sessionId, setSessionId] = useState(() => {
    const stored = sessionStorage.getItem('chat_session_id');
    if (stored) return stored;
    const newId = crypto.randomUUID();
    sessionStorage.setItem('chat_session_id', newId);
    return newId;
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const {
    isOpen: isSidebarOpen,
    setOpen: setSidebarOpen,
    sizePct: sidebarSizePct,
    setSizePct: setSidebarSizePct,
    citations: sidebarCitations,
    savedResponses: sidebarSaved,
  } = useChatSidebarStore();
  const sidebarBadgeCount = sidebarCitations.length + sidebarSaved.length;

  // Streaming buffer: accumulate chunks in a ref and flush to state periodically
  const streamBufferRef = useRef<string>("");
  const streamFlushTimerRef = useRef<number | null>(null);
  const streamMessageIdRef = useRef<string | null>(null);

  // Handle loading a previous session
  const handleSelectSession = useCallback((newSessionId: string, loadedMessages: Array<{ role: "user" | "assistant"; content: string; conversationId?: string }>) => {
    // Update session ID
    setSessionId(newSessionId);
    sessionStorage.setItem('chat_session_id', newSessionId);
    
    // Convert to Message format
    const formattedMessages: Message[] = loadedMessages.map((msg, index) => ({
      id: `${Date.now()}-${index}`,
      role: msg.role,
      content: msg.content,
      conversationId: msg.conversationId,
    }));
    
    setMessages(formattedMessages);
    setIsHistoryOpen(false);
  }, []);

  // Start a new conversation
  const handleNewChat = useCallback(() => {
    const newId = crypto.randomUUID();
    setSessionId(newId);
    sessionStorage.setItem('chat_session_id', newId);
    setMessages([]);
    setInput("");
    setIsHistoryOpen(false);
  }, []);

  // Sync history controls with header
  const toggleHistory = useCallback(() => setIsHistoryOpen(prev => !prev), []);
  useEffect(() => {
    setHistoryControls(toggleHistory, isHistoryOpen);
  }, [setHistoryControls, toggleHistory, isHistoryOpen]);

  const hasProcessedInitialQuery = useRef(false);
  useEffect(() => {
    if (initialQuery && messages.length === 0 && !hasProcessedInitialQuery.current) {
      hasProcessedInitialQuery.current = true;
      handleSend(initialQuery);
      setInput("");
    }
  }, [initialQuery]);

  useEffect(() => {
    const scrollToBottom = () => {
      if (scrollRef.current) {
        const scrollContainer = scrollRef.current.querySelector('[data-radix-scroll-area-viewport]');
        if (scrollContainer) {
          scrollContainer.scrollTo({
            top: scrollContainer.scrollHeight,
            behavior: 'smooth'
          });
        }
      }
    };
    
    const timeoutId = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(timeoutId);
  }, [messages, isLoading]);

  const handleSend = async (text?: string) => {
    const messageText = text || input.trim();
    if ((!messageText && uploadedFiles.length === 0) || isLoading) return;

    const imagesToSend: { type: "image"; base64: string; mediaType: string }[] = [];
    const pdfsToSend: { type: "pdf"; base64: string; fileName: string }[] = [];
    const documentNames: string[] = [];
    
    if (uploadedFiles.length > 0) {
      setIsUploading(true);
      for (const upload of uploadedFiles) {
        try {
          // Images go to vision API
          if (upload.type === "image" && upload.file.type.startsWith("image/")) {
            const base64 = await fileToBase64(upload.file);
            const mediaType = upload.file.type || "image/jpeg";
            imagesToSend.push({ type: "image", base64, mediaType });
          } 
          // PDFs go to Claude's native PDF support
          else if (upload.file.type === "application/pdf") {
            const base64 = await fileToBase64(upload.file);
            pdfsToSend.push({ type: "pdf", base64, fileName: upload.file.name });
          }
          // Other documents just get mentioned by name
          else {
            documentNames.push(upload.file.name);
          }
        } catch (err) {
          console.error("Failed to convert file:", err);
        }
      }
      setIsUploading(false);
    }
    
    // Build context message for non-analyzed documents
    let enhancedMessage = messageText;
    if (documentNames.length > 0) {
      const docList = documentNames.join(", ");
      enhancedMessage = messageText 
        ? `${messageText} (Documents mentionnés: ${docList})`
        : `J'ai des questions concernant ces documents: ${docList}`;
    }

    // Build display message (never append PDF count - files are shown as attachments)
    let displayContent = enhancedMessage;
    if (!displayContent && pdfsToSend.length > 0) {
      displayContent = `Analyse de ${pdfsToSend.length} document(s) PDF`;
    }

    // Build attached files for history display
    const attachedFilesForHistory: AttachedFile[] = uploadedFiles.map((upload) => ({
      name: upload.file.name,
      type: upload.type,
      preview: upload.preview,
      size: upload.file.size,
    }));

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: displayContent || (uploadedFiles.length > 0 ? `📎 ${uploadedFiles.length} fichier(s) uploadé(s)` : ""),
      attachedFiles: attachedFilesForHistory.length > 0 ? attachedFilesForHistory : undefined,
    };

    const assistantMessageId = (Date.now() + 1).toString();
    
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setUploadedFiles([]);
    setIsLoading(true);

    try {
      const conversationHistory = messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      // Initialize streaming buffer
      streamBufferRef.current = "";
      streamMessageIdRef.current = assistantMessageId;

      // Flush buffer to state - called at intervals for smooth rendering
      const flushBuffer = () => {
        const bufferedContent = streamBufferRef.current;
        const msgId = streamMessageIdRef.current;
        if (!msgId) return;

        setMessages(prev => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg?.id === msgId) {
            // Only update if content actually changed
            if (lastMsg.content === bufferedContent) return prev;
            return prev.map(msg =>
              msg.id === msgId
                ? { ...msg, content: bufferedContent }
                : msg
            );
          }
          // First flush: create the assistant message
          if (bufferedContent) {
            return [...prev, {
              id: msgId,
              role: "assistant" as const,
              content: bufferedContent,
              isStreaming: true,
            }];
          }
          return prev;
        });
      };

      // Start periodic flushing (every 50ms for smooth word-by-word feel)
      const startFlushing = () => {
        if (streamFlushTimerRef.current) return;
        streamFlushTimerRef.current = window.setInterval(flushBuffer, 50);
      };

      const stopFlushing = () => {
        if (streamFlushTimerRef.current) {
          clearInterval(streamFlushTimerRef.current);
          streamFlushTimerRef.current = null;
        }
        // Final flush to ensure all content is rendered
        flushBuffer();
      };
      
      await streamChatResponse({
        question: enhancedMessage || "Analyse ce document et donne-moi les informations pertinentes",
        sessionId,
        images: imagesToSend.length > 0 ? imagesToSend : undefined,
        pdfDocuments: pdfsToSend.length > 0 ? pdfsToSend : undefined,
        conversationHistory,
        onChunk: (chunk) => {
          // Just accumulate in the buffer - no state update per token
          streamBufferRef.current += chunk;
          startFlushing();
        },
        onDone: (metadata) => {
          stopFlushing();
          streamMessageIdRef.current = null;

          setMessages(prev => prev.map(msg =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: streamBufferRef.current, // Use final buffer content
                  isStreaming: false,
                  confidence: metadata?.confidence as "high" | "medium" | "low",
                  conversationId: metadata?.conversationId,
                  context: metadata?.context ? {
                    ...metadata.context,
                    sources_validated: metadata.context.sources_validated || 0,
                  } : undefined,
                  citedCirculars: metadata?.cited_circulars || [],
                  hasDbEvidence: metadata?.has_db_evidence ?? true,
                  validationMessage: metadata?.validation_message,
                }
              : msg
          ));
          setIsLoading(false);
        },
        onError: (error) => {
          stopFlushing();
          streamMessageIdRef.current = null;

          setMessages(prev => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg?.id === assistantMessageId) {
              return prev.map(msg =>
                msg.id === assistantMessageId
                  ? { ...msg, content: `⚠️ ${error}`, isStreaming: false }
                  : msg
              );
            }
            return [...prev, {
              id: assistantMessageId,
              role: "assistant" as const,
              content: `⚠️ ${error}`,
              confidence: "low" as const,
            }];
          });
          setIsLoading(false);
          toast({
            title: "Erreur",
            description: error,
            variant: "destructive",
          });
        },
      });
    } catch (error: any) {
      console.error("Chat error:", error);
      // Clean up flush timer on error
      if (streamFlushTimerRef.current) {
        clearInterval(streamFlushTimerRef.current);
        streamFlushTimerRef.current = null;
      }
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFeedback = async (messageId: string, type: "up" | "down") => {
    const message = messages.find(m => m.id === messageId);
    if (!message?.conversationId) return;

    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId ? { ...msg, feedback: type } : msg
      )
    );

    try {
      await supabase
        .from('conversations')
        .update({ rating: type === "up" ? 5 : 1 })
        .eq('id', message.conversationId);
    } catch (error) {
      console.error("Feedback error:", error);
    }
  };

  const handleFilesSelected = (files: UploadedFile[]) => {
    setUploadedFiles((prev) => [...prev, ...files]);
  };

  const handleRemoveFile = (index: number) => {
    const fileToRemove = uploadedFiles[index];
    if (fileToRemove?.type === "image" && fileToRemove.preview.startsWith("blob:")) {
      URL.revokeObjectURL(fileToRemove.preview);
    }
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  useEffect(() => {
    return () => {
      // Clean up blob URLs
      uploadedFiles.forEach((file) => {
        if (file.type === "image" && file.preview.startsWith("blob:")) {
          URL.revokeObjectURL(file.preview);
        }
      });
      // Clean up streaming flush timer
      if (streamFlushTimerRef.current) {
        clearInterval(streamFlushTimerRef.current);
        streamFlushTimerRef.current = null;
      }
    };
  }, [uploadedFiles]);

  const chatPaneContent = (
    <div className="flex flex-col h-full min-w-0 min-h-0 relative">
      {chatMode === "classification" ? (
        <ClassificationView />
      ) : (
        <>
          {/* Floating button to open sidebar (desktop only, when closed) */}
          {!isSidebarOpen && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(true)}
              className="hidden md:flex absolute right-4 top-3 z-30 h-10 w-10 rounded-full bg-card/80 backdrop-blur-sm border border-border/50 shadow-card hover:bg-primary/5 hover:text-primary"
              title="Ouvrir le volet contextuel"
            >
              <PanelRightOpen className="h-5 w-5" />
              {sidebarBadgeCount > 0 && (
                <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
                  {sidebarBadgeCount > 99 ? "99+" : sidebarBadgeCount}
                </span>
              )}
            </Button>
          )}

          {/* Chat messages area */}
          {messages.length === 0 ? (
            <div className="flex-1 min-h-0 flex items-center justify-center px-2 md:px-4 overflow-hidden pb-20 md:pb-0">
              <div className="max-w-3xl mx-auto w-full max-h-full overflow-hidden">
                <ChatWelcome onQuestionClick={handleSend} />
              </div>
            </div>
          ) : (
            <ScrollArea ref={scrollRef} className="flex-1 px-2 md:px-4 py-3 md:py-6 pb-20 md:pb-6">
              <div className="max-w-3xl mx-auto space-y-3 md:space-y-6">
                {messages.map((message, index) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    isLastMessage={index === messages.length - 1 && message.role === "assistant"}
                    isLoading={isLoading}
                    onFeedback={handleFeedback}
                    onAnswer={handleSend}
                    cleanContent={cleanConfidenceFromContent}
                    removeQuestions={removeInteractiveQuestions}
                  />
                ))}

                {isLoading && !messages.some(m => m.isStreaming && m.content.length > 0) && <ChatTypingIndicator />}
              </div>
            </ScrollArea>
          )}
        </>
      )}

      {/* Input area */}
      <ChatInput
        input={input}
        onInputChange={setInput}
        onSend={() => handleSend()}
        onKeyDown={handleKeyDown}
        isLoading={isLoading}
        isUploading={isUploading}
        uploadedFiles={uploadedFiles}
        onFilesSelected={handleFilesSelected}
        onRemoveFile={handleRemoveFile}
        chatMode={chatMode}
        onModeChange={setChatMode}
      />
    </div>
  );

  // Mobile sidebar size matches full width via overlay; on desktop we use resizable panels.
  const sidebarSize = Math.min(50, Math.max(20, sidebarSizePct));

  return (
    <div className="flex h-full flex-col bg-background overflow-hidden overscroll-none">
      {/* History sidebar */}
      <ChatHistory
        currentSessionId={sessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        isOpen={isHistoryOpen}
        onToggle={() => setIsHistoryOpen(!isHistoryOpen)}
      />

      {/* Main area: dual-pane on desktop, single column + sheet-like overlay on mobile */}
      <div
        className={cn(
          "flex flex-1 min-w-0 min-h-0 transition-[margin] duration-300",
          isHistoryOpen ? "md:ml-72" : "ml-0"
        )}
      >
        {/* Desktop: dual-pane with manual resize handle */}
        <DesktopDualPane
          isOpen={isSidebarOpen && chatMode !== "classification"}
          sizePct={sidebarSize}
          onSizeChange={setSidebarSizePct}
          chatPane={chatPaneContent}
          sidebar={<ChatSidebar onClose={() => setSidebarOpen(false)} />}
        />

        {/* Mobile: full-width chat + sidebar as overlay */}
        <div className="flex md:hidden flex-1 min-w-0 min-h-0 relative">
          <div className="flex-1 min-w-0 min-h-0">{chatPaneContent}</div>
          {isSidebarOpen && chatMode !== "classification" && (
            <>
              <div
                className="fixed inset-0 bg-black/40 z-30"
                onClick={() => setSidebarOpen(false)}
              />
              <div className="fixed right-0 top-14 bottom-0 w-[88vw] max-w-[360px] z-40 shadow-2xl">
                <ChatSidebar onClose={() => setSidebarOpen(false)} />
              </div>
            </>
          )}
          {/* Mobile floating trigger */}
          {!isSidebarOpen && chatMode !== "classification" && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(true)}
              className="fixed right-3 bottom-24 z-30 h-11 w-11 rounded-full bg-card/95 backdrop-blur border border-border/60 shadow-card text-primary"
              title="Volet contextuel"
            >
              <Quote className="h-5 w-5" />
              {sidebarBadgeCount > 0 && (
                <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
                  {sidebarBadgeCount > 99 ? "99+" : sidebarBadgeCount}
                </span>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
