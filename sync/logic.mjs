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
export const monthKey = (nhlDate) => nhlDate.slice(0, 7); // datum zápasu podle NHL (Amerika)

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
    if (!roster.locked || roster.retroDone || !(roster.lockedAt < retro.untilIso)) continue;
    for (const sl of roster.slots) { sl.activeFrom = retro.fromIso; sl.games = 0; sl.baseMissed = 0; sl.subMissed = 0; }
    roster.retroDone = true;
    const m = st.months[retro.month];
    if (m?.owners?.[owner]) { delete m.owners[owner]; mark(st, `months/${retro.month}`); }
    owners.add(owner); mark(st, `rosters/${owner}`);
  }
  return owners;
}

// opts.only = jen tito majitelé (zpětný přepočet), opts.quiet = neotvírat zranění (staré zápasy)
export function processGame(st, game, parsed, now, opts = {}) {
  const teams = [game.away, game.home];
  const { lineup, so, stats } = parsed;
  for (const [owner, roster] of Object.entries(st.rosters)) {
    if (!roster.locked) continue;
    if (opts.only && !opts.only.has(owner)) continue;
    for (const slot of roster.slots) {
      if (game.start <= slot.activeFrom) continue; // zápas před potvrzením sestavy
      let touched = false;
      let inj = openInjury(st, owner, slot.key);
      // základní hráč: návrat / vynechání
      if (teams.includes(slot.base.team)) {
        touched = true;
        if (lineup.has(slot.base.id)) {
          slot.baseMissed = 0;
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
        if (added && pts) st.log.push({ date: game.date, gameId: game.id, owner, id: active.id, name: active.name, team: active.team, pos: slot.pos, g, a: s.a, so: shut, pts });
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
