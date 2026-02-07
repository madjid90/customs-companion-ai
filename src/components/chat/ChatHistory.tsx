import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { History, MessageSquare, Plus, ChevronLeft, Trash2 } from "lucide-react";
import { isToday, isYesterday, isThisWeek, isThisMonth } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";

interface ConversationSession {
  session_id: string;
  first_question: string;
  last_activity: string;
  message_count: number;
}

interface ChatHistoryProps {
  currentSessionId: string;
  onSelectSession: (sessionId: string, messages: Array<{ role: "user" | "assistant"; content: string; conversationId?: string }>) => void;
  onNewChat: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

// Group conversations by time period
const groupByTimePeriod = (sessions: ConversationSession[]) => {
  const groups: { [key: string]: ConversationSession[] } = {
    "Aujourd'hui": [],
    "Hier": [],
    "Cette semaine": [],
    "Ce mois": [],
    "Plus ancien": [],
  };

  sessions.forEach((session) => {
    const date = new Date(session.last_activity);
    if (isToday(date)) {
      groups["Aujourd'hui"].push(session);
    } else if (isYesterday(date)) {
      groups["Hier"].push(session);
    } else if (isThisWeek(date)) {
      groups["Cette semaine"].push(session);
    } else if (isThisMonth(date)) {
      groups["Ce mois"].push(session);
    } else {
      groups["Plus ancien"].push(session);
    }
  });

  return groups;
};

export function ChatHistory({
  currentSessionId,
  onSelectSession,
  onNewChat,
  isOpen,
  onToggle,
}: ChatHistoryProps) {
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Swipe gesture state
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Handle touch start
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    setIsSwiping(true);
  };

  // Handle touch move
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isSwiping) return;
    
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = touchStartX.current - currentX;
    const diffY = Math.abs(touchStartY.current - currentY);
    
    // Only handle horizontal swipes (ignore vertical scrolling)
    if (diffY > Math.abs(diffX)) {
      setIsSwiping(false);
      return;
    }
    
    // Only allow swiping left (to close)
    if (diffX > 0) {
      setSwipeOffset(Math.min(diffX, 320)); // Max offset is sidebar width
    }
  };

  // Handle touch end
  const handleTouchEnd = () => {
    if (!isSwiping) return;
    
    // If swiped more than 30% of sidebar width, close it
    if (swipeOffset > 96) {
      onToggle();
    }
    
    setSwipeOffset(0);
    setIsSwiping(false);
  };

  // Reset swipe offset when sidebar closes
  useEffect(() => {
    if (!isOpen) {
      setSwipeOffset(0);
      setIsSwiping(false);
    }
  }, [isOpen]);

  // Fetch conversation sessions
  const fetchSessions = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("conversations")
        .select("session_id, question, created_at, id")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;

      const sessionMap = new Map<string, ConversationSession>();
      
      data?.forEach((conv) => {
        if (!conv.session_id) return;
        
        const existing = sessionMap.get(conv.session_id);
        if (existing) {
          existing.message_count++;
          if (new Date(conv.created_at) < new Date(existing.last_activity)) {
            existing.first_question = conv.question;
          }
          if (new Date(conv.created_at) > new Date(existing.last_activity)) {
            existing.last_activity = conv.created_at;
          }
        } else {
          sessionMap.set(conv.session_id, {
            session_id: conv.session_id,
            first_question: conv.question,
            last_activity: conv.created_at,
            message_count: 1,
          });
        }
      });

      const sortedSessions = Array.from(sessionMap.values()).sort(
        (a, b) => new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime()
      );

      setSessions(sortedSessions);
    } catch (err) {
      console.error("Error fetching sessions:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchSessions();
    }
  }, [isOpen]);

  const handleSelectSession = async (session: ConversationSession) => {
    if (session.session_id === currentSessionId) return;
    
    setLoadingSessionId(session.session_id);
    try {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, question, response, created_at")
        .eq("session_id", session.session_id)
        .order("created_at", { ascending: true });

      if (error) throw error;

      const messages: Array<{ role: "user" | "assistant"; content: string; conversationId?: string }> = [];
      
      data?.forEach((conv) => {
        messages.push({
          role: "user",
          content: conv.question,
        });
        if (conv.response) {
          messages.push({
            role: "assistant",
            content: conv.response,
            conversationId: conv.id,
          });
        }
      });

      onSelectSession(session.session_id, messages);
    } catch (err) {
      console.error("Error loading session:", err);
    } finally {
      setLoadingSessionId(null);
    }
  };

  const handleDeleteSession = async () => {
    if (!deleteSessionId) return;
    
    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from("conversations")
        .delete()
        .eq("session_id", deleteSessionId);

      if (error) throw error;

      setSessions((prev) => prev.filter((s) => s.session_id !== deleteSessionId));
      
      if (deleteSessionId === currentSessionId) {
        onNewChat();
      }

      toast({
        title: "Conversation supprimée",
        description: "La conversation a été supprimée avec succès.",
      });
    } catch (err) {
      console.error("Error deleting session:", err);
      toast({
        title: "Erreur",
        description: "Impossible de supprimer la conversation.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setDeleteSessionId(null);
    }
  };

  const groupedSessions = groupByTimePeriod(sessions);

  const truncate = (text: string, maxLength: number = 40) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  return (
    <>
      {/* Toggle button - only on desktop (mobile uses header) */}
      {!isOpen && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className="hidden md:flex fixed left-4 top-20 z-40 h-10 w-10 rounded-full bg-card/80 backdrop-blur-sm border border-border/50 shadow-card hover:bg-primary/5 hover:text-primary"
          title="Ouvrir l'historique"
        >
          <History className="h-5 w-5" />
        </Button>
      )}

      {/* Overlay for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={onToggle}
        />
      )}

      {/* Sidebar - full screen on mobile, fixed width on desktop */}
      <div
        ref={sidebarRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={cn(
          "fixed left-0 top-14 md:top-16 h-[calc(100vh-3.5rem)] md:h-[calc(100vh-4rem)] bg-card border-r border-border/30 z-30 flex flex-col",
          isOpen ? "w-[85vw] max-w-[320px] md:w-72" : "w-0 overflow-hidden",
          !isSwiping && "transition-all duration-300 ease-in-out"
        )}
        style={{
          transform: isOpen && swipeOffset > 0 ? `translateX(-${swipeOffset}px)` : undefined,
          opacity: isOpen && swipeOffset > 0 ? Math.max(0.3, 1 - swipeOffset / 320) : undefined,
        }}
      >
        <div className="flex items-center justify-between p-3 border-b border-border/30 flex-shrink-0">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary/70" />
            <h2 className="font-semibold text-sm">Historique</h2>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={onNewChat}
              className="h-8 w-8"
              title="Nouvelle conversation"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggle}
              className="h-8 w-8"
              title="Fermer"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Aucune conversation</p>
              </div>
            ) : (
              Object.entries(groupedSessions).map(([period, periodSessions]) => {
                if (periodSessions.length === 0) return null;
                return (
                  <div key={period}>
                    <h3 className="text-xs font-medium text-muted-foreground px-2 mb-1">
                      {period}
                    </h3>
                    <div className="space-y-1">
                      {periodSessions.map((session) => (
                        <div
                          key={session.session_id}
                          className={cn(
                            "group flex items-center gap-1 rounded-lg transition-colors",
                            "hover:bg-primary/5",
                            session.session_id === currentSessionId && "bg-primary/10"
                          )}
                        >
                          <button
                            onClick={() => handleSelectSession(session)}
                            disabled={loadingSessionId === session.session_id}
                            className={cn(
                              "flex-1 text-left px-3 py-2 text-sm",
                              session.session_id === currentSessionId
                                ? "text-accent-foreground"
                                : "text-foreground",
                              loadingSessionId === session.session_id && "opacity-50"
                            )}
                          >
                            <div className="flex items-start gap-2">
                              <MessageSquare className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                              <div className="flex-1 min-w-0">
                                <p className="truncate font-medium">
                                  {truncate(session.first_question)}
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {session.message_count} message{session.message_count > 1 ? "s" : ""}
                                </p>
                              </div>
                            </div>
                          </button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteSessionId(session.session_id);
                            }}
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10 mr-1"
                            title="Supprimer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>

      <AlertDialog open={!!deleteSessionId} onOpenChange={(open) => !open && setDeleteSessionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette conversation ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible. La conversation et tous ses messages seront définitivement supprimés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSession}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Suppression..." : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
