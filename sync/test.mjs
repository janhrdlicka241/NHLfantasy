// Test herní logiky (říjnová pravidla; listopadová banka je dole) na vymyšlených datech ve tvaru NHL API.  node test.mjs
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
st.rosterPicks.A = { owner: "A", status: "pending", confirmedAt: "2026-10-01T10:00:00Z", players: Object.fromEntries([pick("F1", 1), pick("F2", 2), pick("F3", 3), pick("D1", 4), pick("G1", 50)]) };
st.rosterPicks.B = { owner: "B", status: "pending", confirmedAt: "2026-10-01T11:00:00Z", players: Object.fromEntries([pick("F1", 1), pick("F2", 5), pick("F3", 8), pick("D1", 7), pick("G1", 51)]) };

L.applyRosterPicks(st, idx, { EDM: 12, TOR: 11 }, "2026-10-01T12:00:00Z");
assert.equal(st.rosters.A.locked, true);
assert.equal(st.rosterPicks.B.status, "rejected", "McDavid už má A");
assert.equal(st.rosters.A.slots[0].games, 12, "počítadlo začíná odehranými zápasy týmu");

// zápas EDM–TOR: McDavid 1G+2A, Bouchard 1G, Skinner čisté konto + asistence, Draisaitl chybí
const box = (lineupAway, lineupHome, goalies) => ({ playerByGameStats: {
  awayTeam: { forwards: lineupAway.map((id) => ({ playerId: id })), defense: [], goalies: goalies.away },
  homeTeam: { forwards: lineupHome.map((id) => ({ playerId: id })), defense: [], goalies: goalies.home } } });
const land = (goals) => ({ summary: { scoring: [{ periodDescriptor: { periodType: "REG" }, goals }, { periodDescriptor: { periodType: "SO" }, goals: [{ playerId: 3, assists: [] }] }] } });
const g1 = { id: 101, date: "2026-10-02", start: "2026-10-03T00:00:00Z", away: "EDM", home: "TOR" };
const b1 = box([1, 4], [3, 8], { away: [{ playerId: 50, toi: "60:00", goalsAgainst: 0 }], home: [{ playerId: 51, toi: "60:00", goalsAgainst: 2 }] });
const l1 = land([{ playerId: 1, assists: [{ playerId: 4 }, { playerId: 50 }] }, { playerId: 4, assists: [{ playerId: 1 }] }]);
L.processGame(st, g1, L.parseGame(b1, l1), "2026-10-03T06:00:00Z");
const m = st.months["2026-10"].owners.A;
assert.equal(m.players[1].pts, 2 + 1, "McDavid: gól 2 + asistence 1");
assert.equal(m.players[4].pts, 3 + 1, "Bouchard obránce: gól 3 + asistence 1");
assert.equal(m.players[50].pts, 5 + 1, "Skinner: nula 5 + asistence 1");
assert.equal(m.pts, 3 + 4 + 6, "Matthews (SO gól) se nepočítá, je to stejně v cizím týmu");
assert.equal(st.rosters.A.slots[1].baseMissed, 1, "Draisaitl vynechal 1 zápas");

// druhý zápas bez Draisaitla -> zranění
const g2 = { id: 102, date: "2026-10-04", start: "2026-10-05T00:00:00Z", away: "VGK", home: "EDM" };
L.processGame(st, g2, L.parseGame(box([5, 6], [1, 4], { away: [{ playerId: 52, toi: "60:00", goalsAgainst: 1 }], home: [{ playerId: 50, toi: "60:00", goalsAgainst: 3 }] }), land([])), "2026-10-05T06:00:00Z");
const inj = st.injuries.find((i) => i.active && i.player.id === 2);
assert.ok(inj && inj.needPick, "Draisaitl je zraněný a čeká se na výběr");

// výběr: B si nesmí vybrat za A, A si vybere Stonea (B ho nemá, B nemá potvrzenou sestavu)
st.picks.push({ id: "p1", injuryId: inj.id, owner: "B", playerId: 5, name: "Mark Stone", status: "pending", createdAt: "2026-10-05T07:00:00Z" });
st.picks.push({ id: "p2", injuryId: inj.id, owner: "A", playerId: 5, name: "Mark Stone", status: "pending", createdAt: "2026-10-05T08:00:00Z" });
L.applyPicks(st, idx, "2026-10-05T09:00:00Z");
assert.equal(st.picks[0].status, "rejected");
assert.equal(st.picks[1].status, "ok");
assert.equal(st.rosters.A.slots[1].sub.name, "Mark Stone");

// Stone boduje za A, Draisaitl se vrací
const g3 = { id: 103, date: "2026-10-06", start: "2026-10-07T00:00:00Z", away: "VGK", home: "TOR" };
L.processGame(st, g3, L.parseGame(box([5], [3], { away: [], home: [] }), land([{ playerId: 5, assists: [] }])), "2026-10-07T06:00:00Z");
assert.equal(st.months["2026-10"].owners.A.players[5].pts, 2, "Stone: gól 2");
const gamesBefore = st.rosters.A.slots[1].games;
const g4 = { id: 104, date: "2026-10-31", start: "2026-11-01T01:00:00Z", away: "EDM", home: "VGK" };
L.processGame(st, g4, L.parseGame(box([1, 2], [5], { away: [], home: [] }), land([{ playerId: 2, assists: [] }, { playerId: 5, assists: [] }])), "2026-10-01T06:00:00Z");
assert.equal(inj.active, false, "Draisaitl se vrátil");
assert.equal(st.rosters.A.slots[1].sub, null, "Stone končí");
assert.equal(st.months["2026-10"].owners.A.players[2].pts, 2, "zápas 31. 10. v Americe (u nás 1. 11.) patří do října");
assert.equal(st.rosters.A.slots[1].games, gamesBefore + 1);

// strop 82 zápasů
st.rosters.A.slots[0].games = 84;
const before = st.months["2026-10"].owners.A.players[1].pts;
L.processGame(st, { id: 105, date: "2026-10-31", start: "2026-11-01T02:00:00Z", away: "EDM", home: "TOR" },
  L.parseGame(box([1], [], { away: [], home: [] }), land([{ playerId: 1, assists: [] }])), "2026-10-01T06:00:00Z");
assert.equal(st.months["2026-10"].owners.A.players[1].pts, before, "po 84 zápasech místo už nesbírá body");

// lhůta 48 h: automatický výběr nejlepšího volného
st.rosters.A.slots[3].baseMissed = 1;
L.processGame(st, { id: 106, date: "2026-10-28", start: "2026-10-29T00:00:00Z", away: "EDM", home: "TOR" },
  L.parseGame(box([1, 2], [3], { away: [], home: [] }), land([])), "2026-10-29T06:00:00Z");
const injD = st.injuries.find((i) => i.active && i.pos === "D");
assert.ok(injD, "Bouchard zraněný");
L.applyDeadlines(st, idx, "2026-11-01T06:00:00Z");
assert.equal(st.rosters.A.slots[3].sub.name, "Quinn Hughes", "automaticky nejlepší volný obránce");

console.log("✓ všechny testy prošly");
console.log(st.feed.map((f) => "  · " + f.txt).join("\n"));

// ruční úpravy: body do měsíce (idempotentně) + ruční náhradník
const st2 = L.newState({ league: {}, rosters: { M: { owner: "M", locked: true, slots: [{ key: "F1", pos: "F", base: { id: 2, name: "Leon Draisaitl", team: "EDM" }, sub: null, games: 5, activeFrom: "2026-09-01T00:00:00Z", baseMissed: 0, subMissed: 0 }] } } });
const man = { points: [{ month: "2026-10", owner: "M", name: "Eichel", pos: "F", g: 5, a: 9 }], subs: [{ owner: "M", replaces: "Draisaitl", sub: "Stone" }] };
L.applyManual(st2, man, idx, "2026-10-25T16:00:00Z"); L.applyManual(st2, man, idx, "2026-10-25T17:00:00Z");
assert.equal(st2.months["2026-10"].owners.M.pts, 19, "Eichel 5+9 = 19 b., jen jednou");
assert.equal(st2.rosters.M.slots[0].sub.name, "Mark Stone");
L.processGame(st2, { id: 1, date: "2026-10-24", start: "2026-10-24T23:00:00Z", away: "EDM", home: "VGK" }, L.parseGame(box([2], [5], { away: [], home: [] }), land([{ playerId: 2, assists: [] }])), "x");
assert.ok(st2.injuries[0].active, "starší zápas základního hráče ruční náhradu neruší");
L.processGame(st2, { id: 2, date: "2026-10-26", start: "2026-10-27T00:00:00Z", away: "VGK", home: "TOR" }, L.parseGame(box([5], [], { away: [], home: [] }), land([{ playerId: 5, assists: [] }])), "y");
assert.equal(st2.months["2026-10"].owners.M.players[5].pts, 2, "Stone boduje po nasazení");
console.log("✓ ruční úpravy");

assert.equal(L.monthKey("2026-09-30"), "2026-10", "zápas 30. 9. patří do října");
assert.equal(L.monthKey("2026-11-30"), "2026-11");
const st3 = L.newState({ rosters: { X: { owner: "X", locked: true, lockedAt: "2026-10-25T10:00:00Z", retroDone: true, slots: [{ key: "F1", pos: "F", base: { id: 1 }, games: 9 }] } } });
assert.equal(L.prepareRetro(st3, { version: "v2", fromIso: "2026-09-01T00:00:00Z", untilIso: "2026-11-01T04:00:00Z", month: "2026-10" }).size, 1, "stará verze přepočtu se zopakuje");
console.log("✓ začátek sezóny v září");

// banka zápasů (listopad): Barkov vynechá 4, Eichel odehraje 4
{
  const b = (ids) => L.parseGame({ playerByGameStats: { awayTeam: { forwards: ids.map((id) => ({ playerId: id })), defense: [], goalies: [] }, homeTeam: { forwards: [], defense: [], goalies: [] } } }, land([]));
  const s4 = L.newState({ rosters: { M: { owner: "M", locked: true, slots: [{ key: "F1", pos: "F", base: { id: 10, name: "Barkov", team: "FLA" }, sub: null, games: 10, activeFrom: "2026-09-01T00:00:00Z", baseMissed: 0, subMissed: 0 }] } } });
  const sl = s4.rosters.M.slots[0];
  const day = (d) => `2026-11-${String(d).padStart(2, "0")}`;
  const gm = (d, team) => ({ id: d * 10 + team.length, date: day(d), start: `${day(d)}T23:00:00Z`, away: team, home: "XXX" });
  L.processGame(s4, gm(1, "FLA"), b([]), "2026-11-02T06:00:00Z");
  const inj = s4.injuries.find((i) => i.active);
  assert.ok(inj?.needPick && sl.bank === 1, "po 1 vynechaném zápase výzva k výběru");
  s4.picks.push({ id: "p", injuryId: inj.id, owner: "M", playerId: 6, name: "Jack Eichel", status: "pending", createdAt: "2026-11-02T07:00:00Z" });
  L.applyPicks(s4, idx, "2026-11-02T08:00:00Z");
  for (const d of [3, 5, 7]) L.processGame(s4, gm(d, "FLA"), b([]), "x");      // Barkov chybí další 3 → banka 4
  for (const d of [4, 6, 8]) L.processGame(s4, gm(d, "VGK"), b([6]), "x");     // Eichel odehraje 3
  assert.equal(sl.bank, 1);
  L.processGame(s4, gm(9, "FLA"), b([10]), "x");                                // Barkov zpět
  assert.ok(inj.active && sl.sub, "Eichel ještě dohraje 1 zápas");
  L.processGame(s4, gm(10, "VGK"), b([6]), "x");
  assert.ok(!inj.active && !sl.sub && sl.bank === 0, "Eichel po 4 zápasech končí");
  assert.equal(sl.games, 10 + 1 + 4, "místo: Barkov 1 + Eichel 4 zápasy");
  assert.equal(s4.months["2026-11"].owners.M.players[6].gp, 4);
  // brankář na soupisce, ale nechytal = odehraný zápas, žádná výzva
  const s5 = L.newState({ rosters: { G: { owner: "G", locked: true, slots: [{ key: "G1", pos: "G", base: { id: 50, name: "Skinner", team: "EDM" }, sub: null, games: 0, activeFrom: "2026-09-01T00:00:00Z", baseMissed: 0, subMissed: 0 }] } } });
  L.processGame(s5, gm(2, "EDM"), L.parseGame({ playerByGameStats: { awayTeam: { forwards: [], defense: [], goalies: [{ playerId: 50, toi: "00:00", goalsAgainst: 0 }] }, homeTeam: {} } }, land([])), "x");
  assert.equal(s5.injuries.length, 0, "dvojka chytala – brankář není zraněný");
  console.log("✓ banka zápasů");
}

// ruční náhradník "auto": nasadí se za hráče, který teď nehraje
{
  const s6 = L.newState({ meta: {}, rosters: { D: { owner: "D", locked: true, slots: [
    { key: "F1", pos: "F", base: { id: 2, name: "Leon Draisaitl", team: "EDM" }, sub: null, games: 5, activeFrom: "x", baseMissed: 0 },
    { key: "F2", pos: "F", base: { id: 3, name: "Auston Matthews", team: "TOR" }, sub: null, games: 5, activeFrom: "x", baseMissed: 3 }] } } });
  L.applyManual(s6, { subs: [{ owner: "D", replaces: "auto", sub: "Stone", pos: "F" }, { owner: "D", replaces: "auto", sub: "Hughes", pos: "D" }] }, idx, "2026-10-26T12:00:00Z");
  assert.equal(s6.rosters.D.slots[1].sub?.name, "Mark Stone", "Stone za Matthewse, který nehraje");
    assert.equal(s6.rosters.D.slots[0].sub, null);
  console.log("✓ ruční náhradník za hráče, který nehraje");
}

// přechod říjen → listopad: banka začíná na nule
{
  const b = (ids) => L.parseGame({ playerByGameStats: { awayTeam: { forwards: ids.map((id) => ({ playerId: id })), defense: [], goalies: [] }, homeTeam: {} } }, land([]));
  const s7 = L.newState({ meta: {}, rosters: { M: { owner: "M", locked: true, slots: [{ key: "F1", pos: "F", base: { id: 10, name: "Barkov", team: "FLA" }, sub: null, games: 12, activeFrom: "2026-09-01T00:00:00Z", baseMissed: 12, bank: 12, subMissed: 0 }] } } });
  L.applyManual(s7, { subs: [{ owner: "M", replaces: "Barkov", sub: "Eichel", pos: "F" }] }, idx, "2026-10-26T12:00:00Z");
  L.processGame(s7, { id: 1, date: "2026-11-02", start: "2026-11-02T23:00:00Z", away: "FLA", home: "X" }, b([10]), "z"); // Barkov se 2. 11. vrátí
  assert.ok(!s7.injuries[0].active && !s7.rosters.M.slots[0].sub, "Eichel končí hned – z října nic nedohrává");
  console.log("✓ banka od listopadu na nule");
}

// Barkov vynechal 8, Eichel za něj v říjnu odehrál 5 → v bance 3, pokračuje přes konec měsíce
{
  const b = (ids) => L.parseGame({ playerByGameStats: { awayTeam: { forwards: ids.map((id) => ({ playerId: id })), defense: [], goalies: [] }, homeTeam: {} } }, land([]));
  const s8 = L.newState({ meta: {}, rosters: { M: { owner: "M", locked: true, slots: [{ key: "F1", pos: "F", base: { id: 10, name: "Barkov", team: "FLA" }, sub: null, games: 8, activeFrom: "2026-09-01T00:00:00Z", baseMissed: 8, subMissed: 0 }] } } });
  L.applyManual(s8, { subs: [{ owner: "M", replaces: "Barkov", sub: "Eichel", pos: "F", subGames: 5 }] }, idx, "2026-10-26T12:00:00Z");
  const sl = s8.rosters.M.slots[0];
  assert.equal(sl.bank, 3);
  L.processGame(s8, { id: 1, date: "2026-10-28", start: "2026-10-28T23:00:00Z", away: "VGK", home: "X" }, b([6]), "z");   // Eichel v říjnu
  L.processGame(s8, { id: 2, date: "2026-10-30", start: "2026-10-30T23:00:00Z", away: "FLA", home: "X" }, b([10]), "z");  // Barkov zpět
  assert.ok(sl.sub && sl.bank === 2, "Eichel ještě dohraje 2");
  L.processGame(s8, { id: 3, date: "2026-11-01", start: "2026-11-01T23:00:00Z", away: "VGK", home: "X" }, b([6]), "z");
  L.processGame(s8, { id: 4, date: "2026-11-03", start: "2026-11-03T23:00:00Z", away: "VGK", home: "X" }, b([6]), "z");
  assert.ok(!sl.sub && sl.bank === 0, "po 8 zápasech celkem Eichel končí, i přes konec měsíce");
  assert.equal(s8.months["2026-10"].owners.M.players[6].gp, 1); assert.equal(s8.months["2026-11"].owners.M.players[6].gp, 2);
  console.log("✓ banka Barkov/Eichel přes konec měsíce");
}

// Barkov odehraje 2 zápasy, pak za něj Eichel – body i banka spočítané z přepočtu
{
  const b = (ids) => L.parseGame({ playerByGameStats: { awayTeam: { forwards: ids.map((id) => ({ playerId: id })), defense: [], goalies: [] }, homeTeam: {} } }, land(ids.includes(6) ? [{ playerId: 6, assists: [] }] : []));
  const s9 = L.newState({ meta: {}, rosters: { M: { owner: "M", locked: true, lockedAt: "2026-10-25T10:00:00Z", slots: [{ key: "F1", pos: "F", base: { id: 10, name: "Barkov", team: "FLA" }, sub: null, games: 0, activeFrom: "x", baseMissed: 0, subMissed: 0 }] } } });
  const ro = L.prepareRetro(s9, { version: "v3", fromIso: "2026-09-01T00:00:00Z", untilIso: "2026-11-01T04:00:00Z", month: "2026-10" });
  L.applyManualPre(s9, { subs: [{ owner: "M", replaces: "Barkov", sub: "Eichel", pos: "F", afterBaseGames: 2 }] }, idx, ro, "now");
  const G = (id, d, t, ids) => L.processGame(s9, { id, date: `2026-10-${d}`, start: `2026-10-${d}T23:00:00Z`, away: t, home: "X" }, b(ids), "now", { only: ro, quiet: true });
  G(1, "01", "FLA", [10]); G(2, "02", "VGK", [6]); G(3, "03", "FLA", [10]);   // Barkov 2 zápasy, Eichelův zápas se nepočítá
  G(4, "05", "FLA", []); G(5, "06", "VGK", [6]); G(6, "07", "FLA", []); G(7, "08", "VGK", [6]); G(8, "09", "FLA", []);
  const sl = s9.rosters.M.slots[0], mo = s9.months["2026-10"].owners.M.players;
  assert.ok(sl.sub && sl.bank === 1, "Barkov vynechal 3, Eichel odehrál 2 → v bance 1");
  assert.equal(mo[6].gp, 2); assert.equal(mo[10].gp, 2);
  console.log("✓ Eichel za Barkova po jeho 2. zápase");
}

// Eichel: body do pointsFrom z Excelu, banka ze skutečných zápasů
{
  const b = (ids) => L.parseGame({ playerByGameStats: { awayTeam: { forwards: ids.map((id) => ({ playerId: id })), defense: [], goalies: [] }, homeTeam: {} } }, land(ids.includes(6) ? [{ playerId: 6, assists: [] }] : []));
  const s10 = L.newState({ meta: {}, rosters: { M: { owner: "M", locked: true, lockedAt: "2026-10-25T10:00:00Z", slots: [{ key: "F1", pos: "F", base: { id: 10, name: "Barkov", team: "FLA" }, sub: null, games: 0, activeFrom: "x", baseMissed: 0, subMissed: 0 }] } } });
  const ro = L.prepareRetro(s10, { version: "v3", fromIso: "2026-09-01T00:00:00Z", untilIso: "2026-11-01T04:00:00Z", month: "2026-10" });
  L.applyManualPre(s10, { subs: [{ owner: "M", replaces: "Barkov", sub: "Eichel", pos: "F", afterBaseGames: 2, pointsFrom: "2026-10-26T13:00:00Z" }] }, idx, ro, "now");
  const G = (id, d, t, ids) => L.processGame(s10, { id, date: `2026-10-${d}`, start: `2026-10-${d}T23:00:00Z`, away: t, home: "X" }, b(ids), "now", { only: ro, quiet: true });
  G(1, "01", "FLA", [10]); G(2, "03", "FLA", [10]); G(3, "05", "FLA", []); G(4, "06", "VGK", [6]); G(5, "07", "FLA", []); G(6, "26", "VGK", [6]);
  const sl = s10.rosters.M.slots[0], mo = s10.months["2026-10"].owners.M.players;
  L.applyManual(s10, { points: [{ month: "2026-10", owner: "M", name: "Eichel", pos: "F", g: 5, a: 9 }] }, idx, "now");
  assert.equal(sl.bank, 0, "Barkov vynechal 2, Eichel odehrál 2");
  assert.equal(mo[6].pts, 2, "Eichel má body jen ze zápasu po 26. 10. 13:00");
  assert.equal(s10.months["2026-10"].owners.M.pts, mo[6].pts + mo["rucne-eichel"].pts);
  console.log("✓ Eichel: Excel + banka ze skutečných zápasů");
}

// Eichel v sestavě jako základní hráč: do 26. 10. jen Excel, potom aplikace
{
  const b = (ids) => L.parseGame({ playerByGameStats: { awayTeam: { forwards: ids.map((id) => ({ playerId: id })), defense: [], goalies: [] }, homeTeam: {} } }, land([{ playerId: 6, assists: [] }]));
  const s11 = L.newState({ meta: {}, rosters: { M: { owner: "M", locked: true, slots: [{ key: "F1", pos: "F", base: { id: 6, name: "Jack Eichel", team: "VGK" }, sub: null, games: 0, activeFrom: "2026-09-01T00:00:00Z", baseMissed: 0, subMissed: 0 }] } } });
  L.applyManualPre(s11, { excelUntil: [{ owner: "M", name: "Eichel", until: "2026-10-26T13:00:00Z" }] }, idx, new Set(), "now");
  L.processGame(s11, { id: 1, date: "2026-10-20", start: "2026-10-20T23:00:00Z", away: "VGK", home: "X" }, b([6]), "now");
  L.processGame(s11, { id: 2, date: "2026-10-27", start: "2026-10-27T23:00:00Z", away: "VGK", home: "X" }, b([6]), "now");
  assert.equal(s11.months["2026-10"].owners.M.players[6].pts, 2, "počítá se jen zápas po 26. 10.");
  console.log("✓ Eichel do 26. 10. jen z Excelu");
}

// kontrolní seznamy: Barkov vynechá 3, Eichel odehraje 3
{
  const b = (ids) => L.parseGame({ playerByGameStats: { awayTeam: { forwards: ids.map((id) => ({ playerId: id })), defense: [], goalies: [] }, homeTeam: {} } }, land(ids.includes(6) ? [{ playerId: 6, assists: [] }] : []));
  const s12 = L.newState({ meta: {}, rosters: { M: { owner: "M", locked: true, slots: [{ key: "F1", pos: "F", base: { id: 10, name: "Barkov", team: "FLA" }, sub: null, games: 0, activeFrom: "2026-09-01T00:00:00Z", baseMissed: 0, subMissed: 0 }] } } });
  const G = (id, d, t, ids, opp = "BOS") => L.processGame(s12, { id, date: `2026-11-${d}`, start: `2026-11-${d}T23:00:00Z`, away: t, home: opp }, b(ids), `2026-11-${d}T23:59:00Z`);
  G(1, "02", "FLA", []);
  const inj = s12.injuries[0];
  s12.picks.push({ id: "p", injuryId: inj.id, owner: "M", playerId: 6, name: "Jack Eichel", status: "pending", createdAt: "2026-11-03T00:00:00Z" });
  L.applyPicks(s12, idx, "2026-11-03T01:00:00Z");
  G(2, "04", "FLA", [], "TOR"); G(3, "05", "VGK", [6], "SJS"); G(4, "06", "FLA", [], "DET"); G(5, "07", "VGK", [6], "LAK"); G(6, "09", "VGK", [6], "CBJ");
  assert.deepEqual(inj.missedList.map((x) => x.opp), ["BOS", "TOR", "DET"]);
  assert.deepEqual(inj.subList.map((x) => x.opp), ["SJS", "LAK", "CBJ"]);
  assert.equal(inj.subList[0].pts, 2);
  G(6, "09", "VGK", [6], "CBJ");
  assert.equal(inj.subList.length, 3, "žádné duplicity");
  console.log("✓ seznamy vynechaných a odehraných zápasů");
}

// Suzuki chybí od 23. 10., Stützle hraje od 25. 10.: vynechal 4, odehrál 3, v bance 1
{
  const b = (ids) => L.parseGame({ playerByGameStats: { awayTeam: { forwards: ids.map((id) => ({ playerId: id })), defense: [], goalies: [] }, homeTeam: {} } }, land([]));
  const s13 = L.newState({ meta: {}, rosters: { S: { owner: "S", locked: true, lockedAt: "2026-10-25T10:00:00Z", slots: [{ key: "F2", pos: "F", base: { id: 20, name: "Nick Suzuki", team: "MTL" }, sub: null, games: 0, activeFrom: "x", baseMissed: 0, subMissed: 0 }] } } });
  const ro = L.prepareRetro(s13, { version: "v6", fromIso: "2026-09-01T00:00:00Z", untilIso: "2026-11-01T04:00:00Z", month: "2026-10" });
  L.applyManualPre(s13, { subs: [{ owner: "S", replaces: "Suzuki", sub: "Stone", pos: "F", missFrom: "2026-10-23", subFrom: "2026-10-25" }] }, idx, ro, "now");
  const G = (id, d, t, ids) => L.processGame(s13, { id, date: `2026-10-${d}`, start: `2026-10-${d}T23:30:00Z`, away: t, home: "X" }, b(ids), "2026-10-30T10:00:00Z", { only: ro, quiet: true });
  G(1, "21", "MTL", [20]); G(2, "23", "MTL", []); G(3, "23", "VGK", [5]); G(4, "25", "MTL", []); G(5, "24", "VGK", [5]); // 24.10. 23:30 UTC = 25.10. u nás
  G(6, "27", "MTL", []); G(7, "28", "VGK", [5]); G(8, "29", "MTL", []); G(9, "30", "VGK", [5]);
  const inj = s13.injuries.find((i) => i.active), sl = s13.rosters.S.slots[0];
  assert.equal(inj.missedList.length, 4); assert.equal(inj.subList.length, 3); assert.equal(sl.bank, 1);
  assert.equal(L.pragueMidnight("2026-10-25"), "2026-10-24T22:00:00.000Z"); assert.equal(L.pragueMidnight("2026-11-05"), "2026-11-04T23:00:00.000Z");
  console.log("✓ Stützle za Suzukiho: 4 / 3 / banka 1 (data v našem čase)");
}

// přepočet jednoho místa: Luukkonen za Gustavssona od začátku sezóny, ostatní místa beze změny
{
  const gb = (onRoster, played, so) => L.parseGame({ playerByGameStats: { awayTeam: { forwards: [{ playerId: 1 }], defense: [],
    goalies: onRoster.map((id) => ({ playerId: id, toi: id === played ? "60:00" : "00:00", goalsAgainst: so ? 0 : 2 })) }, homeTeam: {} } }, land([]));
  const s14 = L.newState({ meta: {}, months: { "2026-10": { key: "2026-10", owners: { S: { pts: 12, players: { 1: { name: "McDavid", pos: "F", slot: "F1", pts: 10 }, 50: { name: "Skinner", pos: "G", slot: "G1", pts: 2 } } } } } },
    rosters: { S: { owner: "S", locked: true, slots: [
      { key: "F1", pos: "F", base: { id: 1, name: "Connor McDavid", team: "EDM" }, sub: null, games: 5, activeFrom: "2026-09-01T00:00:00Z" },
      { key: "G1", pos: "G", base: { id: 50, name: "Stuart Skinner", team: "EDM" }, sub: null, games: 5, activeFrom: "2026-09-01T00:00:00Z" }] } } });
  const rd = L.prepareSlotRedo(s14, { subs: [{ owner: "S", replaces: "Skinner", sub: "Hill", pos: "G", missFrom: "2026-09-01", subFrom: "2026-09-01", slotRedo: "v1" }] }, idx, "2026-09-01T00:00:00Z", "2026-11-04T12:00:00Z");
  assert.equal(s14.months["2026-10"].owners.S.pts, 10, "Skinnerovy body pryč, McDavid zůstává");
  const G = (id, d, team, p) => L.processGame(s14, { id, date: `2026-10-${d}`, start: `2026-10-${d}T23:00:00Z`, away: team, home: "X" }, p, "2026-11-04T12:00:00Z", { only: new Set(rd.keys()), slots: rd, quiet: true });
  G(1, "02", "EDM", gb([51], 51)); G(2, "03", "VGK", gb([52, 53], 53)); G(3, "05", "EDM", gb([51], 51)); G(4, "06", "VGK", gb([52, 53], 52, true));
  const sl = s14.rosters.S.slots[1], inj = s14.injuries.find((i) => i.active);
  assert.equal(inj.missedList.length, 2); assert.equal(inj.subList.length, 2); assert.equal(sl.bank, 0);
  assert.equal(s14.months["2026-10"].owners.S.players[52].pts, 5, "Hill: nula jen v zápase, který chytal");
  assert.equal(s14.rosters.S.slots[0].games, 5, "McDavidovo místo se nepřepočítalo");
  console.log("✓ přepočet jednoho místa (brankář)");
}

// výměna základního brankáře (Skinner → hráč na IR, který není v seznamu) + náhradník
{
  const s15 = L.newState({ meta: {}, months: { "2026-10": { key: "2026-10", owners: { S: { pts: 7, players: { 50: { name: "Skinner", pos: "G", slot: "G1", pts: 7 } } } } } },
    rosters: { S: { owner: "S", locked: true, slots: [{ key: "G1", pos: "G", base: { id: 50, name: "Stuart Skinner", team: "EDM" }, sub: null, games: 9, activeFrom: "x" }] } } });
  const rd = L.prepareSlotRedo(s15, { subs: [{ owner: "S", replaces: "Skinner", newBase: { name: "Gustavsson", fullName: "Filip Gustavsson", team: "MIN", id: 999 }, sub: "Hill", pos: "G", missFrom: "2026-09-01", slotRedo: "v2" }] }, idx, "2026-09-01T00:00:00Z", "2026-11-04T12:00:00Z");
  assert.equal(s15.rosters.S.slots[0].base.id, 999); assert.equal(s15.months["2026-10"].owners.S.pts, 0, "Skinnerovy body pryč");
  assert.ok(rd.get("S").has("G1"));
  console.log("✓ výměna základního brankáře + náhradník");
}

// forma hráčů a týmů
{
  const box = { playerByGameStats: { awayTeam: { forwards: [{ playerId: 1, goals: 1, assists: 2 }], defense: [{ playerId: 4, goals: 0, assists: 0 }], goalies: [{ playerId: 50, toi: "60:00", goalsAgainst: 0 }, { playerId: 51, toi: "00:00" }] }, homeTeam: { forwards: [], defense: [], goalies: [] } } };
  const rows = L.boxForm(box);
  assert.deepEqual(rows.find((r) => r.id === 50), { id: 50, g: 0, a: 0, so: 1 }); assert.ok(!rows.some((r) => r.id === 51));
  const form = {};
  for (let d = 1; d <= 12; d++) L.addForm(form, { id: 100 + d, date: `2026-11-${String(d).padStart(2, "0")}` }, rows);
  L.addForm(form, { id: 112, date: "2026-11-12" }, rows); // znovu stejný den – bez duplicity
  const l = form.p["1"].split(" ");
  assert.equal(l.length, 10); assert.equal(l[0], "20261112.1.2.0"); assert.equal(l[9], "20261103.1.2.0");
  const tf = L.teamForm([{ start: "2", away: "TOR", home: "BOS", as: 2, hs: 3, last: "OT" }, { start: "1", away: "BOS", home: "TOR", as: 1, hs: 4, last: "REG" }]);
  assert.equal(tf.TOR, "WO"); assert.equal(tf.BOS, "LW");
  console.log("✓ forma hráčů a týmů");
}

// formace ze střídání
{
  const mk = (id, ranges) => ranges.map(([a, b]) => ({ playerId: id, period: 1, startTime: a, endTime: b, typeCode: 517 }));
  const L1 = ["0:00", "0:45"], L2 = ["0:45", "1:30"], L3 = ["1:30", "2:00"];
  const shifts = { data: [...mk(1, [L1]), ...mk(2, [L1]), ...mk(3, [L1]), ...mk(4, [L2]), ...mk(5, [L2]), ...mk(6, [L2]), ...mk(7, [L1, L3]), ...mk(8, [L1, L3]), ...mk(9, [L2]), ...mk(10, [L2])] };
  const P = (id) => ({ playerId: id, name: { default: "P" + id }, goals: 0, assists: 0, plusMinus: 0, toi: "10:00" });
  const box = { awayTeam: { abbrev: "TOR" }, homeTeam: { abbrev: "BOS" }, playerByGameStats: { awayTeam: { forwards: [1, 2, 3, 4, 5, 6].map(P), defense: [7, 8, 9, 10].map(P), goalies: [{ playerId: 30, name: { default: "G" }, toi: "60:00", saveShotsAgainst: "29/31", savePctg: 0.935 }] }, homeTeam: {} } };
  const t = L.lineups(box, shifts).TOR;
  assert.deepEqual(t.f.map((x) => x.split("|")[0].split(",").map(Number).sort()), [[1, 2, 3], [4, 5, 6]]);
  assert.deepEqual(t.d.map((x) => x.split("|")[0].split(",").map(Number).sort((a, b) => a - b)), [[7, 8], [9, 10]]);
  assert.equal(t.d[0].split("|")[1], "75"); assert.equal(t.g.length, 1);
  assert.equal(L.lineups(box, null).TOR.f.length, 0);
  console.log("✓ formace ze střídání");
}

// statistiky zápasu a hvězdy
{
  const gs = L.gameStats({ teamGameStats: [{ category: "sog", awayValue: 34, homeValue: 27 }, { category: "powerPlay", awayValue: "1/3", homeValue: "0/2" }, { category: "faceoffWinningPctg", awayValue: 0.54, homeValue: 0.46 }],
    shotsByPeriod: [{ periodDescriptor: { number: 1 }, away: 12, home: 8 }, { periodDescriptor: { number: 2 }, away: 10, home: 9 }] });
  assert.deepEqual(gs, { sog: "34|27", pp: "1/3|0/2", fo: "0.54|0.46", sbp: "12-10|8-9" });
  assert.deepEqual(L.threeStars({ summary: { threeStars: [{ star: 2, playerId: 2, name: { default: "B" }, teamAbbrev: "TOR" }, { star: 1, playerId: 1, name: "A", teamAbbrev: { default: "BUF" } }] } }),
    [{ id: 1, n: "A", t: "BUF" }, { id: 2, n: "B", t: "TOR" }]);
  console.log("✓ statistiky zápasu a hvězdy");
}

// Bobovka – jackpot a účtování
{
  const fin = [
    { id: 1, date: "2026-11-10", start: "2026-11-11T00:00:00Z", away: "TOR", home: "BUF", as: 3, hs: 2, last: "OT" }, // po 60 min 2:2
    { id: 2, date: "2026-11-11", start: "2026-11-12T00:00:00Z", away: "EDM", home: "SEA", as: 3, hs: 1, last: "REG" },
    { id: 3, date: "2026-11-12", start: "2026-11-13T00:00:00Z", away: "COL", home: "DAL", as: 1, hs: 0, last: "REG" },
  ];
  const T = (g, o, a, h, ts = "2026-11-01T00:00:00Z") => ({ gameId: g, owner: o, a, h, ts, start: "" });
  const tips = [T(1, "A", 3, 2), T(1, "B", 2, 2), T(1, "C", 2, 2), T(2, "A", 2, 1), T(2, "B", 1, 1), T(3, "A", 1, 0), T(3, "C", 0, 0), T(3, "B", 1, 0, "2026-11-13T00:05:00Z")];
  const r = L.settleBobovka({}, tips, fin);
  assert.equal(r.games["1"].r, "2:2"); assert.deepEqual(r.games["1"].hit, ["B", "C"]); assert.equal(r.games["1"].w, 15);
  assert.equal(r.games["2"].toJp, 20); assert.ok(!r.games["3"].t.B, "pozdní tip neplatí");
  assert.equal(r.games["3"].w, 40); assert.equal(r.games["3"].jp, 20); assert.equal(r.jackpot, 0);
  const m = r.months["2026-11"].owners;
  assert.deepEqual(m.A, { tips: 3, hits: 1, staked: 30, won: 40 }); assert.deepEqual(m.B, { tips: 2, hits: 1, staked: 20, won: 15 });
  assert.equal(Object.values(m).reduce((t, x) => t + x.won - x.staked, 0), 0, "součet bilancí je nula");
  // dělení 3 výherci
  const r2 = L.settleBobovka({}, [T(2, "A", 3, 1), T(2, "B", 3, 1), T(2, "C", 3, 1), T(2, "D", 0, 0)], fin);
  const w = r2.months["2026-11"].owners; assert.equal(Math.round((w.A.won + w.B.won + w.C.won) * 100) / 100, 40);
  console.log("✓ Bobovka");
}
