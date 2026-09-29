/** @jest-environment jsdom */

import React from "react";
import * as fs from "fs";
import * as path from "path";
import { render, screen } from "@testing-library/react";
import { PaymentRow } from "@/components/expenses/PaymentRow";
import { ReceiptModal } from "@/components/expenses/ReceiptModal";
import type { SplitShare } from "@/types/expense";

describe("Issue #130: mark_share_paid audit record (paidBy and markedAt)", () => {
  const CREATOR_WALLET = "GCREATORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const MEMBER_WALLET = "GMEMBERBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

  describe("SQL mark_share_paid RPC definition", () => {
    it("ensures mark_share_paid records both paidBy and markedAt in supabase-setup.sql", () => {
      const sqlPath = path.resolve(__dirname, "../../supabase-setup.sql");
      const sqlContent = fs.readFileSync(sqlPath, "utf8");

      // Extract mark_share_paid body
      const match = sqlContent.match(
        /CREATE OR REPLACE FUNCTION public\.mark_share_paid[\s\S]*?\$\$([\s\S]*?)\$\$;/i
      );
      expect(match).not.toBeNull();
      const body = match![1];

      // Must set paidBy to v_caller_wallet
      expect(body).toMatch(/'\{paidBy\}'/i);
      expect(body).toMatch(/v_caller_wallet/i);

      // Must set markedAt
      expect(body).toMatch(/'\{markedAt\}'/i);
      expect(body).toMatch(/now\(\)/i);
    });
  });

  describe("PaymentRow UI rendering", () => {
    it("renders 'marked paid by <wallet>' when paidBy ≠ share owner", () => {
      const share: SplitShare = {
        memberId: "m1",
        name: "Bob",
        walletAddress: MEMBER_WALLET,
        amount: "25.0000000",
        paid: true,
        txHash: "mock-tx-hash",
        paidBy: CREATOR_WALLET,
        markedAt: "2026-09-29T12:00:00Z",
      };

      render(
        <PaymentRow
          share={share}
          index={0}
          expenseTitle="Dinner"
          connectedWalletAddress={MEMBER_WALLET}
        />
      );

      // Should render "marked paid by"
      expect(screen.getByText(/marked paid by/i)).toBeDefined();
      // Should show truncated or formatted creator wallet
      expect(screen.getAllByTitle(new RegExp(CREATOR_WALLET, "i")).length).toBeGreaterThan(0);
    });

    it("does NOT render 'marked paid by' when paidBy equals the share owner (self-payment)", () => {
      const share: SplitShare = {
        memberId: "m1",
        name: "Bob",
        walletAddress: MEMBER_WALLET,
        amount: "25.0000000",
        paid: true,
        txHash: "mock-tx-hash",
        paidBy: MEMBER_WALLET,
        markedAt: "2026-09-29T12:00:00Z",
      };

      render(
        <PaymentRow
          share={share}
          index={0}
          expenseTitle="Dinner"
          connectedWalletAddress={MEMBER_WALLET}
        />
      );

      expect(screen.queryByText(/marked paid by/i)).toBeNull();
    });

    it("does NOT render 'marked paid by' when share is unpaid", () => {
      const share: SplitShare = {
        memberId: "m1",
        name: "Bob",
        walletAddress: MEMBER_WALLET,
        amount: "25.0000000",
        paid: false,
      };

      render(
        <PaymentRow
          share={share}
          index={0}
          expenseTitle="Dinner"
          connectedWalletAddress={MEMBER_WALLET}
        />
      );

      expect(screen.queryByText(/marked paid by/i)).toBeNull();
    });
  });

  describe("ReceiptModal UI rendering", () => {
    it("renders Marked Paid By and Marked At when provided", () => {
      render(
        <ReceiptModal
          open={true}
          onClose={() => {}}
          txHash="0123456789abcdef"
          memo="SettleX|Test"
          amount="50.0000000"
          recipientName="Alice"
          paidBy={CREATOR_WALLET}
          markedAt="2026-09-29T12:00:00Z"
        />
      );

      expect(screen.getByText("Marked Paid By")).toBeDefined();
      expect(screen.getByTitle(CREATOR_WALLET)).toBeDefined();
      expect(screen.getByText("Marked At")).toBeDefined();
    });
  });
});
