/** @jest-environment jsdom */

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { TripCard } from "@/components/trips/TripCard";
import type { Trip } from "@/types/trip";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

jest.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      layout,
      initial,
      animate,
      exit,
      transition,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

const trip: Trip = {
  id: "trip-1",
  name: "Lisbon",
  description: "Weekend away",
  members: [],
  expenseIds: [],
  createdAt: "2026-09-28T00:00:00.000Z",
  createdByWallet: "owner-wallet",
  settled: false,
};

describe("TripCard delete controls", () => {
  it("requires confirmation before deleting an owned trip", () => {
    const onDelete = jest.fn();

    render(
      <TripCard
        trip={trip}
        currentUserPublicKey="owner-wallet"
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText(/Delete “Lisbon”\?/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(onDelete).toHaveBeenCalledWith("trip-1");
  });

  it("does not render delete controls for a non-owner", () => {
    const onDelete = jest.fn();

    render(
      <TripCard
        trip={trip}
        currentUserPublicKey="different-wallet"
        onDelete={onDelete}
      />
    );

    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });
});