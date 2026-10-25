// Celý běh proti falešné databázi a falešnému NHL API.  node e2e.mjs
import { Timestamp } from "firebase-admin/firestore";
const docs = new Map();
const snap = (id, d) => ({ id, exists: d !== undefined, data: () => structuredClone(d) });
const fs = {
  doc: (p) => ({ path: p, get: async () => snap(p.split("/")[1], docs.get(p)) }),
  collection: (c) => {
    const all = () => [...docs].filter(([p]) => p.split("/")[0] === c && p.split("/").length === 2).map(([p, d]) => snap(p.split("/")[1], d));
    return { get: async () => ({ docs: all() }), where: (f, _, v) => ({ get: async () => ({ docs: all().filter((s) => s.data()[f] === v) }) }),
      doc: (id = Math.random().toString(36).slice(2)) => ({ path: `${c}/${id}` }) };
  },
  batch: () => { const w = []; return { set: (r, d, o) => w.push([r.path, d, o?.merge]), commit: async () => { for (const [p, d, m] of w) docs.set(p, m ? { ...docs.get(p), ...d } : structuredClone(d)); } }; },
};
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const y = (n) => { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
globalThis.fetch = async (url) => {
  const j = (o) => ({ ok: true, json: async () => o });
  if (url.includes("/skater/summary")) return j({ data: [
    { playerId: 1, skaterFullName: "Connor McDavid", teamAbbrevs: "EDM", positionCode: "C", gamesPlayed: 10, goals: 6, assists: 20 },
    { playerId: 2, skaterFullName: "Leon Draisaitl", teamAbbrevs: "EDM", positionCode: "C", gamesPlayed: 10, goals: 8, assists: 8 },
    { playerId: 3, skaterFullName: "Auston Matthews", teamAbbrevs: "TOR", positionCode: "C", gamesPlayed: 10, goals: 8, assists: 10 },
    { playerId: 4, skaterFullName: "Evan Bouchard", teamAbbrevs: "EDM", positionCode: "D", gamesPlayed: 10, goals: 7, assists: 11 }] });
  if (url.includes("/goalie/summary")) return j({ data: [{ playerId: 50, goalieFullName: "Stuart Skinner", teamAbbrevs: "EDM", gamesPlayed: 8, wins: 5, losses: 2, otLosses: 1, goalsAgainstAverage: 2.512, savePct: 0.9123, shutouts: 1 }] });
  if (url.includes("/standings/now")) return j({ standings: [{ teamAbbrev: { default: "EDM" }, gamesPlayed: 12 }, { teamAbbrev: { default: "TOR" }, gamesPlayed: 11 }] });
  if (url.includes("/schedule/")) return j({ gameWeek: [
    { date: y(-1), games: [{ id: 900, gameType: 2, gameState: "OFF", startTimeUTC: "2099-01-01T00:00:00Z", awayTeam: { abbrev: "EDM" }, homeTeam: { abbrev: "TOR" } }] },
    { date: y(1), games: [{ id: 901, gameType: 2, gameState: "FUT", startTimeUTC: y(1) + "T23:00:00Z", awayTeam: { abbrev: "TOR" }, homeTeam: { abbrev: "EDM" } }] }] });
  if (url.includes("/boxscore")) return j({ playerByGameStats: { awayTeam: { forwards: [{ playerId: 1 }, { playerId: 2 }], defense: [{ playerId: 4 }], goalies: [{ playerId: 50, toi: "60:00", goalsAgainst: 0 }] }, homeTeam: { forwards: [{ playerId: 3 }], defense: [], goalies: [] } } });
  if (url.includes("/landing")) return j({ summary: { scoring: [{ periodDescriptor: { periodType: "REG" }, goals: [{ playerId: 1, assists: [{ playerId: 4 }] }] }] } });
  if (url.includes("espn")) throw new Error("offline");
  throw new Error("neznámá adresa " + url);
};
const run = await import("./run.mjs");
run.setNow("2026-11-01T10:00:00Z");
await run.main(fs, "seed");
docs.set("rosterPicks/Šráma", { owner: "Šráma", status: "pending", confirmedAt: Timestamp.fromDate(new Date("2026-11-01T09:00:00Z")), players: {
  F1: { id: 1 }, F2: { id: 2 }, F3: { id: 3 }, D1: { id: 4 }, G1: { id: 50 } } });
await run.main(fs, "sync");
const r = docs.get("rosters/Šráma");
console.log("locked", r.locked, r.slots.map((s) => `${s.key}:${s.base.name} ${s.games}/82`).join(" "));
const mk = y(-1).slice(0, 7);
console.log("měsíc", mk, JSON.stringify(docs.get("months/" + mk)?.owners?.["Šráma"]));
console.log("upcoming", docs.get("public/upcoming").games.length, "recent", JSON.stringify(docs.get("public/recent").days));
console.log("feed", [...docs].filter(([p]) => p.startsWith("feed/")).map(([, d]) => d.txt));
console.log("říjen zachován", docs.get("months/2026-10").owners["Svatý"].pts);
