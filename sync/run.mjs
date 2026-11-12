// Spouští GitHub Actions každou hodinu.  node run.mjs sync | seed
import * as nhl from "./nhl.mjs";
import * as L from "./logic.mjs";
import { db, load, save, tipsSince } from "./store.mjs";
import { readFileSync } from "node:fs";

const mode = process.argv[2] || "sync";
const DRY = process.env.DRY === "1";
let now = new Date().toISOString();
export const setNow = (v) => { now = v; };
const nyDate = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
// Říjen 2026: sestavy potvrzené do konce října (čas NHL) se počítají od začátku sezóny
// version: změna vynutí nový přepočet (v2 = zápasy od 30. 9., v3 = Eichel za Barkova po jeho 2. zápase, v4 = Eichel do 26. 10. jen z Excelu, v5 = seznamy zápasů u zranění, v6 = Stützle za Suzukiho, v7 = data v našem čase)
const RETRO = { version: "v7", fromIso: "2026-09-01T00:00:00Z", fromDate: "2026-09-01", untilIso: "2026-11-01T04:00:00Z", month: "2026-10" };
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
  const table = await nhl.standings();
  const teamGP = Object.fromEntries(table.map((t) => [t.t, t.gp]));
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
  const redo = L.prepareSlotRedo(st, manual, idx, RETRO.fromIso, now);
  if (retroOwners.size) console.log(`Zpětný přepočet října pro: ${[...retroOwners].join(", ")}`);

  // 3) odehrané zápasy od posledního běhu (+ všechny od začátku sezóny pro zpětný přepočet)
  // doneGames: { "idZápasu": "datum" } (Firestore neumí pole v poli)
  const dg = st.meta.doneGames || {};
  const done = new Map(Array.isArray(dg) ? dg.map(([id, d]) => [id, d]) : Object.entries(dg).map(([id, d]) => [Number(id), d]));
  const from = st.meta.lastDate || addDays(today, -2);
  const winFrom = addDays(today, -7), winTo = addDays(today, 7); // okno pro záložku Zápasy
  const needOld = retroOwners.size || redo.size;
  let scanFrom = needOld && RETRO.fromDate < from ? RETRO.fromDate : from;
  const formFrom = addDays(today, -30); // forma hráčů a týmů
  const seasonFrom = RETRO.fromDate; // vzájemné zápasy a série týmů za celou sezónu
  if (seasonFrom < scanFrom) scanFrom = seasonFrom;
  const games = [], retroGames = [], upcoming = [], finals = [], byDate = {}, formGames = [], seasonList = [];
  for (let d = scanFrom; d <= winTo;) {
    const week = await nhl.scheduleWeek(d);
    if (!week.length) break;
    for (const day of week) for (const g of day.games) {
      if (g.type !== 2) continue; // jen základní část
      if (!(byDate[day.date] ||= []).some((x) => x.id === g.id)) byDate[day.date].push(g);
      if (day.date <= today && nhl.isFinal(g) && !games.some((x) => x.id === g.id) && !retroGames.some((x) => x.id === g.id)) {
        if (day.date >= from && !done.has(g.id)) games.push(g);
        else if (needOld && day.date >= RETRO.fromDate) retroGames.push(g);
        if (day.date >= winFrom && !finals.some((x) => x.id === g.id)) finals.push(g);
      }
      if (day.date >= today && day.date <= winTo && !nhl.isFinal(g) && !upcoming.some((x) => x.id === g.id)) upcoming.push(g);
      if (day.date >= formFrom && day.date <= today && nhl.isFinal(g) && !formGames.some((x) => x.id === g.id)) formGames.push(g);
      if (day.date <= today && nhl.isFinal(g) && !seasonList.some((x) => x.id === g.id)) seasonList.push(g);
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
    const parsed = L.parseGame(box, land), quiet = g.date < addDays(today, -2);
    if (retroOwners.size && g.date < "2026-11-01") L.processGame(st, g, parsed, now, { only: retroOwners, quiet, later: laterR });
    if (redo.size) L.processGame(st, g, parsed, now, { only: new Set(redo.keys()), slots: redo, quiet, later: laterR });
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

  // 4) ESPN – důvod a odhad návratu (nepovinné); seznam zraněných i pro „Nejlepší volní“
  let espn = null;
  try { espn = await nhl.espnInjuries(); } catch (e) { console.log("ESPN nedostupné:", e.message); }
  if (espn && st.injuries.some((i) => i.active)) L.enrichInjuries(st, espn);

  // 4b) forma hráčů – boxscore zápasů za 30 dní, které ještě nemáme
  const fSnap = await fs.doc("public/form").get();
  const fd = fSnap.exists ? fSnap.data() : {};
  const form = fd.v === 1 ? { p: fd.p || {}, games: fd.games || {} } : { p: {}, games: {} };
  const todo = formGames.filter((g) => !form.games[String(g.id)]).sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 0; i < todo.length; i += 8) {
    const part = todo.slice(i, i + 8);
    const boxes = await Promise.all(part.map((g) => (cache.get(g.id) ? Promise.resolve(cache.get(g.id)[0]) : nhl.boxscore(g.id).catch((e) => { console.log(`Forma ${g.id}: ${e.message}`); return null; }))));
    part.forEach((g, k) => { if (boxes[k]) L.addForm(form, g, L.boxForm(boxes[k])); });
  }
  form.games = Object.fromEntries(Object.entries(form.games).filter(([, d]) => d >= addDays(today, -40)));
  console.log(`Forma: nově ${todo.length} zápasů, hráčů ${Object.keys(form.p).length}`);

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
    // videa se na NHL objevují se zpožděním – zápas z posledních 2 dní bez videí načteme znovu
    let entry = old && old.sig === sig && old.goals && old.gs !== undefined && (old.vd || g.date < addDays(today, -2)) ? old : null;
    if (!entry) {
      try {
        const [box, land] = cache.get(g.id) || await Promise.all([nhl.boxscore(g.id), nhl.landing(g.id)]);
        if (!cache.get(g.id)) cache.set(g.id, [box, land]);
        const goals = L.parseGoals(land);
        let rc = old?.rc || null, gs;
        try { const rr = await nhl.rightRail(g.id); if (rr?.gameVideo?.threeMinRecap) rc = `https://www.nhl.com/gamecenter/${g.id}`; gs = L.gameStats(rr); } catch {}
        entry = { pl: L.appearances(st, g, L.parseGame(box, land)), goals, sig, rc, vd: !!rc && goals.every((x) => x.v), gs, stars: L.threeStars(land) };
      } catch (e) { console.log(`Zápas ${g.id}: ${e.message}`); entry = { pl: old?.pl || [], goals: old?.goals || [], sig: "" }; }
    }
    (days[g.date] ||= []).push({ id: g.id, start: g.start, away: g.away, home: g.home, as: g.as, hs: g.hs, last: g.last, pl: entry.pl, goals: entry.goals, sig: entry.sig,
      ...(entry.rc ? { rc: entry.rc } : {}), ...(entry.vd ? { vd: true } : {}), ...(entry.gs !== undefined ? { gs: entry.gs } : {}), ...(entry.stars?.length ? { stars: entry.stars } : {}) });
  }
  // sestavy a formace (střídání) zápasů za 7 dní
  const luSnap = await fs.doc("public/lineups").get();
  const lu = luSnap.exists ? { g: luSnap.data().g || {} } : { g: {} };
  const luTodo = finals.filter((g) => { const x = lu.g[String(g.id)]; return !x || (!x.ok && g.date >= addDays(today, -2)); });
  for (let i = 0; i < luTodo.length; i += 6) {
    await Promise.all(luTodo.slice(i, i + 6).map(async (g) => {
      try {
        const box = cache.get(g.id)?.[0] || await nhl.boxscore(g.id);
        let sh = null; try { sh = await nhl.shiftcharts(g.id); } catch {}
        const t = L.lineups(box, sh);
        lu.g[String(g.id)] = { date: g.date, start: g.start, ok: Object.values(t).some((x) => x.f.length), t };
      } catch (e) { console.log(`Sestava ${g.id}: ${e.message}`); }
    }));
  }
  lu.g = Object.fromEntries(Object.entries(lu.g).filter(([, x]) => x.date >= winFrom));
  const lastG = {};
  for (const [id, x] of Object.entries(lu.g).sort((a, b) => a[1].start.localeCompare(b[1].start))) for (const tm of Object.keys(x.t || {})) lastG[tm] = id;
  console.log(`Sestavy: nově ${luTodo.length}, s formacemi ${Object.values(lu.g).filter((x) => x.ok).length}/${Object.keys(lu.g).length}`);
  let ts = {};
  try { const byName = new Map((await nhl.teamStats(season)).map((x) => [String(x.name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(), x]));
    for (const t of table) { const x = byName.get(String(t.n).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()); if (x) ts[t.t] = { pp: x.pp, pk: x.pk }; } } catch (e) { console.log("Statistiky týmů:", e.message); }
  // Bobovka – vyhodnocení tipů odehraných zápasů
  let bob = null;
  try {
    const bSnap = await fs.doc("bobovka/state").get();
    const tips = await tipsSince(fs, addDays(today, -4) + "T00:00:00Z");
    bob = L.settleBobovka(bSnap.exists ? bSnap.data() : {}, tips, seasonList);
    console.log(`Bobovka: tipů ${tips.length}, vyhodnocených zápasů ${Object.keys(bob.games).length}, jackpot ${bob.jackpot} Kč`);
  } catch (e) { console.log("Bobovka:", e.message); }
  const all = Object.values(days).flat();
  console.log(`Zápasy za 7 dní: ${all.length}, gólů: ${all.reduce((t, g) => t + (g.goals?.length || 0), 0)}, nástupů našich hráčů: ${all.reduce((t, g) => t + (g.pl?.length || 0), 0)}`);
  const extra = {
    "meta/state": st.meta,
    "public/pool": { ...L.encodePool(pool), updated: now },
    "public/upcoming": { games: upcoming.sort((a, b) => a.start.localeCompare(b.start)), updated: now },
    "public/results": { days, updated: now },
    "public/standings": { teams: table, form: L.teamForm(formGames), games: L.seasonGames(seasonList), ts, updated: now },
    "public/lineups": { g: lu.g, last: lastG, updated: now },
    ...(bob ? { "bobovka/state": { ...bob, updated: now } } : {}),
    "public/form": { v: 1, p: form.p, games: form.games, inj: (espn || []).map((x) => `${x.name}|${x.status}`), updated: now },
  };
  if (DRY) { console.log("DRY – neukládám.", [...st.dirty], st.feed); return; }
  console.log(`Zápisů: ${await save(fs, st, extra)}`);
}

export async function main(fs, m = mode) { await (m === "seed" ? seed(fs) : m === "months" ? months(fs) : sync(fs)); }
if (import.meta.url === `file://${process.argv[1]}`) await main(db());
