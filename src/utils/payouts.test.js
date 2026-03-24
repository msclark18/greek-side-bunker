import { describe, it, expect } from "vitest";
import { resolveCatMap, resolvePayouts } from "./payouts.js";

// ─────────────────────────────────────────────────────────────
// resolveCatMap
// ─────────────────────────────────────────────────────────────
describe("resolveCatMap", () => {
  it("passes through new-format mapTo/mapRank directly", () => {
    expect(resolveCatMap({ mapTo: "net", mapRank: 2 })).toEqual({ mapTo: "net", mapRank: 2 });
  });

  it("defaults mapRank to 1 when omitted in new format", () => {
    expect(resolveCatMap({ mapTo: "gross" })).toEqual({ mapTo: "gross", mapRank: 1 });
  });

  it("resolves legacy id 'champion' to playoff rank 1", () => {
    expect(resolveCatMap({ id: "champion" })).toEqual({ mapTo: "playoff", mapRank: 1 });
  });

  it("resolves legacy id 'runnerUp' to playoff rank 2", () => {
    expect(resolveCatMap({ id: "runnerUp" })).toEqual({ mapTo: "playoff", mapRank: 2 });
  });

  it("resolves legacy id 'thirdPlace' to playoff rank 3", () => {
    expect(resolveCatMap({ id: "thirdPlace" })).toEqual({ mapTo: "playoff", mapRank: 3 });
  });

  it("resolves legacy id 'regularNet' to net rank 1", () => {
    expect(resolveCatMap({ id: "regularNet" })).toEqual({ mapTo: "net", mapRank: 1 });
  });

  it("resolves legacy id 'regularGross' to gross rank 1", () => {
    expect(resolveCatMap({ id: "regularGross" })).toEqual({ mapTo: "gross", mapRank: 1 });
  });

  it("resolves legacy type string 'net_2'", () => {
    expect(resolveCatMap({ type: "net_2" })).toEqual({ mapTo: "net", mapRank: 2 });
  });

  it("resolves legacy type string 'gross_1'", () => {
    expect(resolveCatMap({ type: "gross_1" })).toEqual({ mapTo: "gross", mapRank: 1 });
  });

  it("resolves legacy type string 'playoff_3'", () => {
    expect(resolveCatMap({ type: "playoff_3" })).toEqual({ mapTo: "playoff", mapRank: 3 });
  });

  it("returns 'none' for unknown category", () => {
    expect(resolveCatMap({ id: "something_custom" })).toEqual({ mapTo: "none", mapRank: 1 });
  });

  it("returns 'none' for explicit type 'none'", () => {
    expect(resolveCatMap({ type: "none" })).toEqual({ mapTo: "none", mapRank: 1 });
  });
});

// ─────────────────────────────────────────────────────────────
// resolvePayouts — helpers
// ─────────────────────────────────────────────────────────────
const netLB   = [{ name: "Alice" }, { name: "Bob" }, { name: "Carol" }];
const grossLB = [{ name: "Bob" }, { name: "Alice" }, { name: "Carol" }];

const netCat   = { id: "net1",   mapTo: "net",   mapRank: 1, pct: 40 };
const grossCat = { id: "gross1", mapTo: "gross", mapRank: 1, pct: 20 };
const net2Cat  = { id: "net2",   mapTo: "net",   mapRank: 2, pct: 15 };

// ─────────────────────────────────────────────────────────────
// Non-exclusive mode
// ─────────────────────────────────────────────────────────────
describe("resolvePayouts — non-exclusive", () => {
  it("assigns net 1st to the leader of the net leaderboard", () => {
    const result = resolvePayouts({ cats: [netCat], netLB, grossLB });
    expect(result.net1).toBe("Alice");
  });

  it("assigns gross 1st to the leader of the gross leaderboard", () => {
    const result = resolvePayouts({ cats: [grossCat], netLB, grossLB });
    expect(result.gross1).toBe("Bob");
  });

  it("allows the same player to win multiple categories", () => {
    // Alice leads net; also show up at net rank 1 for a second category
    const cats = [netCat, { id: "net1b", mapTo: "net", mapRank: 1, pct: 10 }];
    const result = resolvePayouts({ cats, netLB, grossLB });
    expect(result.net1).toBe("Alice");
    expect(result.net1b).toBe("Alice");
  });

  it("resolves rank 2 correctly", () => {
    const result = resolvePayouts({ cats: [net2Cat], netLB, grossLB });
    expect(result.net2).toBe("Bob");
  });

  it("returns null for a rank beyond the leaderboard", () => {
    const cat = { id: "net9", mapTo: "net", mapRank: 9, pct: 5 };
    const result = resolvePayouts({ cats: [cat], netLB, grossLB });
    expect(result.net9).toBeNull();
  });

  it("returns null when leaderboards are empty", () => {
    const result = resolvePayouts({ cats: [netCat, grossCat], netLB: [], grossLB: [] });
    expect(result.net1).toBeNull();
    expect(result.gross1).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Exclusive — net precedence
// ─────────────────────────────────────────────────────────────
describe("resolvePayouts — exclusive, net precedence", () => {
  // netLB: Alice, Bob, Carol  |  grossLB: Bob, Alice, Carol
  // Net precedes. Alice wins net 1st → Alice is blocked from gross.
  // Gross 1st now goes to Bob (skipping Alice).
  it("cascades gross 1st to the next player when net winner is blocked", () => {
    const result = resolvePayouts({
      cats: [netCat, grossCat],
      netLB,
      grossLB,
      exclusive: true,
      precedence: "net",
    });
    expect(result.net1).toBe("Alice");
    expect(result.gross1).toBe("Bob"); // Bob was gross leader; Alice blocked
  });

  it("cascades net 2nd to the next unblocked player", () => {
    // net1 → Alice (blocked). net2 walks [Alice(skip), Bob(rank 1), Carol(rank 2)] → Carol.
    const result = resolvePayouts({
      cats: [netCat, net2Cat],
      netLB,
      grossLB,
      exclusive: true,
      precedence: "net",
    });
    expect(result.net1).toBe("Alice");
    expect(result.net2).toBe("Carol");
  });
});

// ─────────────────────────────────────────────────────────────
// Exclusive — gross precedence
// ─────────────────────────────────────────────────────────────
describe("resolvePayouts — exclusive, gross precedence", () => {
  // grossLB: Bob, Alice, Carol  |  netLB: Alice, Bob, Carol
  // Gross precedes. Bob wins gross 1st → Bob blocked from net.
  // Net 1st goes to Alice (not blocked), net 2nd would go to Carol (Bob blocked).
  it("cascades net 1st past the gross winner when blocked", () => {
    const result = resolvePayouts({
      cats: [netCat, grossCat],
      netLB,
      grossLB,
      exclusive: true,
      precedence: "gross",
    });
    expect(result.gross1).toBe("Bob");
    expect(result.net1).toBe("Alice"); // Alice leads net and isn't blocked
  });

  it("returns null for net 2nd when both top players are already blocked", () => {
    // gross1 → Bob (blocked); net1 → Alice (blocked).
    // net2 walks [Alice(skip), Bob(skip), Carol(rank 1)] — rank 2 never reached → null.
    const cats = [grossCat, netCat, net2Cat];
    const result = resolvePayouts({
      cats,
      netLB,
      grossLB,
      exclusive: true,
      precedence: "gross",
    });
    expect(result.gross1).toBe("Bob");
    expect(result.net1).toBe("Alice");
    expect(result.net2).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Exclusive — highest payout wins conflict
// ─────────────────────────────────────────────────────────────
describe("resolvePayouts — exclusive, highest pct precedence", () => {
  // netLB: Alice first.  grossLB: Alice first.
  // Both Alice. net pays 40%, gross pays 20%.
  // With "highest": net (40%) is assigned first → Alice wins net.
  // Gross (20%) then cascades to Bob.
  const allAliceLB = [{ name: "Alice" }, { name: "Bob" }];

  it("assigns higher-pct category first and cascades lower-pct", () => {
    const result = resolvePayouts({
      cats: [
        { id: "net1",   mapTo: "net",   mapRank: 1, pct: 40 },
        { id: "gross1", mapTo: "gross", mapRank: 1, pct: 20 },
      ],
      netLB: allAliceLB,
      grossLB: allAliceLB,
      exclusive: true,
      precedence: "highest",
    });
    expect(result.net1).toBe("Alice");   // 40% — assigned first
    expect(result.gross1).toBe("Bob");   // Alice already used; cascades to Bob
  });

  it("assigns the lower-pct category first when gross pays more", () => {
    const result = resolvePayouts({
      cats: [
        { id: "net1",   mapTo: "net",   mapRank: 1, pct: 10 },
        { id: "gross1", mapTo: "gross", mapRank: 1, pct: 50 },
      ],
      netLB: allAliceLB,
      grossLB: allAliceLB,
      exclusive: true,
      precedence: "highest",
    });
    expect(result.gross1).toBe("Alice"); // 50% wins conflict
    expect(result.net1).toBe("Bob");
  });
});

// ─────────────────────────────────────────────────────────────
// Playoff categories
// ─────────────────────────────────────────────────────────────
describe("resolvePayouts — playoff categories", () => {
  const playoffResults = { champion: "Alice", runnerUp: "Bob", thirdPlace: "Carol" };

  it("resolves champion to playoff rank 1", () => {
    const cat = { id: "champ", mapTo: "playoff", mapRank: 1, pct: 50 };
    const result = resolvePayouts({ cats: [cat], netLB, grossLB, playoffResults });
    expect(result.champ).toBe("Alice");
  });

  it("resolves runner-up to playoff rank 2", () => {
    const cat = { id: "ru", mapTo: "playoff", mapRank: 2, pct: 25 };
    const result = resolvePayouts({ cats: [cat], netLB, grossLB, playoffResults });
    expect(result.ru).toBe("Bob");
  });

  it("resolves third place to playoff rank 3", () => {
    const cat = { id: "third", mapTo: "playoff", mapRank: 3, pct: 10 };
    const result = resolvePayouts({ cats: [cat], netLB, grossLB, playoffResults });
    expect(result.third).toBe("Carol");
  });

  it("returns null for playoff rank when results not yet set", () => {
    const cat = { id: "champ", mapTo: "playoff", mapRank: 1, pct: 50 };
    const result = resolvePayouts({ cats: [cat], netLB, grossLB, playoffResults: {} });
    expect(result.champ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Manual / side-game categories (mapTo: "none")
// ─────────────────────────────────────────────────────────────
describe("resolvePayouts — manual categories", () => {
  it("returns the stored winner for a none-type category", () => {
    const cat = { id: "closest", mapTo: "none", pct: 10, winner: "Carol" };
    const result = resolvePayouts({ cats: [cat], netLB, grossLB });
    expect(result.closest).toBe("Carol");
  });

  it("returns null when no winner assigned yet", () => {
    const cat = { id: "closest", mapTo: "none", pct: 10 };
    const result = resolvePayouts({ cats: [cat], netLB, grossLB });
    expect(result.closest).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// Legacy category IDs via resolveCatMap
// ─────────────────────────────────────────────────────────────
describe("resolvePayouts — legacy category ids", () => {
  it("resolves 'regularNet' id to net 1st place", () => {
    const cat = { id: "regularNet", pct: 30 };
    const result = resolvePayouts({ cats: [cat], netLB, grossLB });
    expect(result.regularNet).toBe("Alice");
  });

  it("resolves 'regularGross' id to gross 1st place", () => {
    const cat = { id: "regularGross", pct: 20 };
    const result = resolvePayouts({ cats: [cat], netLB, grossLB });
    expect(result.regularGross).toBe("Bob");
  });

  it("resolves 'champion' id to playoff champion", () => {
    const cat = { id: "champion", pct: 50 };
    const result = resolvePayouts({
      cats: [cat], netLB, grossLB,
      playoffResults: { champion: "Alice" },
    });
    expect(result.champion).toBe("Alice");
  });
});
