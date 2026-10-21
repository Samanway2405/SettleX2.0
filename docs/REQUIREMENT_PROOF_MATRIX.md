# Requirement-to-Proof Matrix

Date: 2026-03-29

| Requirement | Status | Proof |
| --- | --- | --- |
| Pool authorization regression | Complete (code) / Pending (testnet redeploy) | `test_member_cannot_self_credit_without_admin_approval` uses only member auth and must panic; a v2 pool deployment still needs a replacement explorer proof |
| Pool deployment | Blocked pending redeploy | Historical pool ID `CB4P4EXLGS56IXVNU3PLJO2BHF5BEEPBBYJAHXEPZDSD2OISQIGO53JA` is v1 and unsafe; it is not accepted as current deployment proof |
| CI/CD running | Complete | `.github/workflows/ci.yml`, `.github/workflows/production-check.yml`, and CI badge in README |
| Mobile responsive | Complete (code-level + validation) | Phase 9 responsive updates across landing/auth/dashboard/expenses/trips/trip detail; lint/build/tests all passing |
| Minimum 8+ meaningful commits | Complete | Local git history count: 44 commits |
| Production-ready advanced contract implementation | In progress | Pool self-crediting is fixed in schema v2; token custody and verified payment settlement remain future work |
| README includes live demo link | Complete | README top links section (`https://settle-x-pi.vercel.app/`) |
| README includes contract addresses + tx hash | Complete | README Smart Contract section with settlement/pool IDs and transaction links |
| README includes pool address | Complete | README Deployed Contracts table |
| README includes CI/CD proof | Complete | CI badge in README and test output screenshot |
| README includes deployment proof screenshot | Complete | `public/deployment.png` referenced in README |
| README includes mobile screenshot | Pending manual capture | Add phone viewport screenshot (e.g. `public/mobile-responsive.png`) and reference in README |

## Automated Verification Summary

- `npm run lint`: pass
- `npm test -- --runInBand`: pass (6 suites, 53 tests)
- `npm run build`: pass
- `cd contract && cargo test`: pass (21 tests)
