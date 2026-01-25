export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          alert_type: string
          country_code: string | null
          created_at: string
          id: string
          is_read: boolean | null
          message: string | null
          read_at: string | null
          related_document_id: string | null
          related_hs_codes: Json | null
          severity: string | null
          title: string
        }
        Insert: {
          alert_type: string
          country_code?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          message?: string | null
          read_at?: string | null
          related_document_id?: string | null
          related_hs_codes?: Json | null
          severity?: string | null
          title: string
        }
        Update: {
          alert_type?: string
          country_code?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          message?: string | null
          read_at?: string | null
          related_document_id?: string | null
          related_hs_codes?: Json | null
          severity?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "alerts_related_document_id_fkey"
            columns: ["related_document_id"]
            isOneToOne: false
            referencedRelation: "pdf_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      classification_opinions: {
        Row: {
          assigned_hs_code: string | null
          country_code: string
          created_at: string
          id: string
          is_active: boolean | null
          issued_date: string | null
          justification: string | null
          product_description: string
          reference_number: string | null
          updated_at: string
        }
        Insert: {
          assigned_hs_code?: string | null
          country_code: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          issued_date?: string | null
          justification?: string | null
          product_description: string
          reference_number?: string | null
          updated_at?: string
        }
        Update: {
          assigned_hs_code?: string | null
          country_code?: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          issued_date?: string | null
          justification?: string | null
          product_description?: string
          reference_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classification_opinions_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      controlled_products: {
        Row: {
          control_authority: string | null
          control_type: string
          country_code: string
          created_at: string
          hs_code: string
          id: string
          is_active: boolean | null
          notes: string | null
          required_documents: Json | null
          required_norm: string | null
          updated_at: string
        }
        Insert: {
          control_authority?: string | null
          control_type: string
          country_code: string
          created_at?: string
          hs_code: string
          id?: string
          is_active?: boolean | null
          notes?: string | null
          required_documents?: Json | null
          required_norm?: string | null
          updated_at?: string
        }
        Update: {
          control_authority?: string | null
          control_type?: string
          country_code?: string
          created_at?: string
          hs_code?: string
          id?: string
          is_active?: boolean | null
          notes?: string | null
          required_documents?: Json | null
          required_norm?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "controlled_products_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      conversations: {
        Row: {
          confidence_level: string | null
          context_used: Json | null
          created_at: string
          detected_hs_codes: Json | null
          detected_intent: string | null
          feedback_text: string | null
          id: string
          pdfs_used: Json | null
          question: string
          rating: number | null
          response: string | null
          response_time_ms: number | null
          session_id: string | null
          sources_cited: Json | null
        }
        Insert: {
          confidence_level?: string | null
          context_used?: Json | null
          created_at?: string
          detected_hs_codes?: Json | null
          detected_intent?: string | null
          feedback_text?: string | null
          id?: string
          pdfs_used?: Json | null
          question: string
          rating?: number | null
          response?: string | null
          response_time_ms?: number | null
          session_id?: string | null
          sources_cited?: Json | null
        }
        Update: {
          confidence_level?: string | null
          context_used?: Json | null
          created_at?: string
          detected_hs_codes?: Json | null
          detected_intent?: string | null
          feedback_text?: string | null
          id?: string
          pdfs_used?: Json | null
          question?: string
          rating?: number | null
          response?: string | null
          response_time_ms?: number | null
          session_id?: string | null
          sources_cited?: Json | null
        }
        Relationships: []
      }
      countries: {
        Row: {
          code: string
          code_alpha3: string | null
          created_at: string
          currency_code: string | null
          id: string
          is_active: boolean | null
          name_en: string | null
          name_fr: string
          updated_at: string
        }
        Insert: {
          code: string
          code_alpha3?: string | null
          created_at?: string
          currency_code?: string | null
          id?: string
          is_active?: boolean | null
          name_en?: string | null
          name_fr: string
          updated_at?: string
        }
        Update: {
          code?: string
          code_alpha3?: string | null
          created_at?: string
          currency_code?: string | null
          id?: string
          is_active?: boolean | null
          name_en?: string | null
          name_fr?: string
          updated_at?: string
        }
        Relationships: []
      }
      country_tariffs: {
        Row: {
          country_code: string
          created_at: string
          description_local: string | null
          duty_rate: number | null
          effective_date: string | null
          expiry_date: string | null
          hs_code_6: string
          id: string
          is_active: boolean | null
          is_prohibited: boolean | null
          is_restricted: boolean | null
          national_code: string
          other_taxes: Json | null
          updated_at: string
          vat_rate: number | null
        }
        Insert: {
          country_code: string
          created_at?: string
          description_local?: string | null
          duty_rate?: number | null
          effective_date?: string | null
          expiry_date?: string | null
          hs_code_6: string
          id?: string
          is_active?: boolean | null
          is_prohibited?: boolean | null
          is_restricted?: boolean | null
          national_code: string
          other_taxes?: Json | null
          updated_at?: string
          vat_rate?: number | null
        }
        Update: {
          country_code?: string
          created_at?: string
          description_local?: string | null
          duty_rate?: number | null
          effective_date?: string | null
          expiry_date?: string | null
          hs_code_6?: string
          id?: string
          is_active?: boolean | null
          is_prohibited?: boolean | null
          is_restricted?: boolean | null
          national_code?: string
          other_taxes?: Json | null
          updated_at?: string
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "country_tariffs_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      hs_codes: {
        Row: {
          chapter_number: number | null
          code: string
          code_clean: string
          created_at: string
          description_en: string | null
          description_fr: string
          explanatory_notes: string | null
          id: string
          is_active: boolean | null
          legal_notes: string | null
          level: string | null
          parent_code: string | null
          section_number: number | null
          updated_at: string
        }
        Insert: {
          chapter_number?: number | null
          code: string
          code_clean: string
          created_at?: string
          description_en?: string | null
          description_fr: string
          explanatory_notes?: string | null
          id?: string
          is_active?: boolean | null
          legal_notes?: string | null
          level?: string | null
          parent_code?: string | null
          section_number?: number | null
          updated_at?: string
        }
        Update: {
          chapter_number?: number | null
          code?: string
          code_clean?: string
          created_at?: string
          description_en?: string | null
          description_fr?: string
          explanatory_notes?: string | null
          id?: string
          is_active?: boolean | null
          legal_notes?: string | null
          level?: string | null
          parent_code?: string | null
          section_number?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      knowledge_documents: {
        Row: {
          category: string | null
          content: string
          country_code: string | null
          created_at: string
          id: string
          is_active: boolean | null
          source_url: string | null
          tags: Json | null
          title: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          content: string
          country_code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          source_url?: string | null
          tags?: Json | null
          title: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          content?: string
          country_code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          source_url?: string | null
          tags?: Json | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_documents_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      origin_rules: {
        Row: {
          agreement_code: string
          agreement_name: string | null
          created_at: string
          hs_code: string
          id: string
          is_active: boolean | null
          minimum_value_added: number | null
          proof_required: string | null
          rule_text: string | null
          rule_type: string | null
          source_url: string | null
          updated_at: string
        }
        Insert: {
          agreement_code: string
          agreement_name?: string | null
          created_at?: string
          hs_code: string
          id?: string
          is_active?: boolean | null
          minimum_value_added?: number | null
          proof_required?: string | null
          rule_text?: string | null
          rule_type?: string | null
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          agreement_code?: string
          agreement_name?: string | null
          created_at?: string
          hs_code?: string
          id?: string
          is_active?: boolean | null
          minimum_value_added?: number | null
          proof_required?: string | null
          rule_text?: string | null
          rule_type?: string | null
          source_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "origin_rules_agreement_code_fkey"
            columns: ["agreement_code"]
            isOneToOne: false
            referencedRelation: "trade_agreements"
            referencedColumns: ["code"]
          },
        ]
      }
      pdf_documents: {
        Row: {
          category: string
          country_code: string | null
          created_at: string
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          is_active: boolean | null
          is_verified: boolean | null
          keywords: string | null
          publication_date: string | null
          reference: string | null
          related_hs_codes: Json | null
          tags: Json | null
          title: string
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          category: string
          country_code?: string | null
          created_at?: string
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          is_active?: boolean | null
          is_verified?: boolean | null
          keywords?: string | null
          publication_date?: string | null
          reference?: string | null
          related_hs_codes?: Json | null
          tags?: Json | null
          title: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          category?: string
          country_code?: string | null
          created_at?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          is_active?: boolean | null
          is_verified?: boolean | null
          keywords?: string | null
          publication_date?: string | null
          reference?: string | null
          related_hs_codes?: Json | null
          tags?: Json | null
          title?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pdf_documents_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      pdf_extractions: {
        Row: {
          created_at: string
          detected_tariff_changes: Json | null
          extracted_text: string | null
          extraction_date: string | null
          extraction_model: string | null
          id: string
          key_points: Json | null
          mentioned_hs_codes: Json | null
          pdf_id: string
          summary: string | null
        }
        Insert: {
          created_at?: string
          detected_tariff_changes?: Json | null
          extracted_text?: string | null
          extraction_date?: string | null
          extraction_model?: string | null
          id?: string
          key_points?: Json | null
          mentioned_hs_codes?: Json | null
          pdf_id: string
          summary?: string | null
        }
        Update: {
          created_at?: string
          detected_tariff_changes?: Json | null
          extracted_text?: string | null
          extraction_date?: string | null
          extraction_model?: string | null
          id?: string
          key_points?: Json | null
          mentioned_hs_codes?: Json | null
          pdf_id?: string
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pdf_extractions_pdf_id_fkey"
            columns: ["pdf_id"]
            isOneToOne: false
            referencedRelation: "pdf_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      statistics: {
        Row: {
          created_at: string
          id: string
          metadata: Json | null
          stat_date: string
          stat_type: string
          stat_value: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json | null
          stat_date?: string
          stat_type: string
          stat_value?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json | null
          stat_date?: string
          stat_type?: string
          stat_value?: number | null
        }
        Relationships: []
      }
      trade_agreements: {
        Row: {
          code: string
          created_at: string
          effective_date: string | null
          id: string
          is_active: boolean | null
          name_en: string | null
          name_fr: string
          notes: string | null
          parties: Json
          proof_required: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          effective_date?: string | null
          id?: string
          is_active?: boolean | null
          name_en?: string | null
          name_fr: string
          notes?: string | null
          parties?: Json
          proof_required?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          effective_date?: string | null
          id?: string
          is_active?: boolean | null
          name_en?: string | null
          name_fr?: string
          notes?: string | null
          parties?: Json
          proof_required?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      veille_config: {
        Row: {
          created_at: string
          frequency_hours: number | null
          id: string
          is_enabled: boolean | null
          last_run_at: string | null
          mode: string | null
          notification_email: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          frequency_hours?: number | null
          id?: string
          is_enabled?: boolean | null
          last_run_at?: string | null
          mode?: string | null
          notification_email?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          frequency_hours?: number | null
          id?: string
          is_enabled?: boolean | null
          last_run_at?: string | null
          mode?: string | null
          notification_email?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      veille_documents: {
        Row: {
          category: string | null
          collected_at: string | null
          collected_by: string | null
          content: string | null
          country_code: string | null
          created_at: string
          detected_tariff_changes: Json | null
          id: string
          importance: string | null
          is_verified: boolean | null
          mentioned_hs_codes: Json | null
          search_keyword: string | null
          source_name: string | null
          source_url: string | null
          title: string
          verified_at: string | null
        }
        Insert: {
          category?: string | null
          collected_at?: string | null
          collected_by?: string | null
          content?: string | null
          country_code?: string | null
          created_at?: string
          detected_tariff_changes?: Json | null
          id?: string
          importance?: string | null
          is_verified?: boolean | null
          mentioned_hs_codes?: Json | null
          search_keyword?: string | null
          source_name?: string | null
          source_url?: string | null
          title: string
          verified_at?: string | null
        }
        Update: {
          category?: string | null
          collected_at?: string | null
          collected_by?: string | null
          content?: string | null
          country_code?: string | null
          created_at?: string
          detected_tariff_changes?: Json | null
          id?: string
          importance?: string | null
          is_verified?: boolean | null
          mentioned_hs_codes?: Json | null
          search_keyword?: string | null
          source_name?: string | null
          source_url?: string | null
          title?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "veille_documents_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      veille_keywords: {
        Row: {
          category: string | null
          country_code: string | null
          created_at: string
          id: string
          is_active: boolean | null
          keyword: string
          last_searched_at: string | null
          priority: number | null
          total_results: number | null
          total_searches: number | null
        }
        Insert: {
          category?: string | null
          country_code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          keyword: string
          last_searched_at?: string | null
          priority?: number | null
          total_results?: number | null
          total_searches?: number | null
        }
        Update: {
          category?: string | null
          country_code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          keyword?: string
          last_searched_at?: string | null
          priority?: number | null
          total_results?: number | null
          total_searches?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "veille_keywords_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
      veille_logs: {
        Row: {
          created_at: string
          cycle_ended_at: string | null
          cycle_started_at: string
          documents_found: number | null
          documents_new: number | null
          errors: Json | null
          id: string
          keywords_searched: number | null
          sites_scraped: number | null
          status: string | null
        }
        Insert: {
          created_at?: string
          cycle_ended_at?: string | null
          cycle_started_at: string
          documents_found?: number | null
          documents_new?: number | null
          errors?: Json | null
          id?: string
          keywords_searched?: number | null
          sites_scraped?: number | null
          status?: string | null
        }
        Update: {
          created_at?: string
          cycle_ended_at?: string | null
          cycle_started_at?: string
          documents_found?: number | null
          documents_new?: number | null
          errors?: Json | null
          id?: string
          keywords_searched?: number | null
          sites_scraped?: number | null
          status?: string | null
        }
        Relationships: []
      }
      veille_sites: {
        Row: {
          country_code: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          last_scraped_at: string | null
          name: string
          url: string
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_scraped_at?: string | null
          name: string
          url: string
        }
        Update: {
          country_code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_scraped_at?: string | null
          name?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "veille_sites_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "countries"
            referencedColumns: ["code"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
