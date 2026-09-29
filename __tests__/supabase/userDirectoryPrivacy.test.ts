describe("User Directory Privacy & Scoping (Issue #49)", () => {
  const aliceWallet = "GALICE_WALLET_ADDRESS_1111111111111111111111111111111111";
  const bobWallet = "GBOB_WALLET_ADDRESS_222222222222222222222222222222222222";
  const strangerWallet = "GSTRANGER_WALLET_ADDRESS_3333333333333333333333333333333";
  const attackerWallet = "GATTACKER_FRESH_KEYPAIR_4444444444444444444444444444444";

  const allUsers = [
    { wallet_address: aliceWallet, display_name: "Alice", created_at: "2026-08-01" },
    { wallet_address: bobWallet, display_name: "Bob", created_at: "2026-08-02" },
    { wallet_address: strangerWallet, display_name: "Stranger", created_at: "2026-08-03" },
  ];

  const expenses = [
    {
      id: "exp-1",
      created_by_wallet: aliceWallet,
      member_wallets: [aliceWallet, bobWallet],
      accepted_wallets: [aliceWallet, bobWallet],
      shares: [
        { walletAddress: aliceWallet, amount: "10" },
        { walletAddress: bobWallet, amount: "10" },
      ],
    },
  ];

  const trips = [
    {
      id: "trip-1",
      created_by_wallet: aliceWallet,
      member_wallets: [aliceWallet, bobWallet],
      accepted_wallets: [aliceWallet, bobWallet],
    },
  ];

  /**
   * Evaluator mirroring PostgreSQL RLS policy on users:
   * "Users can view their own profile or counterparties"
   */
  function canViewUserRow(targetUserWallet: string, callerWallet: string): boolean {
    if (!callerWallet) return false;

    // 1. Own profile
    if (targetUserWallet === callerWallet) return true;

    // 2. Shared expense
    const sharesExpense = expenses.some((e) => {
      const callerInExpense =
        e.member_wallets.includes(callerWallet) &&
        e.accepted_wallets.includes(callerWallet);
      const targetInExpense =
        e.member_wallets.includes(targetUserWallet) &&
        e.accepted_wallets.includes(targetUserWallet);
      return callerInExpense && targetInExpense;
    });
    if (sharesExpense) return true;

    // 3. Shared trip
    const sharesTrip = trips.some(
      (t) =>
        t.member_wallets.includes(callerWallet) &&
        t.accepted_wallets.includes(callerWallet) &&
        t.member_wallets.includes(targetUserWallet) &&
        t.accepted_wallets.includes(targetUserWallet)
    );
    if (sharesTrip) return true;

    return false;
  }

  it("allows a user to view their own profile", () => {
    expect(canViewUserRow(aliceWallet, aliceWallet)).toBe(true);
  });

  it("allows a user to view counterparty profiles sharing an expense or trip", () => {
    expect(canViewUserRow(bobWallet, aliceWallet)).toBe(true);
    expect(canViewUserRow(aliceWallet, bobWallet)).toBe(true);
  });

  it("prevents an attacker or stranger from viewing unlinked user profiles (directory scraping blocked)", () => {
    expect(canViewUserRow(aliceWallet, attackerWallet)).toBe(false);
    expect(canViewUserRow(bobWallet, attackerWallet)).toBe(false);
    expect(canViewUserRow(strangerWallet, attackerWallet)).toBe(false);
    expect(canViewUserRow(strangerWallet, aliceWallet)).toBe(false);
  });

  it("does not treat a pending invitee as a counterparty", () => {
    expenses[0].accepted_wallets = [aliceWallet];
    trips[0].accepted_wallets = [aliceWallet];

    expect(canViewUserRow(aliceWallet, bobWallet)).toBe(false);
    expect(canViewUserRow(bobWallet, aliceWallet)).toBe(false);

    expenses[0].accepted_wallets = [aliceWallet, bobWallet];
    trips[0].accepted_wallets = [aliceWallet, bobWallet];
  });

  it("filters directory queries to only return permitted counterparties", () => {
    const visibleToAlice = allUsers.filter((u) => canViewUserRow(u.wallet_address, aliceWallet));
    expect(visibleToAlice.map((u) => u.display_name)).toEqual(["Alice", "Bob"]);

    const visibleToAttacker = allUsers.filter((u) => canViewUserRow(u.wallet_address, attackerWallet));
    expect(visibleToAttacker).toEqual([]);
  });
});
