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
// version: změna vynutí nový přepočet (v2 = zápasy od 30. 9., v3 = Eichel za Barkova po jeho 2. zápase, v4 = Eichel do 26. 10. jen z Excelu)
const RETRO = { version: "v4", fromIso: "2026-09-01T00:00:00Z", fromDate: "2026-09-01", untilIso: "2026-11-01T04:00:00Z", month: "2026-10" };
const addDays = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function seed(fs) {
  const s = JSON.parse(readFileSync(new URL("../seed/league.json", import.meta.url)));
  const exists = (await fs.doc("config/league").get()).exists;
  if (exists && process.env.FORCE !== "1") { console.log("Liga už existuje – nic nepřepisuji (FORCE=1 pro přepsání)."); return; }
  const b = fs.batch();
  b.set(fs.doc("config/league"), s.league);
  for (const o of s.league.owners) b.set(fs.doc(`rosters/${o}`), { owner: o, locked: false, slots: [] });
  for (const [k, m] of Object.entries(s.months)) b.set(fs.doc(`months/${k}`), m);
  b.set(fs.doc("meta/state"), { lastDate: addDays(nyDate(), -2), doneGames: {} });
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
  let manual = {};
  try { manual = JSON.parse(readFileSync(new URL("../seed/manual.json", import.meta.url))); } catch { console.log("seed/manual.json nenalezen – bez ručních úprav."); }
  L.applyManualPre(st, manual, idx, retroOwners, now);
  if (retroOwners.size) console.log(`Zpětný přepočet října pro: ${[...retroOwners].join(", ")}`);

  // 3) odehrané zápasy od posledního běhu (+ všechny od začátku sezóny pro zpětný přepočet)
  // doneGames: { "idZápasu": "datum" } (Firestore neumí pole v poli)
  const dg = st.meta.doneGames || {};
  const done = new Map(Array.isArray(dg) ? dg.map(([id, d]) => [id, d]) : Object.entries(dg).map(([id, d]) => [Number(id), d]));
  const from = st.meta.lastDate || addDays(today, -2);
  const winFrom = addDays(today, -7), winTo = addDays(today, 7); // okno pro záložku Zápasy
  let scanFrom = retroOwners.size && RETRO.fromDate < from ? RETRO.fromDate : from;
  if (winFrom < scanFrom) scanFrom = winFrom;
  const games = [], retroGames = [], upcoming = [], finals = [], byDate = {};
  for (let d = scanFrom; d <= winTo;) {
    const week = await nhl.scheduleWeek(d);
    if (!week.length) break;
    for (const day of week) for (const g of day.games) {
      if (g.type !== 2) continue; // jen základní část
      if (!(byDate[day.date] ||= []).some((x) => x.id === g.id)) byDate[day.date].push(g);
      if (day.date <= today && nhl.isFinal(g) && !games.some((x) => x.id === g.id) && !retroGames.some((x) => x.id === g.id)) {
        if (day.date >= from && !done.has(g.id)) games.push(g);
        else if (retroOwners.size && day.date >= RETRO.fromDate) retroGames.push(g);
        if (day.date >= winFrom && !finals.some((x) => x.id === g.id)) finals.push(g);
      }
      if (day.date >= today && day.date <= winTo && !nhl.isFinal(g) && !upcoming.some((x) => x.id === g.id)) upcoming.push(g);
    }
    const next = addDays(week[week.length - 1].date, 1);
    if (next <= d) break;
    d = next;
  }
  retroGames.sort((a, b) => a.start.localeCompare(b.start));
  const cache = new Map(); // id zápasu -> [boxscore, landing]
  for (const g of retroGames) {
    const [box, land] = await Promise.all([nhl.boxscore(g.id), nhl.landing(g.id)]);
    cache.set(g.id, [box, land]);
    const laterR = (byDate[g.date] || []).filter((x) => x.start > g.start).flatMap((x) => [x.away, x.home]);
    L.processGame(st, g, L.parseGame(box, land), now, { only: retroOwners, quiet: g.date < addDays(today, -2), later: laterR });
  }
  if (retroGames.length) console.log(`Zpětně přepočteno zápasů: ${retroGames.length}`);
  games.sort((a, b) => a.start.localeCompare(b.start));
  for (const g of games) {
    const [box, land] = await Promise.all([nhl.boxscore(g.id), nhl.landing(g.id)]);
    cache.set(g.id, [box, land]);
    const later = (byDate[g.date] || []).filter((x) => x.start > g.start).flatMap((x) => [x.away, x.home]);
    L.processGame(st, g, L.parseGame(box, land), now, { later });
    done.set(g.id, g.date);
  }
  console.log(`Zpracováno zápasů: ${games.length}`);

  L.applyManual(st, manual, idx, now);
  for (const w of st.log.filter((e) => e.warn)) console.log("UPOZORNĚNÍ:", w.warn);
  for (const w of st.log.filter((e) => e.info)) console.log("INFO:", w.info);
  st.log = st.log.filter((e) => !e.warn && !e.info);

  // 4) ESPN – důvod a odhad návratu (nepovinné)
  if (st.injuries.some((i) => i.active)) {
    try { L.enrichInjuries(st, await nhl.espnInjuries()); } catch (e) { console.log("ESPN nedostupné:", e.message); }
  }

  // 5) uložení
  const keepFrom = addDays(today, -10);
  st.meta.lastDate = addDays(today, -2) < from ? from : addDays(today, -2);
  st.meta.doneGames = Object.fromEntries([...done].filter(([, d]) => d >= keepFrom).map(([id, d]) => [String(id), d]));
  st.meta.lastRun = now;
  // odehrané zápasy za 7 dní se skóre a nástupy našich hráčů
  const resSnap = await fs.doc("public/results").get();
  const prev = new Map();
  for (const list of Object.values(resSnap.exists ? resSnap.data().days || {} : {})) for (const g of list) prev.set(g.id, g);
  // otisk sestav – když se změní (nová sestava, náhradník), zápasy se přepočítají
  const sig = Object.entries(st.rosters).filter(([, r]) => r.locked).map(([o, r]) => o + ":" + r.slots.map((s) => `${s.base.id}/${s.sub?.id || ""}`).join(",")).sort().join(";");
  const days = {};
  for (const g of finals.sort((a, b) => a.start.localeCompare(b.start))) {
    const old = prev.get(g.id);
    let entry = old && old.sig === sig && old.goals ? old : null;
    if (!entry) {
      try {
        const [box, land] = cache.get(g.id) || await Promise.all([nhl.boxscore(g.id), nhl.landing(g.id)]);
        entry = { pl: L.appearances(st, g, L.parseGame(box, land)), goals: L.parseGoals(land), sig };
      } catch (e) { console.log(`Zápas ${g.id}: ${e.message}`); entry = { pl: old?.pl || [], goals: old?.goals || [], sig: "" }; }
    }
    (days[g.date] ||= []).push({ id: g.id, start: g.start, away: g.away, home: g.home, as: g.as, hs: g.hs, last: g.last, pl: entry.pl, goals: entry.goals, sig: entry.sig });
  }
  const all = Object.values(days).flat();
  console.log(`Zápasy za 7 dní: ${all.length}, gólů: ${all.reduce((t, g) => t + (g.goals?.length || 0), 0)}, nástupů našich hráčů: ${all.reduce((t, g) => t + (g.pl?.length || 0), 0)}`);
  const extra = {
    "meta/state": st.meta,
    "public/pool": { ...L.encodePool(pool), updated: now },
    "public/upcoming": { games: upcoming.sort((a, b) => a.start.localeCompare(b.start)), updated: now },
    "public/results": { days, updated: now },
  };
  if (DRY) { console.log("DRY – neukládám.", [...st.dirty], st.feed); return; }
  console.log(`Zápisů: ${await save(fs, st, extra)}`);
}

export async function main(fs, m = mode) { await (m === "seed" ? seed(fs) : m === "months" ? months(fs) : sync(fs)); }
if (import.meta.url === `file://${process.argv[1]}`) await main(db());
