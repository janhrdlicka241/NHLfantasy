// Čistá herní logika – bez sítě a databáze, aby šla testovat.
export const SLOTS = [
  { key: "F1", pos: "F" }, { key: "F2", pos: "F" }, { key: "F3", pos: "F" },
  { key: "D1", pos: "D" }, { key: "G1", pos: "G" },
];
export const MAX_GAMES = 82;
export const DEADLINE_H = 48;
export const MISS_LIMIT = { F: 2, D: 2, G: 3 }; // brankáři sedí častěji, proto 3

export const fantasyPos = (code) => (code === "D" ? "D" : code === "G" ? "G" : "F");
export function points(pos, g, a, so) {
  if (pos === "F") return 2 * g + a;
  if (pos === "D") return 3 * g + a;
  return a + 5 * so;
}
// datum zápasu podle NHL (Amerika); zářijové zápasy na začátku sezóny patří do října
export const monthKey = (nhlDate) => (nhlDate.slice(5, 7) === "09" ? nhlDate.slice(0, 4) + "-10" : nhlDate.slice(0, 7));

let idSeq = 0;
const genId = () => `${Date.now().toString(36)}${(idSeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function newState(base) {
  return {
    league: base.league, rosters: base.rosters || {}, rosterPicks: base.rosterPicks || {},
    picks: base.picks || [], injuries: base.injuries || [], months: base.months || {},
    meta: base.meta || {}, feed: [], dirty: new Set(), log: [],
  };
}
const mark = (st, path) => st.dirty.add(path);
const feed = (st, ts, kind, txt, owner = null) => st.feed.push({ ts, kind, txt, owner });

// --- vlastnictví ---
export function ownedIds(st, exceptOwner = null) {
  const s = new Set();
  for (const [o, r] of Object.entries(st.rosters)) {
    if (o === exceptOwner || !r.slots) continue;
    for (const sl of r.slots) { if (sl.base?.id) s.add(sl.base.id); if (sl.sub?.id) s.add(sl.sub.id); }
  }
  return s;
}
export const openInjury = (st, owner, slotKey) => st.injuries.find((i) => i.active && i.owner === owner && i.slot === slotKey);

// --- pool: { skaters:[[id,name,team,posCode,gp,g,a]], goalies:[[id,name,team,gp,w,l,ot,gaa,sv,so]] } ---
// Doplní do poolu hráče ze soupisek, kteří ještě nemají statistiky; u ostatních aktualizuje tým
export function mergeRosters(pool, roster) {
  const sk = new Map(pool.skaters.map((r) => [r[0], r])), go = new Map(pool.goalies.map((r) => [r[0], r]));
  let added = 0;
  for (const p of roster) {
    if (!p.id || !p.name) continue;
    if (p.pos === "G") {
      if (go.has(p.id)) go.get(p.id)[2] = p.team;
      else { const r = [p.id, p.name, p.team, 0, 0, 0, 0, null, null, 0]; pool.goalies.push(r); go.set(p.id, r); added++; }
    } else {
      if (sk.has(p.id)) sk.get(p.id)[2] = p.team;
      else { const r = [p.id, p.name, p.team, p.pos, 0, 0, 0]; pool.skaters.push(r); sk.set(p.id, r); added++; }
    }
  }
  return added;
}
export function poolIndex(pool) {
  const m = new Map();
  for (const r of pool.skaters) m.set(r[0], { id: r[0], name: r[1], team: r[2], pos: fantasyPos(r[3]), score: r[5] + r[6] });
  for (const r of pool.goalies) m.set(r[0], { id: r[0], name: r[1], team: r[2], pos: "G", score: r[9] * 100 + r[4] });
  return m;
}
export function bestFree(st, idx, pos) {
  const owned = ownedIds(st);
  let best = null;
  for (const p of idx.values()) if (p.pos === pos && !owned.has(p.id) && (!best || p.score > best.score)) best = p;
  return best;
}

// Aktualizace týmů NHL (výměny hráčů mezi kluby)
export function refreshTeams(st, idx) {
  for (const [o, r] of Object.entries(st.rosters)) for (const sl of r.slots || []) {
    for (const k of ["base", "sub"]) {
      const p = sl[k] && idx.get(sl[k].id);
      if (p && p.team && p.team !== sl[k].team) { sl[k].team = p.team; mark(st, `rosters/${o}`); }
    }
  }
}

// --- 1) potvrzení základních sestav ---
export function applyRosterPicks(st, idx, teamGP, now) {
  const pending = Object.values(st.rosterPicks).filter((p) => p.status === "pending" && p.confirmedAt)
    .sort((a, b) => a.confirmedAt.localeCompare(b.confirmedAt));
  for (const rp of pending) {
    const owner = rp.owner, roster = st.rosters[owner];
    if (!roster || roster.locked) { rp.status = "rejected"; rp.reason = "Sestava už je potvrzená."; mark(st, `rosterPicks/${owner}`); continue; }
    const owned = ownedIds(st, owner), seen = new Set(), errs = [], slots = [];
    for (const s of SLOTS) {
      const pid = rp.players?.[s.key]?.id, p = pid && idx.get(pid);
      if (!p) { errs.push(`${s.key}: chybí hráč`); continue; }
      if (p.pos !== s.pos) { errs.push(`${p.name} nehraje na pozici ${s.pos}`); continue; }
      if (owned.has(p.id) || seen.has(p.id)) { errs.push(`${p.name} už má někdo jiný`); continue; }
      seen.add(p.id);
      slots.push({ key: s.key, pos: s.pos, base: { id: p.id, name: p.name, team: p.team }, sub: null,
        games: Math.min(teamGP[p.team] || 0, MAX_GAMES), activeFrom: now, baseMissed: 0, subMissed: 0 });
    }
    if (errs.length) {
      rp.status = "rejected"; rp.reason = errs.join(" · ");
      feed(st, now, "warn", `${owner}: sestavu nešlo potvrdit – ${rp.reason}. Uprav ji a potvrď znovu.`, owner);
    } else {
      roster.slots = slots; roster.locked = true; roster.lockedAt = now;
      rp.status = "ok";
      feed(st, now, "ok", `${owner} potvrdil sestavu: ${slots.map((s) => s.base.name).join(", ")}.`, owner);
      mark(st, `rosters/${owner}`);
    }
    mark(st, `rosterPicks/${owner}`);
  }
}

// --- 2) výběry náhradníků ---
function assignSub(st, inj, p, now, how) {
  const roster = st.rosters[inj.owner], slot = roster.slots.find((s) => s.key === inj.slot);
  slot.sub = { id: p.id, name: p.name, team: p.team, since: now }; slot.subMissed = 0;
  inj.needPick = false; inj.sub = { id: p.id, name: p.name, team: p.team };
  mark(st, `rosters/${inj.owner}`); mark(st, `injuries/${inj.id}`);
  feed(st, now, "ok", how === "auto"
    ? `${inj.owner}: lhůta vypršela, automaticky nasazen ${p.name} (${p.team}) za ${inj.player.name}.`
    : `${inj.owner}: ${p.name} (${p.team}) nastupuje za ${inj.player.name} od dalšího zápasu.`, inj.owner);
}
export function applyPicks(st, idx, now) {
  for (const pk of [...st.picks].filter((p) => p.status === "pending").sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const inj = st.injuries.find((i) => i.id === pk.injuryId && i.active);
    const p = idx.get(pk.playerId);
    let reason = null;
    if (!inj) reason = "Zranění už není aktivní.";
    else if (inj.owner !== pk.owner) reason = "Náhradníka vybírá jen majitel týmu.";
    else if (!inj.needPick) reason = "Náhradník už je vybraný.";
    else if (!p) reason = "Hráč nenalezen.";
    else if (p.pos !== inj.pos) reason = `${p.name} nehraje na správné pozici.`;
    else if (ownedIds(st).has(p.id)) reason = `${p.name} už má někdo jiný.`;
    if (reason) {
      pk.status = "rejected"; pk.reason = reason;
      if (inj) feed(st, now, "warn", `${pk.owner}: výběr ${pk.name} neprošel – ${reason}`, pk.owner);
    } else { pk.status = "ok"; assignSub(st, inj, p, now, "pick"); }
    mark(st, `picks/${pk.id}`);
  }
}
export function applyDeadlines(st, idx, now) {
  for (const inj of st.injuries) {
    if (!inj.active || !inj.needPick || inj.deadline > now) continue;
    const p = bestFree(st, idx, inj.pos);
    if (p) assignSub(st, inj, p, now, "auto");
  }
}

// --- 3) zpracování odehraného zápasu ---
// game: {id, date:"YYYY-MM-DD" (NHL), start: ISO, away, home}
// box: odpověď /gamecenter/{id}/boxscore, landing: /gamecenter/{id}/landing
export function parseGame(box, landing) {
  const lineup = new Set(), so = new Set(), ga = new Map();
  const pbs = box.playerByGameStats || {};
  for (const side of ["awayTeam", "homeTeam"]) {
    const t = pbs[side] || {};
    for (const p of [...(t.forwards || []), ...(t.defense || [])]) lineup.add(p.playerId);
    const played = [];
    for (const g of t.goalies || []) {
      lineup.add(g.playerId);
      if (g.toi && g.toi !== "00:00") played.push(g);
    }
    if (played.length === 1 && (played[0].goalsAgainst ?? 1) === 0) so.add(played[0].playerId);
  }
  const ga2 = new Map(); // id -> {g,a}
  const add = (id, k) => { const r = ga2.get(id) || { g: 0, a: 0 }; r[k]++; ga2.set(id, r); };
  for (const per of landing?.summary?.scoring || []) {
    if (per.periodDescriptor?.periodType === "SO") continue;
    for (const goal of per.goals || []) {
      if (goal.playerId) add(goal.playerId, "g");
      for (const as of goal.assists || []) if (as.playerId) add(as.playerId, "a");
    }
  }
  return { lineup, so, stats: ga2 };
}

// Góly zápasu pro záložku Zápasy: [{p (třetina, 4+ = prodl.), t, team, s:{id,n}, a:[{id,n}], k: PP|SH|EN}]
export function parseGoals(landing) {
  const nm = (o) => o?.lastName?.default || o?.name?.default || "";
  const out = [];
  for (const per of landing?.summary?.scoring || []) {
    if (per.periodDescriptor?.periodType === "SO") continue;
    const p = per.periodDescriptor?.number || 0;
    for (const g of per.goals || []) {
      const st = (g.strength || "").toLowerCase();
      const k = g.goalModifier === "empty-net" ? "EN" : st === "pp" ? "PP" : st === "sh" ? "SH" : null;
      out.push({ p, t: g.timeInPeriod || "", team: g.teamAbbrev?.default || g.teamAbbrev || "",
        s: { id: g.playerId, n: nm(g) }, a: (g.assists || []).map((x) => ({ id: x.playerId, n: nm(x) })), ...(k ? { k } : {}) });
    }
  }
  return out;
}

// Kdo z našich hráčů v zápase nastoupil a kolik by dostal bodů (jen pro zobrazení v záložce Zápasy)
export function appearances(st, game, parsed) {
  const { lineup, so, stats } = parsed, out = [];
  for (const [owner, roster] of Object.entries(st.rosters)) {
    if (!roster.locked) continue;
    for (const slot of roster.slots) {
      if (game.start <= slot.activeFrom) continue;
      const cand = slot.sub && game.start > slot.sub.since && lineup.has(slot.sub.id) ? slot.sub : lineup.has(slot.base.id) ? slot.base : null;
      if (!cand) continue;
      const s = stats.get(cand.id) || { g: 0, a: 0 };
      const shut = slot.pos === "G" && so.has(cand.id) ? 1 : 0, g = slot.pos === "G" ? 0 : s.g;
      out.push({ owner, id: cand.id, name: cand.name, team: cand.team, pos: slot.pos, g, a: s.a, so: shut, pts: points(slot.pos, g, s.a, shut) });
    }
  }
  return out;
}

function addMonth(st, date, owner, who, slot, role, g, a, so, pts) {
  const key = monthKey(date);
  const m = st.months[key] ||= { key, owners: {}, paid: false };
  if (m.locked) return false; // uzavřený měsíc (říjen z Excelu)
  const o = m.owners[owner] ||= { pts: 0, players: {} };
  const p = o.players[who.id] ||= { name: who.name, team: who.team, pos: slot.pos, slot: slot.key, role, gp: 0, g: 0, a: 0, so: 0, pts: 0 };
  p.gp++; p.g += g; p.a += a; p.so += so; p.pts += pts; p.team = who.team; o.pts += pts;
  mark(st, `months/${key}`);
  return true;
}

// Zpětné započítání: sestavy potvrzené do konce října se počítají od začátku sezóny.
// retro = { fromIso, untilIso, month }  → vrací množinu majitelů, které je potřeba přepočítat
export function prepareRetro(st, retro) {
  const owners = new Set();
  // říjen z Excelu se nahrazuje skutečnými body ze sestav
  if (st.months[retro.month]?.locked) { st.months[retro.month] = { key: retro.month, owners: {}, paid: false }; mark(st, `months/${retro.month}`); }
  for (const [owner, roster] of Object.entries(st.rosters)) {
    if (!roster.locked || roster.retroDone === retro.version || !(roster.lockedAt < retro.untilIso)) continue;
    for (const sl of roster.slots) { sl.activeFrom = retro.fromIso; sl.games = 0; sl.baseMissed = 0; sl.subMissed = 0; sl.basePlayed = 0; }
    roster.retroDone = retro.version;
    const m = st.months[retro.month];
    if (m?.owners?.[owner]) { delete m.owners[owner]; mark(st, `months/${retro.month}`); }
    owners.add(owner); mark(st, `rosters/${owner}`);
  }
  return owners;
}

// Ruční úpravy (seed/manual.json):
//  points: pevné body připsané do měsíce (říjnoví náhradníci z Excelu)
//  subs:   náhradník nasazený ručně za základního hráče od teď
export function applyManual(st, manual, idx, now) {
  const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  for (const m of manual.points || []) {
    const mon = st.months[m.month] ||= { key: m.month, owners: {}, paid: false };
    const o = mon.owners[m.owner] ||= { pts: 0, players: {} };
    const key = "rucne-" + norm(m.name).replace(/[^a-z0-9]+/g, "-");
    const pts = points(m.pos, m.g || 0, m.a || 0, m.so || 0);
    const old = o.players[key];
    if (old && old.pts === pts && old.g === (m.g || 0) && old.a === (m.a || 0)) continue;
    if (old) o.pts -= old.pts;
    o.players[key] = { name: m.name, team: m.team || "", pos: m.pos, role: "sub", manual: true, gp: null, g: m.g || 0, a: m.a || 0, so: m.so || 0, pts };
    o.pts += pts; mark(st, `months/${m.month}`);
  }
  for (const s of manual.subs || []) {
    if (s.afterBaseGames != null) continue; // řeší applyManualPre při přepočtu
    const key = `${s.owner}|${s.replaces}|${s.sub}|${s.subGames ?? ""}`;
    if ((st.meta.manualDone || []).includes(key)) continue;
    const roster = st.rosters[s.owner];
    if (!roster?.locked) { st.log.push({ warn: `Ruční náhradník ${s.sub}: ${s.owner} ještě nemá potvrzenou sestavu.` }); continue; }
    let slot;
    if (s.replaces === "auto" && now >= "2026-11-01T04:00:00Z") { (st.meta.manualDone ||= []).push(key); continue; } // jen pro říjen
    if (s.replaces === "auto") {
      // za toho hráče na stejné pozici, který teď nehraje (nejvíc vynechaných zápasů v řadě)
      const free = roster.slots.filter((x) => x.pos === s.pos && !x.sub && x.baseMissed > 0).sort((a, b) => b.baseMissed - a.baseMissed);
      slot = free[0];
      if (!slot) { st.log.push({ info: `Ruční náhradník ${s.sub} (${s.owner}): všichni hráči na pozici ${s.pos} teď hrají – náhradník není potřeba.` }); continue; }
    } else slot = roster.slots.find((x) => norm(x.base.name).endsWith(norm(s.replaces)));
    if (!slot) { st.log.push({ warn: `Ruční náhradník: ${s.owner} nemá v sestavě ${s.replaces}.` }); (st.meta.manualDone ||= []).push(key); continue; }
    const cands = [...idx.values()].filter((p) => p.pos === slot.pos && norm(p.name).endsWith(norm(s.sub)));
    const p = cands.find((x) => !s.team || x.team === s.team) || cands[0];
    if (!p) { st.log.push({ warn: `Ruční náhradník ${s.sub} nenalezen.` }); continue; }
    const ownOther = roster.slots.some((x) => x !== slot && (x.base.id === p.id || x.sub?.id === p.id));
    if (ownedIds(st, s.owner).has(p.id) || ownOther) { st.log.push({ warn: `Ruční náhradník ${p.name} už má někdo jiný.` }); (st.meta.manualDone ||= []).push(key); continue; }
    let inj = openInjury(st, s.owner, slot.key);
    if (!inj) {
      inj = { id: genId(), owner: s.owner, slot: slot.key, pos: slot.pos, player: { ...slot.base }, needPick: false, sub: null,
        openedAt: now, since: now, deadline: now, missed: slot.baseMissed, status: "", ret: "", active: true };
      st.injuries.push(inj);
    }
    slot.sub = { id: p.id, name: p.name, team: p.team, since: now }; slot.subMissed = 0;
    inj.needPick = false; inj.sub = { id: p.id, name: p.name, team: p.team };
    if (s.subGames != null) {
      // banka hned: kolik zápasů základní hráč vynechal mínus kolik jich náhradník už odehrál
      slot.bank = Math.max(0, (s.baseMissed ?? slot.baseMissed ?? 0) - s.subGames);
      slot.bankInit = true; slot.bankMode = true; inj.bankMode = true; inj.bank = slot.bank; inj.baseBack = false;
      st.log.push({ info: `${s.owner}: ${slot.base.name} vynechal ${s.baseMissed ?? slot.baseMissed} zápasů, ${p.name} jich odehrál ${s.subGames} → v bance ${slot.bank}.` });
    }
    mark(st, `rosters/${s.owner}`); mark(st, `injuries/${inj.id}`);
    feed(st, now, "ok", `${s.owner}: ${p.name} (${p.team}) hraje za ${slot.base.name}, který vynechal posledních ${slot.baseMissed} zápasů (zadáno ručně).`, s.owner);
    (st.meta.manualDone ||= []).push(key);
  }
}

// Ruční náhradník „po N zápasech základního hráče“ (např. Barkov odehrál 2, pak Eichel):
// nastaví se před přepočtem a nasadí se v okamžiku prvního zápasu po N odehraných.
function installPending(st, owner, slot, game, now) {
  const p = slot.pendingSub;
  const since = new Date(Date.parse(game.start) - 1000).toISOString();
  const inj = { id: genId(), owner, slot: slot.key, pos: slot.pos, player: { ...slot.base }, needPick: false,
    sub: { id: p.id, name: p.name, team: p.team }, openedAt: since, since, deadline: since, missed: 0,
    status: "", ret: "", active: true, bankMode: true, bank: 0, manual: true };
  st.injuries.push(inj);
  slot.sub = { id: p.id, name: p.name, team: p.team, since, ...(p.pointsFrom ? { pointsFrom: p.pointsFrom } : {}) }; slot.subMissed = 0;
  slot.bankMode = true; slot.bankInit = true; slot.bank = 0;
  p.installed = true;
  mark(st, `injuries/${inj.id}`); mark(st, `rosters/${owner}`);
}
export function applyManualPre(st, manual, idx, retroOwners, now) {
  const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  for (const s of manual.subs || []) {
    if (s.afterBaseGames == null || !retroOwners.has(s.owner)) continue;
    const roster = st.rosters[s.owner];
    const slot = roster?.slots?.find((x) => norm(x.base.name).endsWith(norm(s.replaces)));
    if (!slot) { st.log.push({ warn: `Ruční náhradník: ${s.owner} nemá v sestavě ${s.replaces}.` }); continue; }
    const p = [...idx.values()].find((x) => x.pos === slot.pos && norm(x.name).endsWith(norm(s.sub)) && (!s.team || x.team === s.team));
    if (!p) { st.log.push({ warn: `Ruční náhradník ${s.sub} nenalezen.` }); continue; }
    // dřívější ruční nasazení téhož náhradníka zrušit – přepočet ho nastaví znovu správně
    for (const inj of st.injuries) if (inj.active && inj.owner === s.owner && inj.slot === slot.key) { inj.active = false; inj.closedAt = now; mark(st, `injuries/${inj.id}`); }
    slot.sub = null; slot.bank = 0; slot.bankMode = false; slot.bankInit = false; slot.basePlayed = 0;
    slot.pendingSub = { id: p.id, name: p.name, team: p.team, after: s.afterBaseGames, ...(s.pointsFrom ? { pointsFrom: s.pointsFrom } : {}) };
    mark(st, `rosters/${s.owner}`);
    st.log.push({ info: `${s.owner}: ${p.name} nastoupí za ${slot.base.name} po jeho ${s.afterBaseGames}. zápase.` });
  }
}

// opts.only = jen tito majitelé (zpětný přepočet), opts.quiet = neotvírat zranění (staré zápasy)
// --- Od listopadu: banka vynechaných zápasů ---
// Každý vynechaný zápas základního hráče (brankáře jen když není na soupisce zápasu) přidá 1 do banky,
// náhradník banku odehraje. Po návratu základního hráče náhradník dohraje zbytek banky a končí.
export const BANK_FROM = "2026-11-01";
function credit(st, game, parsed, owner, who, slot, role) {
  if (slot.games >= MAX_GAMES) return;
  slot.games++;
  if (role === "sub" && slot.sub?.pointsFrom && game.start < slot.sub.pointsFrom) return; // body za tyto zápasy jsou z Excelu
  const { so, stats } = parsed, s = stats.get(who.id) || { g: 0, a: 0 };
  const shut = slot.pos === "G" && so.has(who.id) ? 1 : 0, g = slot.pos === "G" ? 0 : s.g;
  const pts = points(slot.pos, g, s.a, shut);
  if (addMonth(st, game.date, owner, who, slot, role, g, s.a, shut, pts))
    st.log.push({ date: game.date, gameId: game.id, owner, id: who.id, name: who.name, team: who.team, pos: slot.pos, g, a: s.a, so: shut, pts });
}
function bankSlot(st, game, parsed, now, owner, slot, opts) {
  const teams = [game.away, game.home], { lineup } = parsed;
  if (!slot.bankInit) { slot.bank = 0; slot.bankInit = true; } // banka začíná 1. 11. na nule – říjen už je započítaný
  slot.bank ||= 0;
  let inj = openInjury(st, owner, slot.key);
  if (inj?.since && game.start <= inj.since) inj = null;
  const dl = () => new Date(Date.parse(now) + DEADLINE_H * 3600e3).toISOString();
  if (teams.includes(slot.base.team)) {
    mark(st, `rosters/${owner}`);
    if (lineup.has(slot.base.id)) {
      slot.baseMissed = 0; slot.basePlayed = (slot.basePlayed || 0) + 1;
      if (inj && !inj.baseBack) {
        inj.baseBack = true; mark(st, `injuries/${inj.id}`);
        if (slot.bank > 0 && slot.sub) feed(st, now, "back", `${slot.base.name} (${owner}) se vrátil – ${slot.sub.name} dohraje ještě ${slot.bank} ${slot.bank === 1 ? "zápas" : slot.bank < 5 ? "zápasy" : "zápasů"}.`, owner);
      }
      credit(st, game, parsed, owner, slot.base, slot, "base");
    } else {
      slot.baseMissed++; slot.bank++;
      if (!inj) {
        inj = { id: genId(), owner, slot: slot.key, pos: slot.pos, player: { ...slot.base }, needPick: true, sub: null,
          openedAt: now, deadline: dl(), missed: 1, status: "", ret: "", active: true, bankMode: true };
        st.injuries.push(inj);
        feed(st, now, "warn", `${slot.base.name} (${owner}) vynechal zápas – vyber náhradníka.`, owner);
      } else { inj.baseBack = false; inj.missed = (inj.missed || 0) + 1; }
      inj.bank = slot.bank; mark(st, `injuries/${inj.id}`);
    }
  }
  if (inj && slot.sub && game.start > slot.sub.since && teams.includes(slot.sub.team)) {
    const canUse = slot.bank > 0 || (!inj.baseBack && (opts.later || []).includes(slot.base.team));
    if (canUse) {
      mark(st, `rosters/${owner}`);
      if (lineup.has(slot.sub.id)) { slot.subMissed = 0; slot.bank--; credit(st, game, parsed, owner, slot.sub, slot, "sub"); }
      else if (++slot.subMissed >= MISS_LIMIT[slot.pos]) {
        feed(st, now, "warn", `Náhradník ${slot.sub.name} (${owner}) vynechal ${slot.subMissed} zápasy – vyber dalšího náhradníka za ${slot.base.name}.`, owner);
        inj.needPick = true; inj.sub = null; inj.deadline = dl(); slot.sub = null;
      }
      inj.bank = slot.bank; mark(st, `injuries/${inj.id}`);
    }
  }
  if (inj && inj.baseBack && slot.bank <= 0) {
    inj.active = false; inj.closedAt = now; inj.bank = 0; mark(st, `injuries/${inj.id}`); mark(st, `rosters/${owner}`);
    feed(st, now, "back", slot.sub ? `${slot.sub.name} (${owner}) odehrál zápasy za ${slot.base.name} a končí – je znovu volný.` : `${slot.base.name} (${owner}) je zpátky v sestavě.`, owner);
    slot.sub = null; slot.bank = 0;
  }
}

export function processGame(st, game, parsed, now, opts = {}) {
  const teams = [game.away, game.home];
  const { lineup, so, stats } = parsed;
  for (const [owner, roster] of Object.entries(st.rosters)) {
    if (!roster.locked) continue;
    if (opts.only && !opts.only.has(owner)) continue;
    for (const slot of roster.slots) {
      if (game.start <= slot.activeFrom) continue; // zápas před potvrzením sestavy
      if (slot.pendingSub && !slot.pendingSub.installed && (slot.basePlayed || 0) >= slot.pendingSub.after && [game.away, game.home].includes(slot.base.team)) {
        installPending(st, owner, slot, game, now);
      }
      if (game.date >= BANK_FROM || slot.bankMode) { bankSlot(st, game, parsed, now, owner, slot, opts); continue; }
      let touched = false;
      let inj = openInjury(st, owner, slot.key);
      if (inj?.since && game.start <= inj.since) inj = null; // ručně zadané zranění platí až od zadání
      // základní hráč: návrat / vynechání
      if (teams.includes(slot.base.team)) {
        touched = true;
        if (lineup.has(slot.base.id)) {
          slot.baseMissed = 0; slot.basePlayed = (slot.basePlayed || 0) + 1;
          if (inj) {
            inj.active = false; inj.closedAt = now; mark(st, `injuries/${inj.id}`);
            feed(st, now, "back", `${slot.base.name} (${owner}) se vrátil do sestavy${slot.sub ? ` – ${slot.sub.name} končí a je znovu volný` : ""}.`, owner);
            slot.sub = null; inj = null;
          }
        } else {
          slot.baseMissed++;
          if (!inj && !opts.quiet && slot.baseMissed >= MISS_LIMIT[slot.pos]) {
            inj = { id: genId(), owner, slot: slot.key, pos: slot.pos, player: { ...slot.base }, needPick: true, sub: null,
              openedAt: now, deadline: new Date(Date.parse(now) + DEADLINE_H * 3600e3).toISOString(),
              missed: slot.baseMissed, status: "", ret: "", active: true };
            st.injuries.push(inj); mark(st, `injuries/${inj.id}`);
            feed(st, now, "warn", `${slot.base.name} (${owner}) vynechal ${slot.baseMissed} zápasy – vyber náhradníka do 48 h.`, owner);
          } else if (inj) { inj.missed = slot.baseMissed; mark(st, `injuries/${inj.id}`); }
        }
      }
      // náhradník: vynechání
      const subLive = slot.sub && game.start > slot.sub.since;
      if (subLive && teams.includes(slot.sub.team)) {
        touched = true;
        if (lineup.has(slot.sub.id)) slot.subMissed = 0;
        else if (++slot.subMissed >= MISS_LIMIT[slot.pos] && inj) {
          feed(st, now, "warn", `Náhradník ${slot.sub.name} (${owner}) vynechal ${slot.subMissed} zápasy – vyber dalšího náhradníka za ${slot.base.name} do 48 h.`, owner);
          inj.needPick = true; inj.sub = null; inj.deadline = new Date(Date.parse(now) + DEADLINE_H * 3600e3).toISOString();
          mark(st, `injuries/${inj.id}`); slot.sub = null;
        }
      }
      // kdo za místo hraje a čí zápasy se počítají
      const active = inj ? (slot.sub && game.start > slot.sub.since ? slot.sub : null) : slot.base;
      const countTeam = active ? active.team : slot.base.team;
      if (touched) mark(st, `rosters/${owner}`);
      if (!teams.includes(countTeam) || slot.games >= MAX_GAMES) continue;
      slot.games++; mark(st, `rosters/${owner}`);
      if (active && lineup.has(active.id)) {
        const s = stats.get(active.id) || { g: 0, a: 0 };
        const shut = slot.pos === "G" && so.has(active.id) ? 1 : 0;
        const g = slot.pos === "G" ? 0 : s.g; // gól brankáře zatím nebodujeme
        const pts = points(slot.pos, g, s.a, shut);
        const added = addMonth(st, game.date, owner, active, slot, active === slot.base ? "base" : "sub", g, s.a, shut, pts);
        if (added) st.log.push({ date: game.date, gameId: game.id, owner, id: active.id, name: active.name, team: active.team, pos: slot.pos, g, a: s.a, so: shut, pts });
      }
    }
  }
}

// ESPN: doplnění důvodu a odhadu návratu ke zraněním
export function enrichInjuries(st, espnList) {
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const map = new Map(espnList.map((e) => [norm(e.name), e]));
  for (const inj of st.injuries) {
    if (!inj.active) continue;
    const e = map.get(norm(inj.player.name));
    if (e && (e.status !== inj.status || e.ret !== inj.ret)) { inj.status = e.status; inj.ret = e.ret; mark(st, `injuries/${inj.id}`); }
  }
}
