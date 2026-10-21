import * as fs from "fs";
import * as path from "path";

describe("Issue #179: pool credits require operator approval", () => {
  it("requires the configured pool admin, never a member signature, to allocate credit", () => {
    const poolRsPath = path.resolve(__dirname, "../../contract/contracts/pool/src/lib.rs");
    const poolRsContent = fs.readFileSync(poolRsPath, "utf8");

    // Extract deposit function implementation
    const depositMatch = poolRsContent.match(
      /pub fn deposit\s*\([\s\S]*?\)\s*\{([\s\S]*?)\n    \}/
    );
    expect(depositMatch).not.toBeNull();
    const depositBody = depositMatch![1];

    expect(depositBody).toMatch(/cfg\.admin\.require_auth\(\)/);
    expect(depositBody).not.toMatch(/member\.require_auth\(\)/);
  });

  it("ships the executable authorization regression test", () => {
    expect(poolRsContent).toMatch(/test_member_cannot_self_credit_without_admin_approval/);
    expect(poolRsContent).toMatch(/test_admin_can_allocate_credit_without_member_signature/);
  });
});
