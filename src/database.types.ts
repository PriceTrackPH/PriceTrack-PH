export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      diagnostic_events: {
        Row: {
          created_at: string
          details: Json
          error_code: string | null
          event_type: string
          failed_count: number | null
          id: number
          product_id: string | null
          recorded_count: number | null
          shop_id: string | null
          source: string
          status_code: number | null
          unchanged_count: number | null
          variation_count: number | null
        }
        Insert: {
          created_at?: string
          details?: Json
          error_code?: string | null
          event_type: string
          failed_count?: number | null
          id?: number
          product_id?: string | null
          recorded_count?: number | null
          shop_id?: string | null
          source?: string
          status_code?: number | null
          unchanged_count?: number | null
          variation_count?: number | null
        }
        Update: {
          created_at?: string
          details?: Json
          error_code?: string | null
          event_type?: string
          failed_count?: number | null
          id?: number
          product_id?: string | null
          recorded_count?: number | null
          shop_id?: string | null
          source?: string
          status_code?: number | null
          unchanged_count?: number | null
          variation_count?: number | null
        }
        Relationships: []
      }
      ingest_rate_limits: {
        Row: {
          client_hash: string
          last_request_at: string
          observed_date: string
          request_count: number
        }
        Insert: {
          client_hash: string
          last_request_at?: string
          observed_date: string
          request_count?: number
        }
        Update: {
          client_hash?: string
          last_request_at?: string
          observed_date?: string
          request_count?: number
        }
        Relationships: []
      }
      price_observations: {
        Row: {
          created_at: string
          discount_percent: number | null
          id: number
          is_in_stock: boolean
          metadata: Json
          observed_at: string
          observed_date: string
          original_price: number | null
          price: number
          source: string
          variation_id: number
        }
        Insert: {
          created_at?: string
          discount_percent?: number | null
          id?: never
          is_in_stock?: boolean
          metadata?: Json
          observed_at?: string
          observed_date: string
          original_price?: number | null
          price: number
          source?: string
          variation_id: number
        }
        Update: {
          created_at?: string
          discount_percent?: number | null
          id?: never
          is_in_stock?: boolean
          metadata?: Json
          observed_at?: string
          observed_date?: string
          original_price?: number | null
          price?: number
          source?: string
          variation_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "price_observations_variation_id_fkey"
            columns: ["variation_id"]
            isOneToOne: false
            referencedRelation: "product_variations"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variations: {
        Row: {
          created_at: string
          external_variation_id: string
          first_seen_at: string
          id: number
          is_active: boolean
          last_seen_at: string
          metadata: Json
          name: string
          product_id: number
          sku: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_variation_id: string
          first_seen_at?: string
          id?: never
          is_active?: boolean
          last_seen_at?: string
          metadata?: Json
          name?: string
          product_id: number
          sku?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_variation_id?: string
          first_seen_at?: string
          id?: never
          is_active?: boolean
          last_seen_at?: string
          metadata?: Json
          name?: string
          product_id?: number
          sku?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          currency: string
          external_product_id: string
          external_shop_id: string
          first_seen_at: string
          id: number
          image_url: string | null
          is_active: boolean
          last_seen_at: string
          metadata: Json
          name: string
          platform: string
          product_url: string
          shop_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          external_product_id: string
          external_shop_id: string
          first_seen_at?: string
          id?: never
          image_url?: string | null
          is_active?: boolean
          last_seen_at?: string
          metadata?: Json
          name: string
          platform: string
          product_url: string
          shop_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          external_product_id?: string
          external_shop_id?: string
          first_seen_at?: string
          id?: never
          image_url?: string | null
          is_active?: boolean
          last_seen_at?: string
          metadata?: Json
          name?: string
          platform?: string
          product_url?: string
          shop_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      delete_expired_diagnostic_events: { Args: never; Returns: number }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
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
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends { Row: infer R }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends { Row: infer R }
      ? R
      : never
    : never
