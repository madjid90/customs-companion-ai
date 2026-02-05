-- ===========================================
-- MIGRATION: Fix Conversation RLS Policy
-- Corrige une faille de sécurité permettant à n'importe qui
-- de modifier les conversations de moins de 24h
-- ===========================================

-- Supprimer l'ancienne politique trop permissive si elle existe
DROP POLICY IF EXISTS "Users can update their own conversations" ON public.conversations;

-- Créer une politique stricte basée uniquement sur le session_id
CREATE POLICY "Users can update their own conversations" ON public.conversations
  FOR UPDATE USING (
    session_id = current_setting('request.headers', true)::json->>'x-session-id'
  );

-- Ajouter un commentaire explicatif
COMMENT ON POLICY "Users can update their own conversations" ON public.conversations 
  IS 'Les utilisateurs ne peuvent modifier que leurs propres conversations identifiées par session_id';