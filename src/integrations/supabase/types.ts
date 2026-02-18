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
      assets_cache: {
        Row: {
          currency: string | null
          id: string
          last_price: number | null
          name: string | null
          previous_close: number | null
          sector: string | null
          ticker: string
          updated_at: string
        }
        Insert: {
          currency?: string | null
          id?: string
          last_price?: number | null
          name?: string | null
          previous_close?: number | null
          sector?: string | null
          ticker: string
          updated_at?: string
        }
        Update: {
          currency?: string | null
          id?: string
          last_price?: number | null
          name?: string | null
          previous_close?: number | null
          sector?: string | null
          ticker?: string
          updated_at?: string
        }
        Relationships: []
      }
      calculator_settings: {
        Row: {
          custom_payments: Json | null
          id: string
          insurance_amount: number | null
          investment_return_rate: number | null
          loan_amount: number | null
          loan_interest_rate_repayment: number | null
          loan_start_date: string | null
          repayment_duration_years: number | null
          repayment_start_date: string | null
          updated_at: string
        }
        Insert: {
          custom_payments?: Json | null
          id?: string
          insurance_amount?: number | null
          investment_return_rate?: number | null
          loan_amount?: number | null
          loan_interest_rate_repayment?: number | null
          loan_start_date?: string | null
          repayment_duration_years?: number | null
          repayment_start_date?: string | null
          updated_at?: string
        }
        Update: {
          custom_payments?: Json | null
          id?: string
          insurance_amount?: number | null
          investment_return_rate?: number | null
          loan_amount?: number | null
          loan_interest_rate_repayment?: number | null
          loan_start_date?: string | null
          repayment_duration_years?: number | null
          repayment_start_date?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      earnings: {
        Row: {
          created_at: string
          debt_ebitda: number | null
          id: string
          moat: boolean
          notes: string | null
          operating_margin: number | null
          quarter: string
          revenue_growth: number | null
          roe: number | null
          status: string
          ticker: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          debt_ebitda?: number | null
          id?: string
          moat?: boolean
          notes?: string | null
          operating_margin?: number | null
          quarter: string
          revenue_growth?: number | null
          roe?: number | null
          status?: string
          ticker: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          debt_ebitda?: number | null
          id?: string
          moat?: boolean
          notes?: string | null
          operating_margin?: number | null
          quarter?: string
          revenue_growth?: number | null
          roe?: number | null
          status?: string
          ticker?: string
          updated_at?: string
        }
        Relationships: []
      }
      portfolios: {
        Row: {
          cash_balance: number
          color: string
          created_at: string
          currency: string
          description: string | null
          id: string
          name: string
          type: string
          updated_at: string
        }
        Insert: {
          cash_balance?: number
          color?: string
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          name: string
          type?: string
          updated_at?: string
        }
        Update: {
          cash_balance?: number
          color?: string
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          name?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          created_at: string
          currency: string | null
          date: string
          fees: number
          id: string
          notes: string | null
          portfolio_id: string
          quantity: number | null
          ticker: string | null
          type: string
          unit_price: number | null
        }
        Insert: {
          created_at?: string
          currency?: string | null
          date?: string
          fees?: number
          id?: string
          notes?: string | null
          portfolio_id: string
          quantity?: number | null
          ticker?: string | null
          type: string
          unit_price?: number | null
        }
        Update: {
          created_at?: string
          currency?: string | null
          date?: string
          fees?: number
          id?: string
          notes?: string | null
          portfolio_id?: string
          quantity?: number | null
          ticker?: string | null
          type?: string
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      watchlist_valuations: {
        Row: {
          created_at: string | null
          eps: number | null
          eps_growth: number | null
          id: string
          min_return: number | null
          notes: string | null
          terminal_pe: number | null
          ticker: string
          updated_at: string | null
          years: number | null
        }
        Insert: {
          created_at?: string | null
          eps?: number | null
          eps_growth?: number | null
          id?: string
          min_return?: number | null
          notes?: string | null
          terminal_pe?: number | null
          ticker: string
          updated_at?: string | null
          years?: number | null
        }
        Update: {
          created_at?: string | null
          eps?: number | null
          eps_growth?: number | null
          id?: string
          min_return?: number | null
          notes?: string | null
          terminal_pe?: number | null
          ticker?: string
          updated_at?: string | null
          years?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
