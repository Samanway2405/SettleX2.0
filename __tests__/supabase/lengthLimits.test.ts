import * as fs from "fs";
import * as path from "path";

describe("Database length and size limits (Issue #191)", () => {
  const setupSql = fs.readFileSync(
    path.resolve(__dirname, "../../supabase-setup.sql"),
    "utf8"
  );

  it("enforces title length constraint on expenses table", () => {
    expect(setupSql).toMatch(/char_length\(title\) BETWEEN 1 AND 120/i);
  });

  it("enforces name length constraint on trips table", () => {
    expect(setupSql).toMatch(/char_length\(name\) BETWEEN 1 AND 120/i);
  });

  it("enforces display_name length constraint on users table", () => {
    expect(setupSql).toMatch(/char_length\(display_name\) BETWEEN 1 AND 50/i);
  });

  it("enforces description length constraint on expenses and trips", () => {
    expect(setupSql).toMatch(/description IS NULL OR char_length\(description\) <= 100/i);
  });

  it("enforces member list size limit (<= 50) on expenses and trips", () => {
    expect(setupSql).toMatch(/jsonb_array_length\(members\) <= 50/i);
  });

  it("enforces shares list size limit (<= 50) on expenses", () => {
    expect(setupSql).toMatch(/jsonb_array_length\(shares\) <= 50/i);
  });

  it("enforces member count <= 50 in trigger functions", () => {
    expect(setupSql).toMatch(/An expense supports at most 50 members/i);
    expect(setupSql).toMatch(/A trip supports at most 50 members/i);
  });

  it("enforces member name length limit in trigger functions", () => {
    expect(setupSql).toMatch(/char_length\(m->>'name'\) > 50/i);
  });
});
