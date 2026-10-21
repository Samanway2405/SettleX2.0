import { verifyTransactionOnHorizon } from "@/lib/stellar/verifyPayment";
import { POST, GET } from "@/app/api/payment/verify/route";

describe("Horizon Transaction Verification (Issue #188)", () => {
  const VALID_HASH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const INVALID_HASH = "invalid-hash";
  const DEST_WALLET = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe("verifyTransactionOnHorizon", () => {
    it("rejects malformed transaction hashes", async () => {
      const result = await verifyTransactionOnHorizon(INVALID_HASH);
      expect(result.valid).toBe(false);
      expect(result.exists).toBe(false);
      expect(result.flagged).toBe(true);
      expect(result.error).toMatch(/Invalid transaction hash/);
    });

    it("flags and rejects transaction when Horizon returns 404", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      } as Response);

      const result = await verifyTransactionOnHorizon(VALID_HASH);
      expect(result.valid).toBe(false);
      expect(result.exists).toBe(false);
      expect(result.flagged).toBe(true);
      expect(result.error).toMatch(/Transaction not found on Stellar Horizon/);
    });

    it("flags transaction when it failed on-chain", async () => {
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (url.includes("/operations")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ _embedded: { records: [] } }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            successful: false,
            ledger: 1000,
            created_at: "2026-10-17T00:00:00Z",
          }),
        } as Response);
      });

      const result = await verifyTransactionOnHorizon(VALID_HASH);
      expect(result.valid).toBe(false);
      expect(result.exists).toBe(true);
      expect(result.successful).toBe(false);
      expect(result.flagged).toBe(true);
      expect(result.error).toMatch(/Transaction failed on the Stellar ledger/);
    });

    it("verifies successful transaction on Horizon", async () => {
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (url.includes("/operations")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              _embedded: {
                records: [
                  {
                    type: "payment",
                    to: DEST_WALLET,
                    amount: "25.0000000",
                  },
                ],
              },
            }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            successful: true,
            ledger: 54321,
            memo: "SettleX|Trip",
            source_account: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            created_at: "2026-10-17T00:00:00Z",
          }),
        } as Response);
      });

      const result = await verifyTransactionOnHorizon(VALID_HASH, {
        destinationWallet: DEST_WALLET,
      });

      expect(result.valid).toBe(true);
      expect(result.exists).toBe(true);
      expect(result.successful).toBe(true);
      expect(result.flagged).toBe(false);
      expect(result.ledger).toBe(54321);
    });

    it("flags transaction if destination wallet mismatches expected recipient", async () => {
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (url.includes("/operations")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              _embedded: {
                records: [
                  {
                    type: "payment",
                    to: "GOTHERWALLET111111111111111111111111111111111111111111111",
                    amount: "25.0000000",
                  },
                ],
              },
            }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            successful: true,
            ledger: 54321,
          }),
        } as Response);
      });

      const result = await verifyTransactionOnHorizon(VALID_HASH, {
        destinationWallet: DEST_WALLET,
      });

      expect(result.valid).toBe(false);
      expect(result.flagged).toBe(true);
      expect(result.error).toMatch(/Payment destination does not match/);
    });
  });

  describe("API route /api/payment/verify", () => {
    it("returns 400 when POST body is malformed or missing txHash", async () => {
      const req = new Request("http://localhost/api/payment/verify", {
        method: "POST",
        body: JSON.stringify({}),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Transaction hash is required/);
    });

    it("returns 404 when transaction is not found on Horizon via POST", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      } as Response);

      const req = new Request("http://localhost/api/payment/verify", {
        method: "POST",
        body: JSON.stringify({ txHash: VALID_HASH }),
      });

      const res = await POST(req);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.exists).toBe(false);
      expect(json.flagged).toBe(true);
    });

    it("returns 200 when transaction is verified on Horizon via POST", async () => {
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (url.includes("/operations")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ _embedded: { records: [] } }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            successful: true,
            ledger: 99999,
          }),
        } as Response);
      });

      const req = new Request("http://localhost/api/payment/verify", {
        method: "POST",
        body: JSON.stringify({ txHash: VALID_HASH }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.valid).toBe(true);
      expect(json.exists).toBe(true);
      expect(json.flagged).toBe(false);
      expect(json.ledger).toBe(99999);
    });

    it("handles GET verification endpoint", async () => {
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (url.includes("/operations")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ _embedded: { records: [] } }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            successful: true,
            ledger: 88888,
          }),
        } as Response);
      });

      const req = new Request(`http://localhost/api/payment/verify?txHash=${VALID_HASH}`);
      const res = await GET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.valid).toBe(true);
      expect(json.ledger).toBe(88888);
    });
  });
});
