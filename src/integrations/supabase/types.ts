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
          action_required: string | null
          action_url: string | null
          actioned_at: string | null
          actioned_by: string | null
          alert_type: string
          country_code: string | null
          created_at: string
          id: string
          is_actioned: boolean | null
          is_read: boolean | null
          message: string | null
          read_at: string | null
          related_document_id: string | null
          related_hs_codes: Json | null
          severity: string | null
          source_id: string | null
          source_type: string | null
          title: string
        }
        Insert: {
          action_required?: string | null
          action_url?: string | null
          actioned_at?: string | null
          actioned_by?: string | null
          alert_type: string
          country_code?: string | null
          created_at?: string
          id?: string
          is_actioned?: boolean | null
          is_read?: boolean | null
          message?: string | null
          read_at?: string | null
          related_document_id?: string | null
          related_hs_codes?: Json | null
          severity?: string | null
          source_id?: string | null
          source_type?: string | null
          title: string
        }
        Update: {
          action_required?: string | null
          action_url?: string | null
          actioned_at?: string | null
          actioned_by?: string | null
          alert_type?: string
          country_code?: string | null
          created_at?: string
          id?: string
          is_actioned?: boolean | null
          is_read?: boolean | null
          message?: string | null
          read_at?: string | null
          related_document_id?: string | null
          related_hs_codes?: Json | null
          severity?: string | null
          source_id?: string | null
          source_type?: string | null
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
          adoption_date: string | null
          classification_reasoning: string | null
          country_code: string
          created_at: string
          effective_date: string | null
          hs_code: string | null
          hs_version: string | null
          id: string
          is_active: boolean | null
          issued_date: string | null
          justification: string | null
          language: string | null
          legal_basis: string | null
          product_characteristics: string | null
          product_description: string
          product_images: Json | null
          reference: string | null
          source: string | null
          source_url: string | null
          updated_at: string
        }
        Insert: {
          adoption_date?: string | null
          classification_reasoning?: string | null
          country_code: string
          created_at?: string
          effective_date?: string | null
          hs_code?: string | null
          hs_version?: string | null
          id?: string
          is_active?: boolean | null
          issued_date?: string | null
          justification?: string | null
          language?: string | null
          legal_basis?: string | null
          product_characteristics?: string | null
          product_description: string
          product_images?: Json | null
          reference?: string | null
          source?: string | null
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          adoption_date?: string | null
          classification_reasoning?: string | null
          country_code?: string
          created_at?: string
          effective_date?: string | null
          hs_code?: string | null
          hs_version?: string | null
          id?: string
          is_active?: boolean | null
          issued_date?: string | null
          justification?: string | null
          language?: string | null
          legal_basis?: string | null
          product_characteristics?: string | null
          product_description?: string
          product_images?: Json | null
          reference?: string | null
          source?: string | null
          source_url?: string | null
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
          authority_website: string | null
          control_authority: string | null
          control_stage: string | null
          control_type: string
          country_code: string
          created_at: string
          effective_date: string | null
          expiry_date: string | null
          hs_code: string
          id: string
          is_active: boolean | null
          notes: string | null
          procedure_description: string | null
          required_documents: Json | null
          standard_reference: string | null
          standard_required: string | null
          updated_at: string
        }
        Insert: {
          authority_website?: string | null
          control_authority?: string | null
          control_stage?: string | null
          control_type: string
          country_code: string
          created_at?: string
          effective_date?: string | null
          expiry_date?: string | null
          hs_code: string
          id?: string
          is_active?: boolean | null
          notes?: string | null
          procedure_description?: string | null
          required_documents?: Json | null
          standard_reference?: string | null
          standard_required?: string | null
          updated_at?: string
        }
        Update: {
          authority_website?: string | null
          control_authority?: string | null
          control_stage?: string | null
          control_type?: string
          country_code?: string
          created_at?: string
          effective_date?: string | null
          expiry_date?: string | null
          hs_code?: string
          id?: string
          is_active?: boolean | null
          notes?: string | null
          procedure_description?: string | null
          required_documents?: Json | null
          standard_reference?: string | null
          standard_required?: string | null
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
          detected_country: string | null
          detected_hs_codes: Json | null
          detected_intent: string | null
          detected_keywords: Json | null
          feedback_text: string | null
          id: string
          model_used: string | null
          pdfs_used: Json | null
          question: string
          rating: number | null
          response: string | null
          response_sources: Json | null
          response_time_ms: number | null
          session_id: string | null
          tokens_used: number | null
          user_id: string | null
        }
        Insert: {
          confidence_level?: string | null
          context_used?: Json | null
          created_at?: string
          detected_country?: string | null
          detected_hs_codes?: Json | null
          detected_intent?: string | null
          detected_keywords?: Json | null
          feedback_text?: string | null
          id?: string
          model_used?: string | null
          pdfs_used?: Json | null
          question: string
          rating?: number | null
          response?: string | null
          response_sources?: Json | null
          response_time_ms?: number | null
          session_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Update: {
          confidence_level?: string | null
          context_used?: Json | null
          created_at?: string
          detected_country?: string | null
          detected_hs_codes?: Json | null
          detected_intent?: string | null
          detected_keywords?: Json | null
          feedback_text?: string | null
          id?: string
          model_used?: string | null
          pdfs_used?: Json | null
          question?: string
          rating?: number | null
          response?: string | null
          response_sources?: Json | null
          response_time_ms?: number | null
          session_id?: string | null
          tokens_used?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      countries: {
        Row: {
          code: string
          code_alpha3: string | null
          created_at: string
          currency_code: string | null
          flag_emoji: string | null
          id: string
          is_active: boolean | null
          name_ar: string | null
          name_en: string | null
          name_fr: string
          updated_at: string
        }
        Insert: {
          code: string
          code_alpha3?: string | null
          created_at?: string
          currency_code?: string | null
          flag_emoji?: string | null
          id?: string
          is_active?: boolean | null
          name_ar?: string | null
          name_en?: string | null
          name_fr: string
          updated_at?: string
        }
        Update: {
          code?: string
          code_alpha3?: string | null
          created_at?: string
          currency_code?: string | null
          flag_emoji?: string | null
          id?: string
          is_active?: boolean | null
          name_ar?: string | null
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
          duty_note: string | null
          duty_rate: number | null
          effective_date: string | null
          expiry_date: string | null
          hs_code_6: string
          id: string
          is_active: boolean | null
          is_inherited: boolean | null
          is_prohibited: boolean | null
          is_restricted: boolean | null
          national_code: string
          other_taxes: Json | null
          requires_license: boolean | null
          restriction_notes: string | null
          source: string | null
          source_url: string | null
          unit_code: string | null
          unit_description: string | null
          updated_at: string
          vat_rate: number | null
        }
        Insert: {
          country_code: string
          created_at?: string
          description_local?: string | null
          duty_note?: string | null
          duty_rate?: number | null
          effective_date?: string | null
          expiry_date?: string | null
          hs_code_6: string
          id?: string
          is_active?: boolean | null
          is_inherited?: boolean | null
          is_prohibited?: boolean | null
          is_restricted?: boolean | null
          national_code: string
          other_taxes?: Json | null
          requires_license?: boolean | null
          restriction_notes?: string | null
          source?: string | null
          source_url?: string | null
          unit_code?: string | null
          unit_description?: string | null
          updated_at?: string
          vat_rate?: number | null
        }
        Update: {
          country_code?: string
          created_at?: string
          description_local?: string | null
          duty_note?: string | null
          duty_rate?: number | null
          effective_date?: string | null
          expiry_date?: string | null
          hs_code_6?: string
          id?: string
          is_active?: boolean | null
          is_inherited?: boolean | null
          is_prohibited?: boolean | null
          is_restricted?: boolean | null
          national_code?: string
          other_taxes?: Json | null
          requires_license?: boolean | null
          restriction_notes?: string | null
          source?: string | null
          source_url?: string | null
          unit_code?: string | null
          unit_description?: string | null
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
          chapter_title_fr: string | null
          code: string
          code_clean: string
          created_at: string
          description_ar: string | null
          description_en: string | null
          description_fr: string
          embedding: string | null
          embedding_updated_at: string | null
          explanatory_notes: string | null
          hs_version: string | null
          id: string
          is_active: boolean | null
          legal_notes: string | null
          level: string | null
          parent_code: string | null
          section_number: number | null
          section_title_fr: string | null
          updated_at: string
        }
        Insert: {
          chapter_number?: number | null
          chapter_title_fr?: string | null
          code: string
          code_clean: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          description_fr: string
          embedding?: string | null
          embedding_updated_at?: string | null
          explanatory_notes?: string | null
          hs_version?: string | null
          id?: string
          is_active?: boolean | null
          legal_notes?: string | null
          level?: string | null
          parent_code?: string | null
          section_number?: number | null
          section_title_fr?: string | null
          updated_at?: string
        }
        Update: {
          chapter_number?: number | null
          chapter_title_fr?: string | null
          code?: string
          code_clean?: string
          created_at?: string
          description_ar?: string | null
          description_en?: string | null
          description_fr?: string
          embedding?: string | null
          embedding_updated_at?: string | null
          explanatory_notes?: string | null
          hs_version?: string | null
          id?: string
          is_active?: boolean | null
          legal_notes?: string | null
          level?: string | null
          parent_code?: string | null
          section_number?: number | null
          section_title_fr?: string | null
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
          embedding: string | null
          embedding_updated_at: string | null
          id: string
          is_active: boolean | null
          language: string | null
          publication_date: string | null
          reference: string | null
          related_hs_codes: Json | null
          source_name: string | null
          source_url: string | null
          subcategory: string | null
          summary: string | null
          tags: Json | null
          title: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          content: string
          country_code?: string | null
          created_at?: string
          embedding?: string | null
          embedding_updated_at?: string | null
          id?: string
          is_active?: boolean | null
          language?: string | null
          publication_date?: string | null
          reference?: string | null
          related_hs_codes?: Json | null
          source_name?: string | null
          source_url?: string | null
          subcategory?: string | null
          summary?: string | null
          tags?: Json | null
          title: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          content?: string
          country_code?: string | null
          created_at?: string
          embedding?: string | null
          embedding_updated_at?: string | null
          id?: string
          is_active?: boolean | null
          language?: string | null
          publication_date?: string | null
          reference?: string | null
          related_hs_codes?: Json | null
          source_name?: string | null
          source_url?: string | null
          subcategory?: string | null
          summary?: string | null
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
      legal_references: {
        Row: {
          context: string | null
          country_code: string | null
          created_at: string
          id: string
          is_active: boolean | null
          pdf_id: string
          reference_date: string | null
          reference_number: string
          reference_type: string
          title: string | null
          updated_at: string
        }
        Insert: {
          context?: string | null
          country_code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          pdf_id: string
          reference_date?: string | null
          reference_number: string
          reference_type: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          context?: string | null
          country_code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          pdf_id?: string
          reference_date?: string | null
          reference_number?: string
          reference_type?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_references_pdf_id_fkey"
            columns: ["pdf_id"]
            isOneToOne: false
            referencedRelation: "pdf_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      origin_rules: {
        Row: {
          agreement_code: string
          agreement_name: string | null
          annex_reference: string | null
          created_at: string
          cumulation_type: string | null
          de_minimis_percent: number | null
          hs_code: string
          hs_code_range_end: string | null
          hs_code_range_start: string | null
          id: string
          is_active: boolean | null
          minimum_value_added: number | null
          proof_required: string | null
          rule_text: string | null
          rule_type: string | null
          source_url: string | null
          updated_at: string
          value_added_percent: number | null
        }
        Insert: {
          agreement_code: string
          agreement_name?: string | null
          annex_reference?: string | null
          created_at?: string
          cumulation_type?: string | null
          de_minimis_percent?: number | null
          hs_code: string
          hs_code_range_end?: string | null
          hs_code_range_start?: string | null
          id?: string
          is_active?: boolean | null
          minimum_value_added?: number | null
          proof_required?: string | null
          rule_text?: string | null
          rule_type?: string | null
          source_url?: string | null
          updated_at?: string
          value_added_percent?: number | null
        }
        Update: {
          agreement_code?: string
          agreement_name?: string | null
          annex_reference?: string | null
          created_at?: string
          cumulation_type?: string | null
          de_minimis_percent?: number | null
          hs_code?: string
          hs_code_range_end?: string | null
          hs_code_range_start?: string | null
          id?: string
          is_active?: boolean | null
          minimum_value_added?: number | null
          proof_required?: string | null
          rule_text?: string | null
          rule_type?: string | null
          source_url?: string | null
          updated_at?: string
          value_added_percent?: number | null
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
          description: string | null
          document_reference: string | null
          document_type: string | null
          effective_date: string | null
          expiry_date: string | null
          file_name: string
          file_path: string
          file_size_bytes: number | null
          id: string
          is_active: boolean | null
          is_verified: boolean | null
          issuing_authority: string | null
          keywords: string | null
          language: string | null
          mime_type: string | null
          page_count: number | null
          publication_date: string | null
          reference: string | null
          related_hs_codes: Json | null
          subcategory: string | null
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
          description?: string | null
          document_reference?: string | null
          document_type?: string | null
          effective_date?: string | null
          expiry_date?: string | null
          file_name: string
          file_path: string
          file_size_bytes?: number | null
          id?: string
          is_active?: boolean | null
          is_verified?: boolean | null
          issuing_authority?: string | null
          keywords?: string | null
          language?: string | null
          mime_type?: string | null
          page_count?: number | null
          publication_date?: string | null
          reference?: string | null
          related_hs_codes?: Json | null
          subcategory?: string | null
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
          description?: string | null
          document_reference?: string | null
          document_type?: string | null
          effective_date?: string | null
          expiry_date?: string | null
          file_name?: string
          file_path?: string
          file_size_bytes?: number | null
          id?: string
          is_active?: boolean | null
          is_verified?: boolean | null
          issuing_authority?: string | null
          keywords?: string | null
          language?: string | null
          mime_type?: string | null
          page_count?: number | null
          publication_date?: string | null
          reference?: string | null
          related_hs_codes?: Json | null
          subcategory?: string | null
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
          embedding: string | null
          embedding_updated_at: string | null
          extracted_at: string | null
          extracted_data: Json | null
          extracted_text: string | null
          extraction_confidence: number | null
          extraction_date: string | null
          extraction_model: string | null
          id: string
          key_points: Json | null
          mentioned_amounts: Json | null
          mentioned_hs_codes: Json | null
          pdf_id: string
          summary: string | null
        }
        Insert: {
          created_at?: string
          detected_tariff_changes?: Json | null
          embedding?: string | null
          embedding_updated_at?: string | null
          extracted_at?: string | null
          extracted_data?: Json | null
          extracted_text?: string | null
          extraction_confidence?: number | null
          extraction_date?: string | null
          extraction_model?: string | null
          id?: string
          key_points?: Json | null
          mentioned_amounts?: Json | null
          mentioned_hs_codes?: Json | null
          pdf_id: string
          summary?: string | null
        }
        Update: {
          created_at?: string
          detected_tariff_changes?: Json | null
          embedding?: string | null
          embedding_updated_at?: string | null
          extracted_at?: string | null
          extracted_data?: Json | null
          extracted_text?: string | null
          extraction_confidence?: number | null
          extraction_date?: string | null
          extraction_model?: string | null
          id?: string
          key_points?: Json | null
          mentioned_amounts?: Json | null
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
      rate_limits: {
        Row: {
          blocked_until: string | null
          client_id: string
          request_count: number | null
          window_start: string | null
        }
        Insert: {
          blocked_until?: string | null
          client_id: string
          request_count?: number | null
          window_start?: string | null
        }
        Update: {
          blocked_until?: string | null
          client_id?: string
          request_count?: number | null
          window_start?: string | null
        }
        Relationships: []
      }
      regulatory_dates: {
        Row: {
          country_code: string | null
          created_at: string
          date_type: string
          date_value: string
          description: string | null
          id: string
          is_active: boolean | null
          pdf_id: string
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          date_type: string
          date_value: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          pdf_id: string
        }
        Update: {
          country_code?: string | null
          created_at?: string
          date_type?: string
          date_value?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          pdf_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "regulatory_dates_pdf_id_fkey"
            columns: ["pdf_id"]
            isOneToOne: false
            referencedRelation: "pdf_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      regulatory_procedures: {
        Row: {
          authority: string | null
          country_code: string | null
          created_at: string
          deadlines: string | null
          id: string
          is_active: boolean | null
          pdf_id: string
          penalties: string | null
          procedure_name: string
          required_documents: Json | null
          updated_at: string
        }
        Insert: {
          authority?: string | null
          country_code?: string | null
          created_at?: string
          deadlines?: string | null
          id?: string
          is_active?: boolean | null
          pdf_id: string
          penalties?: string | null
          procedure_name: string
          required_documents?: Json | null
          updated_at?: string
        }
        Update: {
          authority?: string | null
          country_code?: string | null
          created_at?: string
          deadlines?: string | null
          id?: string
          is_active?: boolean | null
          pdf_id?: string
          penalties?: string | null
          procedure_name?: string
          required_documents?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "regulatory_procedures_pdf_id_fkey"
            columns: ["pdf_id"]
            isOneToOne: false
            referencedRelation: "pdf_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      statistics: {
        Row: {
          avg_rating: number | null
          avg_response_time_ms: number | null
          created_at: string
          id: string
          metadata: Json | null
          questions_by_country: Json | null
          questions_by_intent: Json | null
          stat_date: string
          stat_type: string
          stat_value: number | null
          total_conversations: number | null
          total_questions: number | null
        }
        Insert: {
          avg_rating?: number | null
          avg_response_time_ms?: number | null
          created_at?: string
          id?: string
          metadata?: Json | null
          questions_by_country?: Json | null
          questions_by_intent?: Json | null
          stat_date?: string
          stat_type: string
          stat_value?: number | null
          total_conversations?: number | null
          total_questions?: number | null
        }
        Update: {
          avg_rating?: number | null
          avg_response_time_ms?: number | null
          created_at?: string
          id?: string
          metadata?: Json | null
          questions_by_country?: Json | null
          questions_by_intent?: Json | null
          stat_date?: string
          stat_type?: string
          stat_value?: number | null
          total_conversations?: number | null
          total_questions?: number | null
        }
        Relationships: []
      }
      trade_agreements: {
        Row: {
          agreement_type: string | null
          code: string
          created_at: string
          entry_into_force: string | null
          id: string
          is_active: boolean | null
          legal_text_url: string | null
          name_en: string | null
          name_fr: string
          notes: string | null
          parties: Json
          proof_required: string | null
          signature_date: string | null
          summary: string | null
          updated_at: string
        }
        Insert: {
          agreement_type?: string | null
          code: string
          created_at?: string
          entry_into_force?: string | null
          id?: string
          is_active?: boolean | null
          legal_text_url?: string | null
          name_en?: string | null
          name_fr: string
          notes?: string | null
          parties?: Json
          proof_required?: string | null
          signature_date?: string | null
          summary?: string | null
          updated_at?: string
        }
        Update: {
          agreement_type?: string | null
          code?: string
          created_at?: string
          entry_into_force?: string | null
          id?: string
          is_active?: boolean | null
          legal_text_url?: string | null
          name_en?: string | null
          name_fr?: string
          notes?: string | null
          parties?: Json
          proof_required?: string | null
          signature_date?: string | null
          summary?: string | null
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
          auto_insert: boolean | null
          confidence_threshold: number | null
          created_at: string
          frequency_hours: number | null
          id: string
          is_active: boolean | null
          last_run_at: string | null
          max_results_per_keyword: number | null
          mode: string | null
          notification_email: string | null
          notify_email: boolean | null
          notify_on_high_importance: boolean | null
          notify_on_tariff_change: boolean | null
          updated_at: string
        }
        Insert: {
          auto_insert?: boolean | null
          confidence_threshold?: number | null
          created_at?: string
          frequency_hours?: number | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          max_results_per_keyword?: number | null
          mode?: string | null
          notification_email?: string | null
          notify_email?: boolean | null
          notify_on_high_importance?: boolean | null
          notify_on_tariff_change?: boolean | null
          updated_at?: string
        }
        Update: {
          auto_insert?: boolean | null
          confidence_threshold?: number | null
          created_at?: string
          frequency_hours?: number | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          max_results_per_keyword?: number | null
          mode?: string | null
          notification_email?: string | null
          notify_email?: boolean | null
          notify_on_high_importance?: boolean | null
          notify_on_tariff_change?: boolean | null
          updated_at?: string
        }
        Relationships: []
      }
      veille_documents: {
        Row: {
          category: string | null
          collected_at: string | null
          collected_by: string | null
          confidence_score: number | null
          content: string | null
          country_code: string | null
          created_at: string
          detected_new_controls: Json | null
          detected_tariff_changes: Json | null
          embedding: string | null
          embedding_updated_at: string | null
          external_id: string | null
          id: string
          importance: string | null
          is_processed: boolean | null
          is_verified: boolean | null
          keywords: string | null
          mentioned_hs_codes: Json | null
          processed_at: string | null
          publication_date: string | null
          search_keyword: string | null
          source_name: string | null
          source_url: string | null
          subcategory: string | null
          summary: string | null
          tags: Json | null
          title: string
          verified_at: string | null
        }
        Insert: {
          category?: string | null
          collected_at?: string | null
          collected_by?: string | null
          confidence_score?: number | null
          content?: string | null
          country_code?: string | null
          created_at?: string
          detected_new_controls?: Json | null
          detected_tariff_changes?: Json | null
          embedding?: string | null
          embedding_updated_at?: string | null
          external_id?: string | null
          id?: string
          importance?: string | null
          is_processed?: boolean | null
          is_verified?: boolean | null
          keywords?: string | null
          mentioned_hs_codes?: Json | null
          processed_at?: string | null
          publication_date?: string | null
          search_keyword?: string | null
          source_name?: string | null
          source_url?: string | null
          subcategory?: string | null
          summary?: string | null
          tags?: Json | null
          title: string
          verified_at?: string | null
        }
        Update: {
          category?: string | null
          collected_at?: string | null
          collected_by?: string | null
          confidence_score?: number | null
          content?: string | null
          country_code?: string | null
          created_at?: string
          detected_new_controls?: Json | null
          detected_tariff_changes?: Json | null
          embedding?: string | null
          embedding_updated_at?: string | null
          external_id?: string | null
          id?: string
          importance?: string | null
          is_processed?: boolean | null
          is_verified?: boolean | null
          keywords?: string | null
          mentioned_hs_codes?: Json | null
          processed_at?: string | null
          publication_date?: string | null
          search_keyword?: string | null
          source_name?: string | null
          source_url?: string | null
          subcategory?: string | null
          summary?: string | null
          tags?: Json | null
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
          controls_added: number | null
          created_at: string
          cycle_ended_at: string | null
          cycle_started_at: string
          documents_found: number | null
          documents_inserted: number | null
          documents_new: number | null
          duration_seconds: number | null
          errors: Json | null
          id: string
          keywords_searched: number | null
          sites_scraped: number | null
          status: string | null
          tariffs_updated: number | null
          warnings: Json | null
        }
        Insert: {
          controls_added?: number | null
          created_at?: string
          cycle_ended_at?: string | null
          cycle_started_at: string
          documents_found?: number | null
          documents_inserted?: number | null
          documents_new?: number | null
          duration_seconds?: number | null
          errors?: Json | null
          id?: string
          keywords_searched?: number | null
          sites_scraped?: number | null
          status?: string | null
          tariffs_updated?: number | null
          warnings?: Json | null
        }
        Update: {
          controls_added?: number | null
          created_at?: string
          cycle_ended_at?: string | null
          cycle_started_at?: string
          documents_found?: number | null
          documents_inserted?: number | null
          documents_new?: number | null
          duration_seconds?: number | null
          errors?: Json | null
          id?: string
          keywords_searched?: number | null
          sites_scraped?: number | null
          status?: string | null
          tariffs_updated?: number | null
          warnings?: Json | null
        }
        Relationships: []
      }
      veille_sites: {
        Row: {
          categories: Json | null
          country_code: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          last_scrape_status: string | null
          last_scraped_at: string | null
          name: string
          scrape_frequency_hours: number | null
          scrape_selector: string | null
          scrape_type: string | null
          site_type: string | null
          total_documents_found: number | null
          url: string
        }
        Insert: {
          categories?: Json | null
          country_code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_scrape_status?: string | null
          last_scraped_at?: string | null
          name: string
          scrape_frequency_hours?: number | null
          scrape_selector?: string | null
          scrape_type?: string | null
          site_type?: string | null
          total_documents_found?: number | null
          url: string
        }
        Update: {
          categories?: Json | null
          country_code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          last_scrape_status?: string | null
          last_scraped_at?: string | null
          name?: string
          scrape_frequency_hours?: number | null
          scrape_selector?: string | null
          scrape_type?: string | null
          site_type?: string | null
          total_documents_found?: number | null
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
      cleanup_old_rate_limits: { Args: never; Returns: number }
      get_dashboard_stats: {
        Args: never
        Returns: {
          alerts_unread_count: number
          conversations_count: number
          documents_count: number
          hs_codes_count: number
          pdfs_count: number
          tariffs_count: number
          veille_pending_count: number
        }[]
      }
      get_tariff_details: {
        Args: { p_country_code: string; p_hs_code: string }
        Returns: {
          control_authority: string
          control_type: string
          description: string
          duty_rate: number
          hs_code: string
          is_controlled: boolean
          national_code: string
          vat_rate: number
        }[]
      }
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
      search_all_semantic: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          content_preview: string
          similarity: number
          source_id: string
          source_table: string
          title: string
        }[]
      }
      search_hs_codes: {
        Args: { limit_count?: number; search_term: string }
        Returns: {
          chapter_number: number
          code: string
          description_fr: string
          id: string
        }[]
      }
      search_hs_codes_semantic: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          chapter_number: number
          code: string
          description_en: string
          description_fr: string
          id: string
          level: string
          section_number: number
          similarity: number
        }[]
      }
      search_knowledge_documents_semantic: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          category: string
          content: string
          country_code: string
          id: string
          similarity: number
          summary: string
          title: string
        }[]
      }
      search_legal_references: {
        Args: { limit_count?: number; search_term: string }
        Returns: {
          context: string
          id: string
          pdf_category: string
          pdf_id: string
          pdf_title: string
          reference_date: string
          reference_number: string
          reference_type: string
          title: string
        }[]
      }
      search_pdf_extractions_semantic: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          extracted_text: string
          id: string
          key_points: Json
          pdf_id: string
          similarity: number
          summary: string
        }[]
      }
      search_regulatory_procedures: {
        Args: { limit_count?: number; search_term: string }
        Returns: {
          authority: string
          deadlines: string
          id: string
          pdf_id: string
          pdf_title: string
          penalties: string
          procedure_name: string
          required_documents: Json
        }[]
      }
      search_veille_documents_semantic: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          category: string
          content: string
          country_code: string
          id: string
          importance: string
          similarity: number
          summary: string
          title: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
