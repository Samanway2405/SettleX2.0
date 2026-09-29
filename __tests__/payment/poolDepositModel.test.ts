import * as fs from "fs";
import * as path from "path";

describe("Issue #131: Pool deposits & pure ledger write recording model", () => {
  it("verifies contract/src/pool.rs deposit requires member authorization rather than admin authorization", () => {
    const poolRsPath = path.resolve(__dirname, "../../contract/src/pool.rs");
    const poolRsContent = fs.readFileSync(poolRsPath, "utf8");

    // Extract deposit function implementation
    const depositMatch = poolRsContent.match(
      /pub fn deposit\s*\([\s\S]*?\)\s*\{([\s\S]*?)\n    \}/
    );
    expect(depositMatch).not.toBeNull();
    const depositBody = depositMatch![1];

    // Must NOT require admin auth
    expect(depositBody).not.toMatch(/cfg\.admin\.require_auth\(\)/);
    expect(depositBody).not.toMatch(/admin\.require_auth\(\)/);

    // Must require member auth for self-service deposit
    expect(depositBody).toMatch(/member\.require_auth\(\)/);
  });

  it("verifies hooks/usePayment.ts directly records on-chain without pool precheck gating", () => {
    const usePaymentPath = path.resolve(__dirname, "../../hooks/usePayment.ts");
    const usePaymentContent = fs.readFileSync(usePaymentPath, "utf8");

    // precheckPoolBalance must not be used to gate payShare or retryOnChainRecord
    expect(usePaymentContent).not.toMatch(/await precheckPoolBalance/);
    expect(usePaymentContent).not.toMatch(/precheckPoolBalance\(/);
  });

  it("verifies lib/stellar/contract.ts defines pure ledger write model", () => {
    const contractTsPath = path.resolve(__dirname, "../../lib/stellar/contract.ts");
    const contractTsContent = fs.readFileSync(contractTsPath, "utf8");

    // precheckPoolBalance should always succeed under the pure ledger write model
    expect(contractTsContent).toMatch(/Pure ledger write model/i);
  });
});
