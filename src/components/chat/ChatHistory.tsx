import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { History, MessageSquare, Plus, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { format, isToday, isYesterday, isThisWeek, isThisMonth } from "date-fns";
import { fr } from "date-fns/locale";

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

  // Fetch conversation sessions
  useEffect(() => {
    const fetchSessions = async () => {
      setIsLoading(true);
      try {
        // Get unique sessions with their first question and message count
        const { data, error } = await supabase
          .from("conversations")
          .select("session_id, question, created_at, id")
          .order("created_at", { ascending: false })
          .limit(200);

        if (error) throw error;

        // Group by session_id and extract first question
        const sessionMap = new Map<string, ConversationSession>();
        
        data?.forEach((conv) => {
          if (!conv.session_id) return;
          
          const existing = sessionMap.get(conv.session_id);
          if (existing) {
            existing.message_count++;
            // Keep the earliest question as "first_question"
            if (new Date(conv.created_at) < new Date(existing.last_activity)) {
              existing.first_question = conv.question;
            }
            // Update last_activity to most recent
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

        // Sort by last activity
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

    if (isOpen) {
      fetchSessions();
    }
  }, [isOpen]);

  // Load conversation messages for a session
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

      // Convert to message format
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

  const groupedSessions = groupByTimePeriod(sessions);

  // Truncate text for display
  const truncate = (text: string, maxLength: number = 40) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  return (
    <>
      {/* Toggle button when closed */}
      {!isOpen && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className="fixed left-4 top-20 z-40 h-10 w-10 rounded-full bg-background/80 backdrop-blur-sm border shadow-md hover:bg-accent"
          title="Ouvrir l'historique"
        >
          <History className="h-5 w-5" />
        </Button>
      )}

      {/* Sidebar */}
      <div
        className={cn(
          "fixed left-0 top-16 h-[calc(100vh-4rem)] bg-background border-r z-30 transition-all duration-300 ease-in-out flex flex-col",
          isOpen ? "w-72" : "w-0 overflow-hidden"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b flex-shrink-0">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
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

        {/* Sessions list */}
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
                        <button
                          key={session.session_id}
                          onClick={() => handleSelectSession(session)}
                          disabled={loadingSessionId === session.session_id}
                          className={cn(
                            "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
                            "hover:bg-accent/50",
                            session.session_id === currentSessionId
                              ? "bg-accent text-accent-foreground"
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
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </>
  );
}
