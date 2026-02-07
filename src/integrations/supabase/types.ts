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
          source_evidence: string | null
          source_extraction_id: number | null
          source_page: number | null
          source_pdf: string | null
          source_url: string | null
          unit_code: string | null
          unit_complementary_code: string | null
          unit_complementary_description: string | null
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
          source_evidence?: string | null
          source_extraction_id?: number | null
          source_page?: number | null
          source_pdf?: string | null
          source_url?: string | null
          unit_code?: string | null
          unit_complementary_code?: string | null
          unit_complementary_description?: string | null
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
          source_evidence?: string | null
          source_extraction_id?: number | null
          source_page?: number | null
          source_pdf?: string | null
          source_url?: string | null
          unit_code?: string | null
          unit_complementary_code?: string | null
          unit_complementary_description?: string | null
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
      dum_documents: {
        Row: {
          bureau_code: string | null
          bureau_name: string | null
          cif_value: number | null
          country_code: string
          created_at: string
          currency_code: string | null
          dum_date: string | null
          dum_number: string | null
          exporter_country: string | null
          exporter_name: string | null
          extracted_json: Json | null
          freight_value: number | null
          grand_total: number | null
          id: string
          importer_id: string | null
          importer_name: string | null
          incoterm: string | null
          insurance_value: number | null
          invoice_value: number | null
          is_complete: boolean | null
          missing_rates: string[] | null
          regime_code: string | null
          source_page_count: number | null
          source_pdf: string | null
          total_duty: number | null
          total_other_taxes: number | null
          total_vat: number | null
          updated_at: string
          validation_warnings: string[] | null
        }
        Insert: {
          bureau_code?: string | null
          bureau_name?: string | null
          cif_value?: number | null
          country_code?: string
          created_at?: string
          currency_code?: string | null
          dum_date?: string | null
          dum_number?: string | null
          exporter_country?: string | null
          exporter_name?: string | null
          extracted_json?: Json | null
          freight_value?: number | null
          grand_total?: number | null
          id?: string
          importer_id?: string | null
          importer_name?: string | null
          incoterm?: string | null
          insurance_value?: number | null
          invoice_value?: number | null
          is_complete?: boolean | null
          missing_rates?: string[] | null
          regime_code?: string | null
          source_page_count?: number | null
          source_pdf?: string | null
          total_duty?: number | null
          total_other_taxes?: number | null
          total_vat?: number | null
          updated_at?: string
          validation_warnings?: string[] | null
        }
        Update: {
          bureau_code?: string | null
          bureau_name?: string | null
          cif_value?: number | null
          country_code?: string
          created_at?: string
          currency_code?: string | null
          dum_date?: string | null
          dum_number?: string | null
          exporter_country?: string | null
          exporter_name?: string | null
          extracted_json?: Json | null
          freight_value?: number | null
          grand_total?: number | null
          id?: string
          importer_id?: string | null
          importer_name?: string | null
          incoterm?: string | null
          insurance_value?: number | null
          invoice_value?: number | null
          is_complete?: boolean | null
          missing_rates?: string[] | null
          regime_code?: string | null
          source_page_count?: number | null
          source_pdf?: string | null
          total_duty?: number | null
          total_other_taxes?: number | null
          total_vat?: number | null
          updated_at?: string
          validation_warnings?: string[] | null
        }
        Relationships: []
      }
      dum_items: {
        Row: {
          created_at: string
          description: string | null
          dum_id: string
          duty_amount: number | null
          duty_rate: number | null
          duty_rate_source: string | null
          extraction_confidence: string | null
          hs_code: string | null
          hs_code_normalized: string | null
          id: string
          line_no: number
          origin_country: string | null
          other_taxes: Json | null
          other_taxes_amount: number | null
          quantity: number | null
          source_evidence: string | null
          source_page: number | null
          total_taxes: number | null
          unit: string | null
          unit_price: number | null
          value: number | null
          vat_amount: number | null
          vat_rate: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          dum_id: string
          duty_amount?: number | null
          duty_rate?: number | null
          duty_rate_source?: string | null
          extraction_confidence?: string | null
          hs_code?: string | null
          hs_code_normalized?: string | null
          id?: string
          line_no: number
          origin_country?: string | null
          other_taxes?: Json | null
          other_taxes_amount?: number | null
          quantity?: number | null
          source_evidence?: string | null
          source_page?: number | null
          total_taxes?: number | null
          unit?: string | null
          unit_price?: number | null
          value?: number | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          dum_id?: string
          duty_amount?: number | null
          duty_rate?: number | null
          duty_rate_source?: string | null
          extraction_confidence?: string | null
          hs_code?: string | null
          hs_code_normalized?: string | null
          id?: string
          line_no?: number
          origin_country?: string | null
          other_taxes?: Json | null
          other_taxes_amount?: number | null
          quantity?: number | null
          source_evidence?: string | null
          source_page?: number | null
          total_taxes?: number | null
          unit?: string | null
          unit_price?: number | null
          value?: number | null
          vat_amount?: number | null
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "dum_items_dum_id_fkey"
            columns: ["dum_id"]
            isOneToOne: false
            referencedRelation: "dum_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      embedding_queue: {
        Row: {
          attempts: number | null
          created_at: string | null
          error_message: string | null
          id: string
          processed_at: string | null
          record_id: string
          status: string | null
          table_name: string
          text_content: string
        }
        Insert: {
          attempts?: number | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          processed_at?: string | null
          record_id: string
          status?: string | null
          table_name: string
          text_content: string
        }
        Update: {
          attempts?: number | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          processed_at?: string | null
          record_id?: string
          status?: string | null
          table_name?: string
          text_content?: string
        }
        Relationships: []
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
      hs_evidence: {
        Row: {
          confidence: string | null
          country_code: string
          created_at: string
          evidence_text: string
          hs_code_6: string | null
          id: number
          national_code: string
          page_number: number | null
          source_id: number
        }
        Insert: {
          confidence?: string | null
          country_code?: string
          created_at?: string
          evidence_text: string
          hs_code_6?: string | null
          id?: number
          national_code: string
          page_number?: number | null
          source_id: number
        }
        Update: {
          confidence?: string | null
          country_code?: string
          created_at?: string
          evidence_text?: string
          hs_code_6?: string | null
          id?: number
          national_code?: string
          page_number?: number | null
          source_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "hs_evidence_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "legal_sources"
            referencedColumns: ["id"]
          },
        ]
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
      legal_chunks: {
        Row: {
          article_number: string | null
          char_end: number | null
          char_start: number | null
          chunk_index: number
          chunk_text: string
          chunk_type: string | null
          created_at: string
          embedding: string | null
          hierarchy_path: string | null
          id: number
          is_active: boolean | null
          keywords: Json | null
          mentioned_hs_codes: Json | null
          page_number: number | null
          parent_section: string | null
          section_title: string | null
          source_id: number
          token_count: number | null
        }
        Insert: {
          article_number?: string | null
          char_end?: number | null
          char_start?: number | null
          chunk_index?: number
          chunk_text: string
          chunk_type?: string | null
          created_at?: string
          embedding?: string | null
          hierarchy_path?: string | null
          id?: number
          is_active?: boolean | null
          keywords?: Json | null
          mentioned_hs_codes?: Json | null
          page_number?: number | null
          parent_section?: string | null
          section_title?: string | null
          source_id: number
          token_count?: number | null
        }
        Update: {
          article_number?: string | null
          char_end?: number | null
          char_start?: number | null
          chunk_index?: number
          chunk_text?: string
          chunk_type?: string | null
          created_at?: string
          embedding?: string | null
          hierarchy_path?: string | null
          id?: number
          is_active?: boolean | null
          keywords?: Json | null
          mentioned_hs_codes?: Json | null
          page_number?: number | null
          parent_section?: string | null
          section_title?: string | null
          source_id?: number
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "legal_chunks_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "legal_sources"
            referencedColumns: ["id"]
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
      legal_sources: {
        Row: {
          country_code: string
          created_at: string
          document_type: string | null
          effective_date: string | null
          excerpt: string | null
          full_text: string | null
          id: number
          is_current: boolean | null
          issuer: string | null
          language: string | null
          source_date: string | null
          source_ref: string
          source_type: string
          source_url: string | null
          title: string | null
          total_chunks: number | null
        }
        Insert: {
          country_code?: string
          created_at?: string
          document_type?: string | null
          effective_date?: string | null
          excerpt?: string | null
          full_text?: string | null
          id?: number
          is_current?: boolean | null
          issuer?: string | null
          language?: string | null
          source_date?: string | null
          source_ref: string
          source_type: string
          source_url?: string | null
          title?: string | null
          total_chunks?: number | null
        }
        Update: {
          country_code?: string
          created_at?: string
          document_type?: string | null
          effective_date?: string | null
          excerpt?: string | null
          full_text?: string | null
          id?: number
          is_current?: boolean | null
          issuer?: string | null
          language?: string | null
          source_date?: string | null
          source_ref?: string
          source_type?: string
          source_url?: string | null
          title?: string | null
          total_chunks?: number | null
        }
        Relationships: []
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
      pdf_extraction_runs: {
        Row: {
          batch_size: number | null
          completed_at: string | null
          country_code: string | null
          created_at: string
          current_page: number
          file_name: string | null
          id: string
          last_error: string | null
          pdf_id: string
          processed_pages: number
          started_at: string | null
          stats: Json | null
          status: string
          total_pages: number | null
          updated_at: string
        }
        Insert: {
          batch_size?: number | null
          completed_at?: string | null
          country_code?: string | null
          created_at?: string
          current_page?: number
          file_name?: string | null
          id?: string
          last_error?: string | null
          pdf_id: string
          processed_pages?: number
          started_at?: string | null
          stats?: Json | null
          status?: string
          total_pages?: number | null
          updated_at?: string
        }
        Update: {
          batch_size?: number | null
          completed_at?: string | null
          country_code?: string | null
          created_at?: string
          current_page?: number
          file_name?: string | null
          id?: string
          last_error?: string | null
          pdf_id?: string
          processed_pages?: number
          started_at?: string | null
          stats?: Json | null
          status?: string
          total_pages?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pdf_extraction_runs_pdf_id_fkey"
            columns: ["pdf_id"]
            isOneToOne: false
            referencedRelation: "pdf_documents"
            referencedColumns: ["id"]
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
      response_cache: {
        Row: {
          cited_circulars: Json | null
          confidence_level: string | null
          context_used: Json | null
          created_at: string
          expires_at: string
          has_db_evidence: boolean | null
          hit_count: number | null
          id: string
          question_embedding: string | null
          question_hash: string
          question_text: string
          response_text: string
          updated_at: string
          validation_message: string | null
        }
        Insert: {
          cited_circulars?: Json | null
          confidence_level?: string | null
          context_used?: Json | null
          created_at?: string
          expires_at?: string
          has_db_evidence?: boolean | null
          hit_count?: number | null
          id?: string
          question_embedding?: string | null
          question_hash: string
          question_text: string
          response_text: string
          updated_at?: string
          validation_message?: string | null
        }
        Update: {
          cited_circulars?: Json | null
          confidence_level?: string | null
          context_used?: Json | null
          created_at?: string
          expires_at?: string
          has_db_evidence?: boolean | null
          hit_count?: number | null
          id?: string
          question_embedding?: string | null
          question_hash?: string
          question_text?: string
          response_text?: string
          updated_at?: string
          validation_message?: string | null
        }
        Relationships: []
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
      tariff_notes: {
        Row: {
          anchor: string | null
          chapter_number: string | null
          country_code: string
          created_at: string
          embedding: string | null
          embedding_updated_at: string | null
          id: number
          note_text: string
          note_type: string
          page_number: number | null
          source_extraction_id: number | null
          source_pdf: string | null
        }
        Insert: {
          anchor?: string | null
          chapter_number?: string | null
          country_code?: string
          created_at?: string
          embedding?: string | null
          embedding_updated_at?: string | null
          id?: number
          note_text: string
          note_type: string
          page_number?: number | null
          source_extraction_id?: number | null
          source_pdf?: string | null
        }
        Update: {
          anchor?: string | null
          chapter_number?: string | null
          country_code?: string
          created_at?: string
          embedding?: string | null
          embedding_updated_at?: string | null
          id?: number
          note_text?: string
          note_type?: string
          page_number?: number | null
          source_extraction_id?: number | null
          source_pdf?: string | null
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
      documents_missing_embeddings: {
        Row: {
          count: number | null
          table_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      calculate_dum_item_taxes: {
        Args: {
          p_cif_value: number
          p_duty_rate: number
          p_other_taxes?: Json
          p_vat_rate?: number
        }
        Returns: Json
      }
      check_embedding_coverage: {
        Args: never
        Returns: {
          coverage_percent: number
          table_name: string
          total_records: number
          with_embedding: number
        }[]
      }
      cleanup_expired_cache: { Args: never; Returns: number }
      cleanup_old_rate_limits: { Args: never; Returns: number }
      find_cached_response: {
        Args: { query_embedding: string; similarity_threshold?: number }
        Returns: {
          cited_circulars: Json
          confidence_level: string
          context_used: Json
          has_db_evidence: boolean
          id: string
          question_text: string
          response_text: string
          similarity: number
          validation_message: string
        }[]
      }
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
      search_hs_codes_hybrid: {
        Args: {
          match_count?: number
          query_embedding: string
          query_text: string
          semantic_weight?: number
        }
        Returns: {
          chapter_number: number
          code: string
          code_clean: string
          combined_score: number
          description_en: string
          description_fr: string
          fts_score: number
          id: string
          level: string
          semantic_score: number
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
      search_legal_by_article: {
        Args: { p_article_pattern: string; p_source_type?: string }
        Returns: {
          article_number: string
          chunk_text: string
          chunk_type: string
          hierarchy_path: string
          id: number
          page_number: number
          section_title: string
          source_id: number
          source_title: string
        }[]
      }
      search_legal_by_hs_code: {
        Args: { p_hs_code: string }
        Returns: {
          article_number: string
          chunk_text: string
          id: number
          page_number: number
          relevance_score: number
          source_id: number
          source_title: string
        }[]
      }
      search_legal_chunks_hybrid: {
        Args: {
          match_count?: number
          query_embedding: string
          query_text: string
          semantic_weight?: number
        }
        Returns: {
          article_number: string
          chunk_text: string
          chunk_type: string
          combined_score: number
          id: number
          page_number: number
          section_title: string
          source_id: number
        }[]
      }
      search_legal_chunks_multilingual: {
        Args: {
          lang_config?: string
          match_count?: number
          query_embedding: string
          query_text: string
        }
        Returns: {
          article_number: string
          chunk_text: string
          chunk_type: string
          id: number
          page_number: number
          relevance_score: number
          section_title: string
          source_id: number
        }[]
      }
      search_legal_chunks_semantic: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          chunk_text: string
          id: number
          issuer: string
          page_number: number
          similarity: number
          source_id: number
          source_ref: string
          source_type: string
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
      search_legal_references_fts: {
        Args: { limit_count?: number; search_query: string }
        Returns: {
          context: string
          id: string
          pdf_category: string
          pdf_id: string
          pdf_title: string
          reference_date: string
          reference_number: string
          reference_type: string
          relevance_score: number
          title: string
        }[]
      }
      search_pdf_by_chapter_prefixes: {
        Args: { prefixes: string[] }
        Returns: {
          chapter_number: number
          extracted_text: string
          extraction_id: string
          key_points: Json
          mentioned_hs_codes: Json
          pdf_category: string
          pdf_file_path: string
          pdf_id: string
          pdf_title: string
          summary: string
        }[]
      }
      search_pdf_extractions_keyword: {
        Args: { match_count?: number; search_query: string }
        Returns: {
          extracted_text: string
          id: string
          key_points: Json
          pdf_id: string
          relevance_score: number
          summary: string
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
      search_tariff_notes_fts: {
        Args: {
          chapter_filter?: string
          match_count?: number
          search_query: string
        }
        Returns: {
          anchor: string
          chapter_number: string
          country_code: string
          id: number
          note_text: string
          note_type: string
          page_number: number
          relevance_score: number
        }[]
      }
      search_tariff_notes_hybrid: {
        Args: {
          chapter_filters?: string[]
          match_count?: number
          query_embedding: string
          query_text: string
          semantic_weight?: number
        }
        Returns: {
          anchor: string
          chapter_number: string
          combined_score: number
          id: number
          note_text: string
          note_type: string
          page_number: number
        }[]
      }
      search_tariff_notes_semantic: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          anchor: string
          chapter_number: string
          country_code: string
          id: number
          note_text: string
          note_type: string
          page_number: number
          similarity: number
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
      update_cache_hit: { Args: { cache_id: string }; Returns: undefined }
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
