#!/usr/bin/env node
/**
 * Script to generate TypeScript definitions for Supabase Database.
 * Can be run with: npm run types:supabase
 */
const fs = require("fs");
const path = require("path");

const targetFile = path.resolve(__dirname, "../types/supabase.ts");

const typesContent = `export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          wallet_address: string;
          display_name: string;
          created_at: string;
          updated_at: string;
          last_login_at: string;
        };
        Insert: {
          id?: string;
          wallet_address: string;
          display_name: string;
          created_at?: string;
          updated_at?: string;
          last_login_at?: string;
        };
        Update: {
          id?: string;
          wallet_address?: string;
          display_name?: string;
          created_at?: string;
          updated_at?: string;
          last_login_at?: string;
        };
        Relationships: [];
      };
      expenses: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          total_amount: string;
          currency: string;
          split_mode: string;
          paid_by_member_id: string;
          members: Json;
          shares: Json;
          created_at: string;
          updated_at: string;
          settled: boolean;
          version: number;
          created_by_wallet: string;
          member_wallets: string[];
          accepted_wallets: string[];
          declined_wallets: string[];
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          total_amount: string;
          currency?: string;
          split_mode: string;
          paid_by_member_id: string;
          members?: Json;
          shares?: Json;
          created_at?: string;
          updated_at?: string;
          settled?: boolean;
          version?: number;
          created_by_wallet: string;
          member_wallets?: string[];
          accepted_wallets?: string[];
          declined_wallets?: string[];
        };
        Update: {
          id?: string;
          title?: string;
          description?: string | null;
          total_amount?: string;
          currency?: string;
          split_mode?: string;
          paid_by_member_id?: string;
          members?: Json;
          shares?: Json;
          created_at?: string;
          updated_at?: string;
          settled?: boolean;
          version?: number;
          created_by_wallet?: string;
          member_wallets?: string[];
          accepted_wallets?: string[];
          declined_wallets?: string[];
        };
        Relationships: [];
      };
      trips: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          members: Json;
          expense_ids: string[];
          created_at: string;
          updated_at: string;
          settled: boolean;
          created_by_wallet: string;
          member_wallets: string[];
          accepted_wallets: string[];
          declined_wallets: string[];
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          members?: Json;
          expense_ids?: string[];
          created_at?: string;
          updated_at?: string;
          settled?: boolean;
          created_by_wallet: string;
          member_wallets?: string[];
          accepted_wallets?: string[];
          declined_wallets?: string[];
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          members?: Json;
          expense_ids?: string[];
          created_at?: string;
          updated_at?: string;
          settled?: boolean;
          created_by_wallet?: string;
          member_wallets?: string[];
          accepted_wallets?: string[];
          declined_wallets?: string[];
        };
        Relationships: [];
      };
      auth_nonces: {
        Row: {
          nonce: string;
          wallet_address: string;
          issued_at: string;
          expires_at: string;
          consumed_at: string | null;
        };
        Insert: {
          nonce: string;
          wallet_address: string;
          issued_at?: string;
          expires_at: string;
          consumed_at?: string | null;
        };
        Update: {
          nonce?: string;
          wallet_address?: string;
          issued_at?: string;
          expires_at?: string;
          consumed_at?: string | null;
        };
        Relationships: [];
      };
      auth_rate_limits: {
        Row: {
          key: string;
          bucket_start: string;
          count: number;
        };
        Insert: {
          key: string;
          bucket_start: string;
          count?: number;
        };
        Update: {
          key?: string;
          bucket_start?: string;
          count?: number;
        };
        Relationships: [];
      };
      auth_revocations: {
        Row: {
          wallet_address: string;
          revoked_before: string;
          created_at: string;
        };
        Insert: {
          wallet_address: string;
          revoked_before: string;
          created_at?: string;
        };
        Update: {
          wallet_address?: string;
          revoked_before?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      trip_expenses: {
        Row: {
          trip_id: string;
          expense_id: string;
          added_by_wallet: string;
          created_at: string;
        };
        Insert: {
          trip_id: string;
          expense_id: string;
          added_by_wallet: string;
          created_at?: string;
        };
        Update: {
          trip_id?: string;
          expense_id?: string;
          added_by_wallet?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "trip_expenses_trip_id_fkey";
            columns: ["trip_id"];
            isOneToOne: false;
            referencedRelation: "trips";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "trip_expenses_expense_id_fkey";
            columns: ["expense_id"];
            isOneToOne: false;
            referencedRelation: "expenses";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      add_expense_to_trip: {
        Args: {
          p_trip_id: string;
          p_expense_id: string;
        };
        Returns: {
          id: string;
          name: string;
          description: string | null;
          members: Json;
          expense_ids: string[];
          created_at: string;
          updated_at: string;
          settled: boolean;
          created_by_wallet: string;
          member_wallets: string[];
          accepted_wallets: string[];
          declined_wallets: string[];
        }[];
      };
      get_pending_invitations: {
        Args: Record<PropertyKey, never>;
        Returns: {
          entity_type: "expense" | "trip";
          entity_id: string;
          title: string;
          created_by_wallet: string;
          created_at: string;
          total_amount: string;
          caller_share: string;
        }[];
      };
      accept_invitation: {
        Args: {
          p_entity_type: string;
          p_entity_id: string;
        };
        Returns: undefined;
      };
      decline_invitation: {
        Args: {
          p_entity_type: string;
          p_entity_id: string;
        };
        Returns: undefined;
      };
      leave_trip: {
        Args: {
          p_trip_id: string;
        };
        Returns: undefined;
      };
      mark_share_paid: {
        Args: {
          p_expense_id: string;
          p_member_id: string;
          p_tx_hash: string;
        };
        Returns: Database["public"]["Tables"]["expenses"]["Row"][];
      };
      resolve_user_profile: {
        Args: {
          p_wallet_address: string;
        };
        Returns: {
          wallet_address: string;
          display_name: string;
        }[];
      };
      settlex_wallet: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      auth_burn_nonce: {
        Args: {
          p_wallet_address: string;
          p_nonce: string;
        };
        Returns: boolean;
      };
      auth_rate_limit: {
        Args: {
          p_key: string;
          p_max_requests: number;
          p_window_ms: number;
        };
        Returns: {
          allowed: boolean;
          remaining: number;
          retry_after: number;
        }[];
      };
      auth_revoke_session: {
        Args: {
          p_wallet_address: string;
          p_revoked_before: string;
        };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
`;

fs.writeFileSync(targetFile, typesContent, "utf8");
console.log("Supabase TypeScript definitions written to:", targetFile);
