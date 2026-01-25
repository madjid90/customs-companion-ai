import { supabase } from "@/integrations/supabase/client";

// Types based on database schema
export interface HSCode {
  id: string;
  code: string;
  code_clean: string;
  description_fr: string;
  description_en: string | null;
  chapter_number: number | null;
  section_number: number | null;
  level: string | null;
  legal_notes: string | null;
  explanatory_notes: string | null;
  is_active: boolean;
}

export interface CountryTariff {
  id: string;
  country_code: string;
  hs_code_6: string;
  national_code: string;
  description_local: string | null;
  duty_rate: number;
  vat_rate: number;
  other_taxes: Record<string, any>;
  is_prohibited: boolean;
  is_restricted: boolean;
  is_active: boolean;
}

export interface ControlledProduct {
  id: string;
  country_code: string;
  hs_code: string;
  control_type: string;
  control_authority: string | null;
  required_norm: string | null;
  required_documents: string[];
  is_active: boolean;
}

export interface Country {
  id: string;
  code: string;
  code_alpha3: string | null;
  name_fr: string;
  name_en: string | null;
  currency_code: string;
  is_active: boolean;
}

// HS Codes Service
export const hsCodesService = {
  async search(query: string, options?: { chapter?: number; limit?: number; offset?: number }) {
    let queryBuilder = supabase
      .from('hs_codes')
      .select('*', { count: 'exact' })
      .eq('is_active', true)
      .order('code');

    if (query) {
      queryBuilder = queryBuilder.or(
        `code.ilike.%${query}%,description_fr.ilike.%${query}%,description_en.ilike.%${query}%`
      );
    }

    if (options?.chapter) {
      queryBuilder = queryBuilder.eq('chapter_number', options.chapter);
    }

    const limit = options?.limit || 20;
    const offset = options?.offset || 0;
    queryBuilder = queryBuilder.range(offset, offset + limit - 1);

    const { data, error, count } = await queryBuilder;
    return { data: data as HSCode[] | null, error, count };
  },

  async getByCode(code: string) {
    const { data, error } = await supabase
      .from('hs_codes')
      .select('*')
      .eq('code', code)
      .eq('is_active', true)
      .single();
    return { data: data as HSCode | null, error };
  },

  async autocomplete(input: string, limit = 10) {
    const { data, error } = await supabase
      .from('hs_codes')
      .select('code, description_fr')
      .ilike('code', `${input}%`)
      .eq('is_active', true)
      .limit(limit);
    return { data, error };
  },
};

// Tariffs Service
export const tariffsService = {
  async getForCode(countryCode: string, hsCode6: string) {
    const cleanCode = hsCode6.replace(/\./g, '').substring(0, 6);
    const { data, error } = await supabase
      .from('country_tariffs')
      .select('*')
      .eq('country_code', countryCode)
      .eq('hs_code_6', cleanCode)
      .eq('is_active', true)
      .single();
    return { data: data as CountryTariff | null, error };
  },

  async search(countryCode: string, query: string, options?: { limit?: number; offset?: number }) {
    let queryBuilder = supabase
      .from('country_tariffs')
      .select('*', { count: 'exact' })
      .eq('country_code', countryCode)
      .eq('is_active', true)
      .order('national_code');

    if (query) {
      queryBuilder = queryBuilder.or(
        `hs_code_6.ilike.%${query}%,national_code.ilike.%${query}%,description_local.ilike.%${query}%`
      );
    }

    const limit = options?.limit || 20;
    const offset = options?.offset || 0;
    queryBuilder = queryBuilder.range(offset, offset + limit - 1);

    const { data, error, count } = await queryBuilder;
    return { data: data as CountryTariff[] | null, error, count };
  },
};

// Controlled Products Service
export const controlledService = {
  async checkProduct(countryCode: string, hsCode: string) {
    const code4 = hsCode.replace(/\./g, '').substring(0, 4);
    const { data, error } = await supabase
      .from('controlled_products')
      .select('*')
      .eq('country_code', countryCode)
      .ilike('hs_code', `${code4}%`)
      .eq('is_active', true);
    return { data: data as ControlledProduct[] | null, error };
  },

  async search(countryCode: string, options?: { authority?: string; limit?: number; offset?: number }) {
    let queryBuilder = supabase
      .from('controlled_products')
      .select('*', { count: 'exact' })
      .eq('country_code', countryCode)
      .eq('is_active', true);

    if (options?.authority) {
      queryBuilder = queryBuilder.eq('control_authority', options.authority);
    }

    const limit = options?.limit || 20;
    const offset = options?.offset || 0;
    queryBuilder = queryBuilder.range(offset, offset + limit - 1);

    const { data, error, count } = await queryBuilder;
    return { data: data as ControlledProduct[] | null, error, count };
  },
};

// Countries Service
export const countriesService = {
  async getAll() {
    const { data, error } = await supabase
      .from('countries')
      .select('*')
      .eq('is_active', true)
      .order('name_fr');
    return { data: data as Country[] | null, error };
  },

  async getByCode(code: string) {
    const { data, error } = await supabase
      .from('countries')
      .select('*')
      .eq('code', code)
      .single();
    return { data: data as Country | null, error };
  },
};

// Statistics Service
export const statsService = {
  async getDashboardStats() {
    const [hsCount, tariffsCount, pdfCount, convCount] = await Promise.all([
      supabase.from('hs_codes').select('*', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('country_tariffs').select('*', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('pdf_documents').select('*', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('conversations').select('*', { count: 'exact', head: true }),
    ]);

    return {
      hs_codes: hsCount.count || 0,
      tariffs: tariffsCount.count || 0,
      documents: pdfCount.count || 0,
      conversations: convCount.count || 0,
    };
  },

  async getConversationsPerDay(days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await supabase
      .from('conversations')
      .select('created_at')
      .gte('created_at', startDate.toISOString());

    if (error || !data) return [];

    // Group by date
    const grouped = data.reduce((acc: Record<string, number>, conv) => {
      const date = conv.created_at.split('T')[0];
      acc[date] = (acc[date] || 0) + 1;
      return acc;
    }, {});

    // Create array for last N days
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayName = d.toLocaleDateString('fr-FR', { weekday: 'short' });
      result.push({
        date: dayName,
        conversations: grouped[dateStr] || 0,
      });
    }

    return result;
  },

  async getRecentAlerts(limit = 5) {
    const { data, error } = await supabase
      .from('alerts')
      .select('*')
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(limit);
    return { data, error };
  },

  async getPendingVeille(limit = 5) {
    const { data, error } = await supabase
      .from('veille_documents')
      .select('*')
      .eq('is_verified', false)
      .order('collected_at', { ascending: false })
      .limit(limit);
    return { data, error };
  },
};

// Calculate duties
export function calculateDuties(cifValue: number, dutyRate: number, vatRate: number) {
  const dutyAmount = cifValue * (dutyRate / 100);
  const vatBase = cifValue + dutyAmount;
  const vatAmount = vatBase * (vatRate / 100);
  const total = cifValue + dutyAmount + vatAmount;

  return {
    cifValue,
    dutyRate,
    dutyAmount,
    vatBase,
    vatRate,
    vatAmount,
    total,
  };
}
