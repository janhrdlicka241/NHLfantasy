// Spouští GitHub Actions každou hodinu.  node run.mjs sync | seed
import * as nhl from "./nhl.mjs";
import * as L from "./logic.mjs";
import { db, load, save } from "./store.mjs";
import { readFileSync } from "node:fs";

const mode = process.argv[2] || "sync";
const DRY = process.env.DRY === "1";
let now = new Date().toISOString();
export const setNow = (v) => { now = v; };
const nyDate = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
// Říjen 2026: sestavy potvrzené do konce října (čas NHL) se počítají od začátku sezóny
const RETRO = { fromIso: "2026-09-01T00:00:00Z", fromDate: "2026-10-01", untilIso: "2026-11-01T04:00:00Z", month: "2026-10" };
const addDays = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function seed(fs) {
  const s = JSON.parse(readFileSync(new URL("../seed/league.json", import.meta.url)));
  const exists = (await fs.doc("config/league").get()).exists;
  if (exists && process.env.FORCE !== "1") { console.log("Liga už existuje – nic nepřepisuji (FORCE=1 pro přepsání)."); return; }
  const b = fs.batch();
  b.set(fs.doc("config/league"), s.league);
  for (const o of s.league.owners) b.set(fs.doc(`rosters/${o}`), { owner: o, locked: false, slots: [] });
  for (const [k, m] of Object.entries(s.months)) b.set(fs.doc(`months/${k}`), m);
  b.set(fs.doc("meta/state"), { lastDate: addDays(nyDate(), -2), doneGames: [] });
  b.set(fs.doc("feed/start"), { ts: now, kind: "ok", txt: "Liga je založená. Každý si v záložce Týmy sestaví svůj tým.", owner: null });
  if (!DRY) await b.commit();
  console.log("Seed hotový.");
}

// Přepíše uzavřené měsíce ze seed/league.json (např. konečný říjen z Excelu), stav "vyplaceno" zůstane
async function months(fs) {
  const s = JSON.parse(readFileSync(new URL("../seed/league.json", import.meta.url)));
  for (const [k, m] of Object.entries(s.months)) {
    const old = await fs.doc(`months/${k}`).get();
    const b = fs.batch(); b.set(fs.doc(`months/${k}`), { ...m, paid: old.exists ? !!old.data().paid : false });
    if (!DRY) await b.commit();
    console.log(`Měsíc ${k} nahrán.`);
  }
}

async function sync(fs) {
  const st = L.newState(await load(fs));
  const today = nyDate();
  const season = st.league.season;

  // 1) statistiky celé ligy (výběr hráčů, žebříčky) + odehrané zápasy týmů
  const pool = await nhl.pool(season);
  const teamGP = await nhl.teamGamesPlayed();
  const added = L.mergeRosters(pool, await nhl.rosters(Object.keys(teamGP).filter(Boolean)));
  console.log(`Ze soupisek doplněno hráčů bez zápasu: ${added}`);
  const idx = L.poolIndex(pool);
  console.log(`Pool: ${pool.skaters.length} hráčů, ${pool.goalies.length} brankářů`);
  L.refreshTeams(st, idx);

  // 2) potvrzené sestavy, výběry náhradníků, lhůty
  L.applyRosterPicks(st, idx, teamGP, now);
  L.applyPicks(st, idx, now);
  L.applyDeadlines(st, idx, now);
  const retroOwners = L.prepareRetro(st, RETRO);
  if (retroOwners.size) console.log(`Zpětný přepočet října pro: ${[...retroOwners].join(", ")}`);

  // 3) odehrané zápasy od posledního běhu (+ všechny od začátku sezóny pro zpětný přepočet)
  const done = new Map((st.meta.doneGames || []).map(([id, d]) => [id, d]));
  const from = st.meta.lastDate || addDays(today, -2);
  const scanFrom = retroOwners.size && RETRO.fromDate < from ? RETRO.fromDate : from;
  const games = [], retroGames = [], upcoming = [];
  for (let d = scanFrom; d <= addDays(today, 3);) {
    const week = await nhl.scheduleWeek(d);
    if (!week.length) break;
    for (const day of week) for (const g of day.games) {
      if (g.type !== 2) continue; // jen základní část
      if (day.date <= today && nhl.isFinal(g) && !games.some((x) => x.id === g.id) && !retroGames.some((x) => x.id === g.id)) {
        if (day.date >= from && !done.has(g.id)) games.push(g);
        else if (retroOwners.size && day.date >= RETRO.fromDate) retroGames.push(g);
      }
      if (day.date >= today && day.date <= addDays(today, 3) && !nhl.isFinal(g) && !upcoming.some((x) => x.id === g.id)) upcoming.push(g);
    }
    const next = addDays(week[week.length - 1].date, 1);
    if (next <= d) break;
    d = next;
  }
  retroGames.sort((a, b) => a.start.localeCompare(b.start));
  for (const g of retroGames) {
    const [box, land] = await Promise.all([nhl.boxscore(g.id), nhl.landing(g.id)]);
    L.processGame(st, g, L.parseGame(box, land), now, { only: retroOwners, quiet: g.date < addDays(today, -2) });
  }
  if (retroGames.length) console.log(`Zpětně přepočteno zápasů: ${retroGames.length}`);
  games.sort((a, b) => a.start.localeCompare(b.start));
  for (const g of games) {
    const [box, land] = await Promise.all([nhl.boxscore(g.id), nhl.landing(g.id)]);
    L.processGame(st, g, L.parseGame(box, land), now);
    done.set(g.id, g.date);
  }
  console.log(`Zpracováno zápasů: ${games.length}`);

  // 4) ESPN – důvod a odhad návratu (nepovinné)
  if (st.injuries.some((i) => i.active)) {
    try { L.enrichInjuries(st, await nhl.espnInjuries()); } catch (e) { console.log("ESPN nedostupné:", e.message); }
  }

  // 5) uložení
  const keepFrom = addDays(today, -10);
  st.meta.lastDate = addDays(today, -2) < from ? from : addDays(today, -2);
  st.meta.doneGames = [...done].filter(([, d]) => d >= keepFrom);
  st.meta.lastRun = now;
  const recentSnap = await fs.doc("public/recent").get();
  const days = recentSnap.exists ? recentSnap.data().days || {} : {};
  for (const k of Object.keys(days)) days[k] = days[k].filter((e) => !retroOwners.has(e.owner)); // přepočtení majitelé znovu
  for (const e of st.log) (days[e.date] ||= []).push(e);
  for (const k of Object.keys(days)) if (k < addDays(today, -7)) delete days[k];
  const extra = {
    "meta/state": st.meta,
    "public/pool": { ...pool, updated: now },
    "public/upcoming": { games: upcoming.sort((a, b) => a.start.localeCompare(b.start)), updated: now },
    "public/recent": { days, updated: now },
  };
  if (DRY) { console.log("DRY – neukládám.", [...st.dirty], st.feed); return; }
  console.log(`Zápisů: ${await save(fs, st, extra)}`);
}

export async function main(fs, m = mode) { await (m === "seed" ? seed(fs) : m === "months" ? months(fs) : sync(fs)); }
if (import.meta.url === `file://${process.argv[1]}`) await main(db());
