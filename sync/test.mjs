// Test herní logiky na vymyšlených datech ve tvaru NHL API.  node test.mjs
import * as L from "./logic.mjs";
import assert from "node:assert/strict";

const pool = {
  skaters: [
    [1, "Connor McDavid", "EDM", "C", 10, 6, 20], [2, "Leon Draisaitl", "EDM", "C", 10, 8, 8],
    [3, "Auston Matthews", "TOR", "C", 10, 8, 10], [4, "Evan Bouchard", "EDM", "D", 10, 7, 11],
    [5, "Mark Stone", "VGK", "R", 10, 8, 7], [6, "Jack Eichel", "VGK", "C", 10, 5, 13],
    [7, "Quinn Hughes", "MIN", "D", 10, 2, 11], [8, "William Nylander", "TOR", "R", 10, 6, 9],
  ],
  goalies: [[50, "Stuart Skinner", "EDM", 8, 5, 2, 1, 2.5, 0.91, 1], [51, "Joseph Woll", "TOR", 7, 4, 3, 0, 2.9, 0.9, 0], [52, "Adin Hill", "VGK", 5, 3, 1, 0, 2.2, 0.92, 2]],
};
const idx = L.poolIndex(pool);
const st = L.newState({ league: { owners: ["A", "B"] }, rosters: { A: { owner: "A", locked: false, slots: [] }, B: { owner: "B", locked: false, slots: [] } } });
const pick = (k, id) => { const p = idx.get(id); return [k, { id, name: p.name, team: p.team, pos: p.pos }]; };
st.rosterPicks.A = { owner: "A", status: "pending", confirmedAt: "2026-11-01T10:00:00Z", players: Object.fromEntries([pick("F1", 1), pick("F2", 2), pick("F3", 3), pick("D1", 4), pick("G1", 50)]) };
st.rosterPicks.B = { owner: "B", status: "pending", confirmedAt: "2026-11-01T11:00:00Z", players: Object.fromEntries([pick("F1", 1), pick("F2", 5), pick("F3", 8), pick("D1", 7), pick("G1", 51)]) };

L.applyRosterPicks(st, idx, { EDM: 12, TOR: 11 }, "2026-11-01T12:00:00Z");
assert.equal(st.rosters.A.locked, true);
assert.equal(st.rosterPicks.B.status, "rejected", "McDavid už má A");
assert.equal(st.rosters.A.slots[0].games, 12, "počítadlo začíná odehranými zápasy týmu");

// zápas EDM–TOR: McDavid 1G+2A, Bouchard 1G, Skinner čisté konto + asistence, Draisaitl chybí
const box = (lineupAway, lineupHome, goalies) => ({ playerByGameStats: {
  awayTeam: { forwards: lineupAway.map((id) => ({ playerId: id })), defense: [], goalies: goalies.away },
  homeTeam: { forwards: lineupHome.map((id) => ({ playerId: id })), defense: [], goalies: goalies.home } } });
const land = (goals) => ({ summary: { scoring: [{ periodDescriptor: { periodType: "REG" }, goals }, { periodDescriptor: { periodType: "SO" }, goals: [{ playerId: 3, assists: [] }] }] } });
const g1 = { id: 101, date: "2026-11-02", start: "2026-11-03T00:00:00Z", away: "EDM", home: "TOR" };
const b1 = box([1, 4], [3, 8], { away: [{ playerId: 50, toi: "60:00", goalsAgainst: 0 }], home: [{ playerId: 51, toi: "60:00", goalsAgainst: 2 }] });
const l1 = land([{ playerId: 1, assists: [{ playerId: 4 }, { playerId: 50 }] }, { playerId: 4, assists: [{ playerId: 1 }] }]);
L.processGame(st, g1, L.parseGame(b1, l1), "2026-11-03T06:00:00Z");
const m = st.months["2026-11"].owners.A;
assert.equal(m.players[1].pts, 2 + 1, "McDavid: gól 2 + asistence 1");
assert.equal(m.players[4].pts, 3 + 1, "Bouchard obránce: gól 3 + asistence 1");
assert.equal(m.players[50].pts, 5 + 1, "Skinner: nula 5 + asistence 1");
assert.equal(m.pts, 3 + 4 + 6, "Matthews (SO gól) se nepočítá, je to stejně v cizím týmu");
assert.equal(st.rosters.A.slots[1].baseMissed, 1, "Draisaitl vynechal 1 zápas");

// druhý zápas bez Draisaitla -> zranění
const g2 = { id: 102, date: "2026-11-04", start: "2026-11-05T00:00:00Z", away: "VGK", home: "EDM" };
L.processGame(st, g2, L.parseGame(box([5, 6], [1, 4], { away: [{ playerId: 52, toi: "60:00", goalsAgainst: 1 }], home: [{ playerId: 50, toi: "60:00", goalsAgainst: 3 }] }), land([])), "2026-11-05T06:00:00Z");
const inj = st.injuries.find((i) => i.active && i.player.id === 2);
assert.ok(inj && inj.needPick, "Draisaitl je zraněný a čeká se na výběr");

// výběr: B si nesmí vybrat za A, A si vybere Stonea (B ho nemá, B nemá potvrzenou sestavu)
st.picks.push({ id: "p1", injuryId: inj.id, owner: "B", playerId: 5, name: "Mark Stone", status: "pending", createdAt: "2026-11-05T07:00:00Z" });
st.picks.push({ id: "p2", injuryId: inj.id, owner: "A", playerId: 5, name: "Mark Stone", status: "pending", createdAt: "2026-11-05T08:00:00Z" });
L.applyPicks(st, idx, "2026-11-05T09:00:00Z");
assert.equal(st.picks[0].status, "rejected");
assert.equal(st.picks[1].status, "ok");
assert.equal(st.rosters.A.slots[1].sub.name, "Mark Stone");

// Stone boduje za A, Draisaitl se vrací
const g3 = { id: 103, date: "2026-11-06", start: "2026-11-07T00:00:00Z", away: "VGK", home: "TOR" };
L.processGame(st, g3, L.parseGame(box([5], [3], { away: [], home: [] }), land([{ playerId: 5, assists: [] }])), "2026-11-07T06:00:00Z");
assert.equal(st.months["2026-11"].owners.A.players[5].pts, 2, "Stone: gól 2");
const gamesBefore = st.rosters.A.slots[1].games;
const g4 = { id: 104, date: "2026-11-30", start: "2026-12-01T01:00:00Z", away: "EDM", home: "VGK" };
L.processGame(st, g4, L.parseGame(box([1, 2], [5], { away: [], home: [] }), land([{ playerId: 2, assists: [] }, { playerId: 5, assists: [] }])), "2026-12-01T06:00:00Z");
assert.equal(inj.active, false, "Draisaitl se vrátil");
assert.equal(st.rosters.A.slots[1].sub, null, "Stone končí");
assert.equal(st.months["2026-11"].owners.A.players[2].pts, 2, "zápas 30. 11. v Americe (u nás 1. 12.) patří do listopadu");
assert.equal(st.rosters.A.slots[1].games, gamesBefore + 1);

// strop 82 zápasů
st.rosters.A.slots[0].games = 82;
const before = st.months["2026-11"].owners.A.players[1].pts;
L.processGame(st, { id: 105, date: "2026-11-30", start: "2026-12-01T02:00:00Z", away: "EDM", home: "TOR" },
  L.parseGame(box([1], [], { away: [], home: [] }), land([{ playerId: 1, assists: [] }])), "2026-12-01T06:00:00Z");
assert.equal(st.months["2026-11"].owners.A.players[1].pts, before, "po 82 zápasech místo už nesbírá body");

// lhůta 48 h: automatický výběr nejlepšího volného
st.rosters.A.slots[3].baseMissed = 1;
L.processGame(st, { id: 106, date: "2026-12-02", start: "2026-12-03T00:00:00Z", away: "EDM", home: "TOR" },
  L.parseGame(box([1, 2], [3], { away: [], home: [] }), land([])), "2026-12-03T06:00:00Z");
const injD = st.injuries.find((i) => i.active && i.pos === "D");
assert.ok(injD, "Bouchard zraněný");
L.applyDeadlines(st, idx, "2026-12-06T06:00:00Z");
assert.equal(st.rosters.A.slots[3].sub.name, "Quinn Hughes", "automaticky nejlepší volný obránce");

console.log("✓ všechny testy prošly");
console.log(st.feed.map((f) => "  · " + f.txt).join("\n"));
