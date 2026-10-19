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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          record_id: string | null
          table_name: string
          user_id: string | null
          details: Json | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          record_id?: string | null
          table_name: string
          user_id?: string | null
          details?: Json | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          record_id?: string | null
          table_name?: string
          user_id?: string | null
          details?: Json | null
        }
        Relationships: []
      }
      events: {
        Row: {
          client_name: string
          client_phone: string | null
          created_at: string
          event_date: string
          event_type: string
          hotel_id: string | null
          id: string
          name: string
          notes: string | null
          status: Database["public"]["Enums"]["event_status"]
          deleted_at: string | null
          deleted_by: string | null
          client_id: string | null
          start_time: string | null
          end_time: string | null
        }
        Insert: {
          client_name: string
          client_phone?: string | null
          created_at?: string
          event_date: string
          event_type?: string
          hotel_id?: string | null
          id?: string
          name: string
          notes?: string | null
          status?: Database["public"]["Enums"]["event_status"]
          deleted_at?: string | null
          deleted_by?: string | null
          client_id?: string | null
          start_time?: string | null
          end_time?: string | null
        }
        Update: {
          client_name?: string
          client_phone?: string | null
          created_at?: string
          event_date?: string
          event_type?: string
          hotel_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["event_status"]
          deleted_at?: string | null
          deleted_by?: string | null
          client_id?: string | null
          start_time?: string | null
          end_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_hotel_id_fkey"
            columns: ["hotel_id"]
            isOneToOne: false
            referencedRelation: "hotels"
            referencedColumns: ["id"]
          },
        ]
      }
      event_materials: {
        Row: {
          created_at: string
          event_id: string
          id: string
          item_name: string
          quantity: number
          status: string
          deleted_at: string | null
          deleted_by: string | null
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          item_name: string
          quantity?: number
          status?: string
          deleted_at?: string | null
          deleted_by?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          item_name?: string
          quantity?: number
          status?: string
          deleted_at?: string | null
          deleted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_materials_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          description: string | null
          event_id: string | null
          expense_date: string
          id: string
          paid: boolean
          vendor_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          source_table: string | null
          source_id: string | null
        }
        Insert: {
          amount?: number
          category: string
          created_at?: string
          description?: string | null
          event_id?: string | null
          expense_date?: string
          id?: string
          paid?: boolean
          vendor_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          source_table?: string | null
          source_id?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          description?: string | null
          event_id?: string | null
          expense_date?: string
          id?: string
          paid?: boolean
          vendor_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          source_table?: string | null
          source_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      hotels: {
        Row: {
          address: string | null
          contact_person: string | null
          contact_phone: string | null
          created_at: string
          guidelines: string | null
          hall_name: string | null
          id: string
          name: string
          deleted_at: string | null
          deleted_by: string | null
        }
        Insert: {
          address?: string | null
          contact_person?: string | null
          contact_phone?: string | null
          created_at?: string
          guidelines?: string | null
          hall_name?: string | null
          id?: string
          name: string
          deleted_at?: string | null
          deleted_by?: string | null
        }
        Update: {
          address?: string | null
          contact_person?: string | null
          contact_phone?: string | null
          created_at?: string
          guidelines?: string | null
          hall_name?: string | null
          id?: string
          name?: string
          deleted_at?: string | null
          deleted_by?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          address: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          whatsapp: string | null
        }
        Insert: {
          address?: string | null
          email?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          whatsapp?: string | null
        }
        Update: {
          address?: string | null
          email?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
      event_staff: {
        Row: {
          created_at: string
          created_by: string | null
          event_id: string
          id: string
          role: string
          staff_id: string | null
          staff_member_id: string | null
        }
        Insert: {
          event_id: string
          role?: string
          staff_id?: string | null
          staff_member_id?: string | null
        }
        Update: {
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_staff_staff_member_id_fkey"
            columns: ["staff_member_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_staff_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_staff_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      event_financials: {
        Row: {
          event_id: string
          estimated_cost: number
          package_price: number
          updated_at: string
        }
        Insert: {
          event_id: string
          estimated_cost?: number
          package_price?: number
          updated_at?: string
        }
        Update: {
          event_id?: string
          estimated_cost?: number
          package_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_financials_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          description: string
          id: string
          invoice_id: string
          quantity: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description: string
          id?: string
          invoice_id: string
          quantity?: number
          unit_price: number
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string
          id?: string
          invoice_id?: string
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          amount_paid: number
          client_name: string
          created_at: string
          due_date: string | null
          event_id: string | null
          id: string
          invoice_no: string
          kind: string
          status: Database["public"]["Enums"]["invoice_status"]
          deleted_at: string | null
          deleted_by: string | null
          voided_at: string | null
          voided_by: string | null
          client_id: string | null
        }
        Insert: {
          amount?: number
          amount_paid?: number
          client_name: string
          created_at?: string
          due_date?: string | null
          event_id?: string | null
          id?: string
          invoice_no: string
          kind?: string
          status?: Database["public"]["Enums"]["invoice_status"]
          deleted_at?: string | null
          deleted_by?: string | null
          voided_at?: string | null
          voided_by?: string | null
          client_id?: string | null
        }
        Update: {
          amount?: number
          amount_paid?: number
          client_name?: string
          created_at?: string
          due_date?: string | null
          event_id?: string | null
          id?: string
          invoice_no?: string
          kind?: string
          status?: Database["public"]["Enums"]["invoice_status"]
          deleted_at?: string | null
          deleted_by?: string | null
          voided_at?: string | null
          voided_by?: string | null
          client_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string
          method: string
          note: string | null
          paid_at: string
          reference_no: string | null
          void_by: string | null
          void_reason: string | null
          voided_at: string | null
        }
        Insert: {
          amount: number
          invoice_id: string
          method: string
          note?: string | null
          paid_at?: string
          reference_no?: string | null
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          disabled_at: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string
          id: string
          disabled_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          disabled_at?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      staff: {
        Row: {
          active: boolean
          cnic: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          job_title: string
          joining_date: string | null
          name: string
          notes: string | null
          phone: string | null
          rate: number
          salary_type: string
        }
        Insert: {
          active?: boolean
          cnic?: string | null
          job_title?: string
          joining_date?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          rate?: number
          salary_type?: string
        }
        Update: {
          active?: boolean
          cnic?: string | null
          job_title?: string
          joining_date?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          rate?: number
          salary_type?: string
        }
        Relationships: []
      }
      attendance: {
        Row: {
          created_at: string
          created_by: string | null
          event_id: string | null
          id: string
          note: string | null
          staff_id: string
          status: string
          updated_at: string
          work_date: string
        }
        Insert: {
          event_id?: string | null
          note?: string | null
          staff_id: string
          status: string
          work_date: string
        }
        Update: {
          event_id?: string | null
          note?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_advances: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          given_on: string
          id: string
          note: string | null
          staff_id: string
        }
        Insert: {
          amount: number
          given_on?: string
          note?: string | null
          staff_id: string
        }
        Update: {
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_advances_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      salary_payments: {
        Row: {
          advance_deducted: number
          amount: number
          bonus: number
          calc: Json
          created_at: string
          created_by: string | null
          expense_id: string | null
          gross: number
          id: string
          method: string
          note: string | null
          paid_on: string
          period_month: string
          reference_no: string | null
          staff_id: string
          void_by: string | null
          void_reason: string | null
          voided_at: string | null
        }
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: "salary_payments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          method: string
          notes: string | null
          payment_date: string
          vendor_id: string
          deleted_at: string | null
          deleted_by: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          method?: string
          notes?: string | null
          payment_date?: string
          vendor_id: string
          deleted_at?: string | null
          deleted_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          method?: string
          notes?: string | null
          payment_date?: string
          vendor_id?: string
          deleted_at?: string | null
          deleted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_payments_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          category: string | null
          created_at: string
          id: string
          name: string
          phone: string | null
          deleted_at: string | null
          deleted_by: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          name: string
          phone?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      event_pnl: {
        Args: { _from: string; _to: string }
        Returns: {
          event_id: string
          event_name: string
          event_date: string
          client_name: string
          hotel_name: string | null
          invoiced: number
          received: number
          expenses: number
        }[]
      }
      event_pnl_one: {
        Args: { _event_id: string }
        Returns: { invoiced: number; received: number; expenses: number }[]
      }
      general_expenses_total: { Args: { _from: string; _to: string }; Returns: number }
      staff_salary_calc: { Args: { _staff_id: string; _month: string; _bonus?: number }; Returns: Json }
      record_salary_payment: {
        Args: {
          _staff_id: string
          _month: string
          _bonus: number
          _expected_net: number
          _method: string
          _reference_no: string | null
          _paid_on: string
          _note: string | null
        }
        Returns: string
      }
      void_salary_payment: { Args: { _id: string; _reason: string }; Returns: undefined }
      soft_delete: { Args: { _id: string; _table: string }; Returns: undefined }
      void_invoice: { Args: { _id: string }; Returns: undefined }
      void_payment: { Args: { _id: string; _reason: string }; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "accountant"
      event_status: "upcoming" | "in_progress" | "completed" | "paid" | "cancelled"
      invoice_status: "unpaid" | "partial" | "paid" | "overdue"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "accountant"],
      event_status: ["upcoming", "in_progress", "completed", "paid", "cancelled"],
      invoice_status: ["unpaid", "partial", "paid", "overdue"],
    },
  },
} as const
