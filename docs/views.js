// Vykreslení obrazovek. Čisté funkce: S = data z Firestore, U = stav rozhraní.
export const POSL = { F: "Ú", D: "O", G: "B" };
const POSN = { F: "útočník", D: "obránce", G: "brankář" };
const POSNP = { F: "útočníci", D: "obránci", G: "brankáři" };
const MONTHS = ["Leden", "Únor", "Březen", "Duben", "Květen", "Červen", "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec"];
const SLOTS = [{ key: "F1", pos: "F", label: "Útok 1" }, { key: "F2", pos: "F", label: "Útok 2" }, { key: "F3", pos: "F", label: "Útok 3" }, { key: "D1", pos: "D", label: "Obrana" }, { key: "G1", pos: "G", label: "Brankář" }];
export const slotLabel = (k) => SLOTS.find((s) => s.key === k)?.label || k;

export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtKc = (n) => n.toLocaleString("cs-CZ") + " Kč";
const signKc = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toLocaleString("cs-CZ") + " Kč";
const balCls = (n) => (n > 0 ? "plus" : n < 0 ? "owe" : "");
export const nyDate = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
export const monthLabel = (k) => `${MONTHS[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;
const fDay = (d) => d.toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague", weekday: "long", day: "numeric", month: "numeric" });
const fTime = (d) => d.toLocaleTimeString("cs-CZ", { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit" });
const fDT = (iso) => iso ? new Date(iso).toLocaleString("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const ago = (iso) => { const h = (Date.now() - Date.parse(iso)) / 36e5; return h < 1 ? "před chvílí" : h < 24 ? `před ${Math.floor(h)} h` : `před ${Math.floor(h / 24)} d`; };
const short = (n) => String(n).split(" ").slice(-1)[0];

const col = (S, o) => S.league?.colors?.[o] || "#475569";
export const ownChip = (S, o) => o ? `<span class="chip oc" style="background:${col(S, o)}">${esc(o)}</span>` : `<span class="tag free">VOLNÝ</span>`;

// --- odvozená data ---
export const openInj = (S, owner, slot) => S.injuries.find((i) => i.active && i.owner === owner && i.slot === slot);
export function ownership(S) {
  const m = new Map();
  for (const [o, r] of Object.entries(S.rosters)) for (const sl of r.slots || []) { m.set(sl.base.id, o); if (sl.sub) m.set(sl.sub.id, o); }
  return m;
}
// hráči zabraní potvrzenými sestavami, odeslanými (pending) sestavami a čekajícími výběry náhradníků
export function reserved(S, exceptOwner) {
  const m = ownership(S);
  for (const rp of Object.values(S.rosterPicks)) {
    if (rp.owner === exceptOwner || rp.status !== "pending" || S.rosters[rp.owner]?.locked) continue;
    for (const p of Object.values(rp.players || {})) if (p?.id && !m.has(p.id)) m.set(p.id, rp.owner);
  }
  for (const pk of S.picks) if (pk.status === "pending" && !m.has(pk.playerId)) m.set(pk.playerId, pk.owner);
  return m;
}
function activeOf(S, owner, sl) {
  const inj = openInj(S, owner, sl.key);
  return inj ? (sl.sub || null) : sl.base;
}
export function poolList(S, pos) {
  const P = S.pool; if (!P) return [];
  if (pos === "G") return P.goalies.map((r) => ({ id: r[0], name: r[1], team: r[2], pos: "G", gp: r[3], w: r[4], l: r[5], ot: r[6], gaa: r[7], sv: r[8], so: r[9], score: r[9] * 100 + r[4] }));
  return P.skaters.map((r) => ({ id: r[0], name: r[1], team: r[2], code: r[3], pos: r[3] === "D" ? "D" : "F", gp: r[4], g: r[5], a: r[6], pts: r[5] + r[6], score: r[5] + r[6] }))
    .filter((p) => !pos || p.pos === pos);
}
export function standings(S, mk) {
  const m = S.months[mk], owners = S.league?.owners || [];
  const rows = owners.map((o) => ({ owner: o, pts: m?.owners?.[o]?.pts || 0, players: Object.entries(m?.owners?.[o]?.players || {}).map(([id, p]) => ({ id, ...p })).sort((a, b) => b.pts - a.pts) }))
    .sort((a, b) => b.pts - a.pts);
  const L = rows[0]?.pts || 0, n = rows.length, sum = rows.reduce((t, x) => t + x.pts, 0), kc = S.league?.kc || 5;
  rows.forEach((x) => { x.gap = L - x.pts; x.leader = x.pts === L; x.bal = kc * (n * x.pts - sum); });
  return rows;
}

// --- picker hráčů (sestava i náhradník) ---
function picker(S, U, ctx, pos, taken) {
  const q = (U.q[ctx] || "").toLowerCase();
  const list = poolList(S, pos).filter((p) => !q || p.name.toLowerCase().includes(q) || p.team.toLowerCase() === q).sort((a, b) => b.score - a.score).slice(0, pos === "G" ? 999 : 40);
  const sel = U.sel[ctx];
  return `<div class="picker">
    <input class="srch" id="q-${ctx}" data-ctx="${ctx}" placeholder="Hledat jméno nebo tým (např. EDM)…" value="${esc(U.q[ctx] || "")}" autocomplete="off">
    <div class="tname">${POSNP[pos]} NHL seřazení podle ${pos === "G" ? "nul a výher" : "bodů"} v sezóně · zašedlé už má někdo jiný</div>
    <div class="list">${list.map((p) => { const t = taken.get(p.id); return `<label class="opt ${t ? "taken" : ""}">
      <input type="radio" name="r-${ctx}" data-act="sel" data-ctx="${ctx}" data-id="${p.id}" ${sel === p.id ? "checked" : ""} ${t ? "disabled" : ""}>
      <span>${esc(p.name)} <span class="nhl">${p.team}</span> ${t ? ownChip(S, t) : ""}</span>
      <span class="num">${pos === "G" ? `${p.so} nul · ${p.w} V` : `${p.g}+${p.a} = ${p.pts}`}</span></label>`; }).join("") || `<div class="tname">Nic nenalezeno.</div>`}</div>
  </div>`;
}

// --- Tabulka ---
function vAlert(S, U) {
  const act = S.injuries.filter((i) => i.active); if (!act.length) return "";
  const mine = act.filter((i) => i.owner === U.me && i.needPick);
  return `<div class="panel alert ${mine.length ? "urgent" : ""}" data-act="tab" data-tab="zraneni" role="button" tabindex="0">
    <div class="ico ${mine.length ? "warn" : "info"}">!</div>
    <div class="nb"><b>${mine.length ? `Musíš vybrat náhradníka za ${mine.map((i) => esc(i.player.name)).join(", ")}` : `Zranění v lize: ${act.length}`}</b>
    <div class="tname">${act.map((i) => `${esc(short(i.player.name))} (${esc(i.owner)})${i.sub ? " → " + esc(short(i.sub.name)) : " · čeká"}`).join(" · ")}</div></div>
    <span class="go">Zranění ›</span></div>`;
}
function setupAlert(S, U) {
  const r = S.rosters[U.me]; if (!r || r.locked) return "";
  return `<div class="panel alert urgent" data-act="tab" data-tab="tymy" role="button" tabindex="0"><div class="ico warn">!</div>
    <div class="nb"><b>Ještě nemáš sestavu</b><div class="tname">Vyber si 3 útočníky, obránce a brankáře v záložce Týmy.</div></div><span class="go">Týmy ›</span></div>`;
}
export function vTabulka(S, U) {
  const mk = U.month, s = standings(S, mk), L = s[0]?.pts || 0;
  if (!s.length) return `<div class="panel empty">Liga ještě není založená.</div>`;
  return setupAlert(S, U) + vAlert(S, U) + `<div class="summary">
    <div class="panel stat"><div class="k">Vede ${monthLabel(mk).split(" ")[0].toLowerCase()}</div><div class="v">${esc(s.filter((x) => x.leader).map((x) => x.owner).join(", "))}</div><div class="s">${L} bodů · ${signKc(s[0].bal)}</div></div>
    <div class="panel stat"><div class="k">Nejvíc platí</div><div class="v">${esc(s[s.length - 1].owner)}</div><div class="s">${signKc(s[s.length - 1].bal)}</div></div>
    <div class="panel stat"><div class="k">Součet bodů ligy</div><div class="v">${s.reduce((t, x) => t + x.pts, 0)}</div><div class="s">${S.months[mk]?.locked ? "uzavřený měsíc" : "průběžný stav"}</div></div>
  </div>
  <div class="panel scroll"><table>
    <thead><tr><th></th><th>Hráč</th><th class="hide-sm"></th><th class="num">Body</th><th class="num">Ztráta</th><th class="num">Bilance</th></tr></thead>
    <tbody>${s.map((x, i) => { const o = U.openT.has(x.owner); return `<tr class="${x.leader ? "leader" : ""} row" data-act="toggleT" data-o="${esc(x.owner)}">
      <td class="rank">${i + 1}</td>
      <td><button class="nm"><span class="own">${esc(x.owner)}</span> <span class="car">${o ? "▾" : "▸"}</span></button></td>
      <td class="hide-sm" style="width:26%"><div class="bar"><i style="width:${L ? (x.pts / L) * 100 : 0}%"></i></div></td>
      <td class="num pts">${x.pts}</td>
      <td class="num">${x.leader ? '<span class="chip win">lídr</span>' : "−" + x.gap}</td>
      <td class="num ${balCls(x.bal)}"><b>${signKc(x.bal)}</b></td></tr>
      ${o ? `<tr class="sub"><td></td><td colspan="5">${x.players.length ? `<table class="mini"><tbody>${x.players.map((p) => `<tr>
        <td><span class="pos ${p.pos}">${POSL[p.pos]}</span></td>
        <td>${esc(p.name)} <span class="nhl">${esc(p.team)}</span> ${p.role === "sub" ? '<span class="tag sub">náhradník</span>' : ""}</td>
        <td class="num tname">${p.pos === "G" ? p.so + " nul" : p.g + " G"}</td><td class="num tname">${p.a} A</td>
        <td class="num"><b>${p.pts}</b></td></tr>`).join("")}</tbody></table>` : `<div class="tname">Zatím žádné body.</div>`}</td></tr>` : ""}`; }).join("")}</tbody>
  </table></div>
  <p class="note">Bilance = 5 Kč × (počet hráčů × moje body − součet bodů všech). Plus dostáváš, minus platíš.</p>`;
}

// --- Zápasy (odehrané 7 dní / nadcházející 7 dní) ---
const statTxt = (e) => e.pos === "G" ? [e.so ? "nula" : "", e.a ? e.a + " A" : ""].filter(Boolean).join(" · ") || "bez bodu"
  : [e.g ? e.g + " G" : "", e.a ? e.a + " A" : ""].filter(Boolean).join(" · ") || "bez bodu";
const dayLabel = (date) => new Date(date + "T12:00:00Z").toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "numeric" });
export function vDen(S, U) {
  const mode = U.games || "past";
  const seg = `<div class="seg"><button class="btn ${mode === "past" ? "pri" : ""}" data-act="games" data-k="past">Odehrané</button><button class="btn ${mode === "next" ? "pri" : ""}" data-act="games" data-k="next">Nadcházející</button></div>`;
  if (mode === "past") {
    const days = Object.entries(S.results?.days || {}).sort((a, b) => b[0].localeCompare(a[0]));
    if (!days.length) return `<div class="dayhead"><h2>Zápasy</h2></div>${seg}<div class="panel empty">Výsledky se načtou při další synchronizaci.</div>`;
    return `<div class="dayhead"><h2>Zápasy</h2><span class="tname">datum podle času NHL</span></div>${seg}
    ${days.map(([date, gs]) => {
      const per = {}; for (const g of gs) for (const e of g.pl || []) per[e.owner] = (per[e.owner] || 0) + e.pts;
      const sums = Object.entries(per).sort((a, b) => b[1] - a[1]);
      return `<h3 class="mh">${dayLabel(date)}</h3>
      ${sums.length ? `<div class="daysum">${sums.map(([o, p]) => `<span class="who2">${ownChip(S, o)} <b>+${p}</b></span>`).join("")}</div>` : ""}
      <div class="games">${[...gs].sort((a, b) => (b.pl?.length || 0) - (a.pl?.length || 0) || a.start.localeCompare(b.start)).map((g) => {
        const win = g.as > g.hs ? "a" : g.hs > g.as ? "h" : "";
        return `<div class="panel game ${g.pl?.length ? "" : "dim"}">
        <div class="gt"><span class="match"><span class="${win === "a" ? "" : "lose"}">${g.away}</span> <span class="score">${g.as ?? "–"} : ${g.hs ?? "–"}</span> <span class="${win === "h" ? "" : "lose"}">${g.home}</span></span>
        ${g.last === "OT" ? '<span class="chip">pp</span>' : g.last === "SO" ? '<span class="chip">sn</span>' : ""}
        <span class="tname">${g.pl?.length ? g.pl.length + " našich" : "nikdo z nás"}</span></div>
        ${g.goals?.length ? `<div class="goals">${g.goals.map((gl) => { const ow = (id) => (g.pl || []).find((e) => e.id === id)?.owner;
          const nm = (p) => { const o = ow(p.id); return o ? `<span class="ours" style="--oc:${col(S, o)}">${esc(p.n)}</span>` : esc(p.n); };
          return `<div class="goal"><span class="gtime">${gl.p >= 4 ? "prodl." : gl.p + ". tř."} ${gl.t}</span><span class="gteam ${gl.team === g.away ? "" : "home"}">${gl.team}</span>
          <span class="gwho"><b>${nm(gl.s)}</b>${gl.a?.length ? ` <span class="tname">(${gl.a.map(nm).join(", ")})</span>` : ""}${gl.k ? ` <span class="chip">${{PP:"přesilovka",SH:"oslabení",EN:"prázdná brána"}[gl.k] || gl.k}</span>` : ""}</span></div>`; }).join("")}</div>` : ""}
        ${g.pl?.length ? `<div class="glist">${[...g.pl].sort((a, b) => b.pts - a.pts).map((e) => `<div class="grow"><span class="pos ${e.pos}">${POSL[e.pos]}</span>
          <span class="gname">${esc(short(e.name))} <span class="nhl">${e.team}</span></span><span class="tname">${statTxt(e)}</span>
          ${ownChip(S, e.owner)}<b class="gpts ${e.pts ? "" : "zero"}">${e.pts ? "+" + e.pts : "0"}</b></div>`).join("")}</div>` : ""}
      </div>`; }).join("")}</div>`; }).join("")}`;
  }
  const byTeam = new Map();
  for (const [o, r] of Object.entries(S.rosters)) for (const sl of r.slots || []) {
    const a = activeOf(S, o, sl); if (!a) continue;
    if (!byTeam.has(a.team)) byTeam.set(a.team, []);
    byTeam.get(a.team).push({ own: o, n: a.name, pos: sl.pos, t: a.team });
  }
  const groups = {};
  for (const g of S.upcoming?.games || []) {
    const d = new Date(g.start), k = fDay(d);
    (groups[k] ||= []).push({ d, ...g, pl: [...(byTeam.get(g.away) || []), ...(byTeam.get(g.home) || [])] });
  }
  return `<div class="dayhead"><h2>Zápasy</h2><span class="tname">časy v našem čase</span></div>${seg}
  ${Object.keys(groups).length ? Object.entries(groups).map(([day, gs]) => `<h3 class="mh">${day}</h3><div class="games">${gs.map((g) => `<div class="panel game ${g.pl.length ? "" : "dim"}">
    <div class="gt"><span class="time">${fTime(g.d)}</span><span class="match">${g.away} <span class="tname">@</span> ${g.home}</span><span class="tname">${g.pl.length ? g.pl.length + " našich" : "nikdo z nás"}</span></div>
    ${g.pl.length ? `<div class="gp">${g.pl.map((p) => `<span class="who2"><span class="pos ${p.pos}">${POSL[p.pos]}</span> ${esc(short(p.n))} <span class="nhl">${p.t}</span> ${ownChip(S, p.own)}</span>`).join("")}</div>` : ""}
  </div>`).join("")}</div>`).join("") : `<div class="panel empty">Rozpis se načte při další synchronizaci.</div>`}`;
}

// --- Týmy ---
function builder(S, U) {
  const rp = S.rosterPicks[U.me] || { players: {} }, chosen = rp.players || {};
  const taken = reserved(S, U.me);
  const ids = new Set(Object.values(chosen).map((p) => p?.id).filter(Boolean));
  const full = SLOTS.every((s) => chosen[s.key]?.id);
  const st = rp.status === "pending" ? `<div class="status">Sestava odeslaná – potvrdí se při další synchronizaci (nejpozději do hodiny).</div>`
    : rp.status === "rejected" ? `<div class="status bad">Sestavu nešlo potvrdit: ${esc(rp.reason)}. Uprav ji a potvrď znovu.</div>` : "";
  return `<div class="panel team builder" style="padding:14px">
    <div><h3 style="font-family:var(--display);font-size:24px;text-transform:uppercase;margin:0">Moje sestava</h3>
    <div class="tname">Vyber 3 útočníky, 1 obránce a 1 brankáře. Každý hráč NHL může být jen v jednom týmu – rozhoduje, kdo dřív potvrdí. Sestava potvrzená do 31. 10. se počítá zpětně od začátku sezóny, později až od potvrzení.</div></div>
    ${st}
    <div class="panel">${SLOTS.map((s) => { const p = chosen[s.key]; const open = U.slotOpen === s.key; return `<div class="slotrow">
      <span class="pos ${s.pos}">${POSL[s.pos]}</span>
      <div class="nb"><div class="tname">${s.label}</div>${p?.id ? `<b>${esc(p.name)}</b> <span class="nhl">${esc(p.team)}</span>` : `<span class="tname">nevybráno</span>`}</div>
      <button class="btn sm ${open ? "" : "pri"}" data-act="slot" data-k="${s.key}" ${rp.status === "pending" ? "disabled" : ""}>${open ? "Zavřít" : p?.id ? "Změnit" : "Vybrat"}</button>
      ${open ? `<div style="flex-basis:100%">${picker(S, U, "slot-" + s.key, s.pos, new Map([...taken, ...[...ids].filter((id) => id !== p?.id).map((id) => [id, U.me])]))}
        <button class="btn pri" style="margin-top:8px" data-act="slotok" data-k="${s.key}" ${U.sel["slot-" + s.key] ? "" : "disabled"}>Dát na pozici ${s.label}</button></div>` : ""}
    </div>`; }).join("")}</div>
    <div class="acts">${rp.status === "pending" ? `<button class="btn" data-act="unconfirm">Upravit sestavu</button>` : `<button class="btn pri" data-act="confirm" ${full ? "" : "disabled"}>Potvrdit sestavu</button>`}</div>
  </div>`;
}
export function vTymy(S, U) {
  const mk = U.month, m = S.months[mk];
  const owners = S.league?.owners || [];
  const me = S.rosters[U.me];
  return `${me && !me.locked ? builder(S, U) : ""}
  <div class="teams" style="margin-top:12px">${owners.map((o) => {
    const r = S.rosters[o] || {}, mp = m?.owners?.[o]?.players || {};
    if (!r.locked) return `<div class="panel team"><div class="th"><div><h3>${esc(o)}</h3></div>${ownChip(S, o)}</div>
      <div class="empty">${S.rosterPicks[o]?.status === "pending" ? "Sestava odeslaná, čeká na potvrzení." : "Sestavu zatím nevybral."}</div></div>`;
    const tot = m?.owners?.[o]?.pts || 0;
    return `<div class="panel team"><div class="th"><div><h3>${esc(o)}</h3></div><div class="pts">${tot}</div></div>
      ${r.slots.map((sl) => { const inj = openInj(S, o, sl.key), a = activeOf(S, o, sl);
        const bp = mp[sl.base.id]?.pts || 0, spt = sl.sub ? mp[sl.sub.id]?.pts || 0 : 0;
        const line = (id) => { const p = mp[id] || { g: 0, a: 0, so: 0, gp: 0 };
          return `<div class="mstat">${sl.pos === "G" ? `${p.so} ${p.so === 1 ? "nula" : p.so >= 2 && p.so <= 4 ? "nuly" : "nul"} · ${p.a} A` : `${p.g} G · ${p.a} A`}${p.gp ? ` · ${p.gp} záp.` : ""}</div>`; };
        return `<div class="slotrow"><span class="pos ${sl.pos}">${POSL[sl.pos]}</span>
          <div class="nb"><div>${esc(sl.base.name)} <span class="nhl">${sl.base.team}</span> ${inj ? '<span class="tag inj">ZRANĚN</span>' : ""}</div>
          ${line(sl.base.id)}
          ${sl.sub ? `<div>${esc(sl.sub.name)} <span class="nhl">${sl.sub.team}</span> <span class="tag sub">náhradník</span> <span class="num">${spt} b.</span></div>${line(sl.sub.id)}` : inj ? `<div class="err">čeká na náhradníka</div>` : ""}
          ${inj && sl.bank > 0 ? `<div class="gamesc">${inj.baseBack ? `${esc(short(sl.base.name))} je zpět – náhradník dohraje ještě ${sl.bank}` : `v bance ${sl.bank} ${sl.bank === 1 ? "zápas" : sl.bank < 5 ? "zápasy" : "zápasů"} pro náhradníka`}</div>` : ""}
          <div class="gamesc">${slotLabel(sl.key)} · ${sl.games}/82 zápasů</div></div>
          <div class="num"><b>${bp}</b></div></div>`; }).join("")}
    </div>`; }).join("")}</div>
  <p class="note">Body jsou za vybraný měsíc (${monthLabel(mk)}). Počítadlo zápasů běží za celou sezónu, po 82 zápasech místo přestane bodovat.</p>`;
}

// --- Zranění ---
function injCard(S, U, i) {
  const mine = i.owner === U.me, ctx = "inj-" + i.id;
  const myPick = S.picks.find((p) => p.status === "pending" && p.injuryId === i.id);
  const hrs = Math.max(0, Math.round((Date.parse(i.deadline) - Date.now()) / 36e5));
  let body = "";
  if (i.sub) body = `<div><span class="tag sub">náhradník</span> <b>${esc(i.sub.name)}</b> <span class="nhl">${i.sub.team}</span> hraje za ${esc(short(i.player.name))}. Až se ${esc(short(i.player.name))} vrátí, automaticky se vrací do sestavy.</div>`;
  else if (myPick) body = `<div class="status">Vybraný ${esc(myPick.name)} – potvrdí se při další synchronizaci (do hodiny).</div>`;
  else if (mine) {
    const open = U.pickOpen === i.id;
    body = `<div class="must">Vyber náhradníka (${POSN[i.pos]}) – zbývá ${hrs} h. Pak se automaticky nasadí nejlepší volný hráč.</div>
    <div class="acts"><button class="btn pri" data-act="pickopen" data-id="${i.id}">${open ? "Zavřít výběr" : "Vybrat náhradníka"}</button></div>
    ${open ? picker(S, U, ctx, i.pos, reserved(S, null)) + `<button class="btn pri" style="margin-top:8px" data-act="pickok" data-id="${i.id}" ${U.sel[ctx] ? "" : "disabled"}>Potvrdit náhradníka</button>` : ""}`;
  } else body = `<div class="tname">Čeká, až ${esc(i.owner)} vybere náhradníka – zbývá ${hrs} h.</div>`;
  return `<div class="panel notice ${!i.sub && mine && !myPick ? "urgent" : ""}"><div class="ico ${i.sub ? "info" : "warn"}">${i.sub ? "⇄" : "!"}</div><div class="nb">
    <div class="ihead"><span class="pos ${i.pos}">${POSL[i.pos]}</span> <b>${esc(i.player.name)}</b> <span class="nhl">${i.player.team}</span> ${ownChip(S, i.owner)} <span class="tag inj">ZRANĚN</span></div>
    <div class="tname">${[i.status, i.ret, `vynechal ${i.missed} ${i.missed === 1 ? "zápas" : i.missed < 5 ? "zápasy" : "zápasů"}`, `od ${fDT(i.openedAt)}`].filter(Boolean).map(esc).join(" · ")}</div>
    ${i.bankMode && i.bank > 0 ? `<div class="bankline">${i.baseBack ? `${esc(short(i.player.name))} se vrátil – náhradník dohraje ještě <b>${i.bank}</b> ${i.bank === 1 ? "zápas" : i.bank < 5 ? "zápasy" : "zápasů"}` : `V bance <b>${i.bank}</b> ${i.bank === 1 ? "zápas" : i.bank < 5 ? "zápasy" : "zápasů"} – náhradník je odehraje`}</div>` : ""}
    ${body}
    <div class="acts"><a class="btn sm" href="https://www.tsn.ca/nhl/injuries" target="_blank" rel="noopener">Ověřit na TSN</a></div>
  </div></div>`;
}
export function vZraneni(S, U) {
  const act = S.injuries.filter((i) => i.active).sort((a, b) => (b.owner === U.me) - (a.owner === U.me));
  return `<div class="dayhead"><h2>Zranění</h2><span class="tname">přihlášen jako <b>${esc(U.me)}</b> · náhradníka vybírá jen majitel</span></div>
  <div class="notes">${act.length ? act.map((i) => injCard(S, U, i)).join("") : `<div class="panel empty">Nikdo z vašich hráčů teď není zraněný.</div>`}</div>
  <h3 class="mh">Oznámení</h3>
  <div class="panel feed">${S.feed.length ? S.feed.map((f) => `<div class="frow"><span class="ico ${f.kind === "warn" ? "warn" : f.kind === "back" ? "info" : "ok"} s">${f.kind === "warn" ? "!" : f.kind === "back" ? "↩" : "✓"}</span><div class="nb">${esc(f.txt)}</div><span class="tname">${ago(f.ts)}</span></div>`).join("") : `<div class="empty">Zatím žádná oznámení.</div>`}</div>
  <div class="panel rules"><h4>Jak to funguje</h4><ul>
    <li>Když hráč vynechá zápas svého týmu, majitel hned dostane výzvu vybrat náhradníka. Brankář se počítá jen při zranění (když není na soupisce zápasu), ne když chytá dvojka.</li>
    <li>Každý vynechaný zápas jde do banky. Náhradník banku odehrává – vynechal-li hráč 4 zápasy, náhradník odehraje 4.</li>
    <li>Když se hráč vrátí dřív, než náhradník banku odehraje, náhradník ji dohraje a pak automaticky končí. Každé místo tak má na konci 82 zápasů.</li>
    <li>Náhradníka vybírá jen majitel, ze stejné pozice a jen volného hráče. Na výběr je 48 h, pak se nasadí nejlepší volný hráč. Kdo vybere dřív, má přednost.</li>
    <li>Když se zraní i náhradník (vynechá 2 zápasy), vybírá se další.</li>
  </ul></div>`;
}

// --- NHL body ---
export function vNhl(S, U) {
  if (!S.pool) return `<div class="panel empty">Statistiky se načtou při první synchronizaci.</div>`;
  const own = ownership(S);
  const SK = { pts: (r) => r.pts, g: (r) => r.g, a: (r) => r.a };
  const cmp = (a, b) => SK[U.sortK](b) - SK[U.sortK](a) || b.pts - a.pts || b.g - a.g;
  const f = (r) => !U.onlyFree || !own.has(r.id);
  const sk = poolList(S, null);
  const all = [...sk].sort(cmp).filter(f).slice(0, 50);
  const fw = sk.filter((r) => r.pos === "F").sort(cmp).filter(f).slice(0, 10);
  const df = sk.filter((r) => r.pos === "D").sort(cmp).filter(f).slice(0, 10);
  const GK = { w: (r) => r.w, so: (r) => r.so, sv: (r) => (r.gp >= 3 ? r.sv || 0 : 0), gaa: (r) => (r.gp >= 3 && r.gaa != null ? -r.gaa : -99) };
  const glAll = poolList(S, "G").sort((a, b) => GK[U.sortG](b) - GK[U.sortG](a) || b.w - a.w).filter(f);
  const gl = U.allG ? glAll : glAll.slice(0, 10);
  const thG = (k, l) => `<th class="num"><button class="sortb ${U.sortG === k ? "on" : ""}" data-act="sortg" data-k="${k}">${l}${U.sortG === k ? " ▾" : ""}</button></th>`;
  const thS = (k, l) => `<th class="num"><button class="sortb ${U.sortK === k ? "on" : ""}" data-act="sort" data-k="${k}">${l}${U.sortK === k ? " ▾" : ""}</button></th>`;
  const tbl = (rows) => `<div class="panel scroll"><table><thead><tr><th></th><th>Hráč</th><th class="num">Z</th>${thS("g", "G")}${thS("a", "A")}${thS("pts", "B")}<th>Majitel</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr><td class="rank" style="font-size:17px">${i + 1}</td><td><span class="pos ${r.pos}">${POSL[r.pos]}</span> ${esc(r.name)} <span class="nhl">${r.team}</span></td>
    <td class="num">${r.gp}</td><td class="num">${r.g}</td><td class="num">${r.a}</td><td class="num pts" style="font-size:19px">${r.pts}</td><td>${ownChip(S, own.get(r.id))}</td></tr>`).join("")}</tbody></table></div>`;
  const owners = S.league?.owners || [];
  return `<div class="dayhead"><h2>Kanadské bodování NHL</h2>
    <label class="opt" style="padding:6px 10px"><input type="checkbox" id="onlyFree" data-act="free" ${U.onlyFree ? "checked" : ""}><span>Jen volní hráči</span></label></div>
  <div class="seg"><span class="tname">Řadit podle:</span>${[["pts", "Body"], ["g", "Góly"], ["a", "Asistence"]].map(([k, l]) => `<button class="btn ${U.sortK === k ? "pri" : ""}" data-act="sort" data-k="${k}">${l}</button>`).join("")}</div>
  <div class="legend">${owners.map((o) => ownChip(S, o)).join("")}${ownChip(S, null)}</div>
  <div class="jump"><a href="#top50" class="btn">Top 50</a><a href="#topf" class="btn">Útočníci</a><a href="#topd" class="btn">Obránci</a><a href="#topg" class="btn">Brankáři</a></div>
  <h3 class="mh" id="top50">Top 50 hráčů</h3>${tbl(all)}
  <h3 class="mh" id="topf">Top 10 útočníků</h3>${tbl(fw)}
  <h3 class="mh" id="topd">Top 10 obránců</h3>${tbl(df)}
  <h3 class="mh" id="topg">${U.allG ? `Všichni brankáři (${glAll.length})` : "Top 10 brankářů"}</h3>
  <div class="panel scroll"><table><thead><tr><th></th><th>Brankář</th><th class="num">Z</th>${thG("w", "V")}<th class="num">P</th><th class="num">PvP</th>${thG("gaa", "GAA")}${thG("sv", "Úsp.")}${thG("so", "Nuly")}<th>Majitel</th></tr></thead>
  <tbody>${gl.map((r, i) => `<tr><td class="rank" style="font-size:17px">${i + 1}</td><td><span class="pos G">B</span> ${esc(r.name)} <span class="nhl">${r.team}</span></td>
    <td class="num">${r.gp}</td><td class="num"><b>${r.w}</b></td><td class="num">${r.l}</td><td class="num">${r.ot}</td><td class="num">${r.gaa ?? "–"}</td><td class="num">${r.sv != null ? r.sv.toFixed(3).replace(/^0/, "") : "–"}</td><td class="num"><b>${r.so}</b></td><td>${ownChip(S, own.get(r.id))}</td></tr>`).join("")}</tbody></table></div>
  <div class="acts" style="margin-top:10px"><button class="btn pri" data-act="allg">${U.allG ? "Zobrazit jen top 10" : `Zobrazit všechny brankáře (${glAll.length})`}</button></div>
  <p class="note">Řadit jde kliknutím na V, GAA, Úsp. nebo Nuly. U GAA a úspěšnosti se počítají jen brankáři s aspoň 3 zápasy.</p>`;
}

// --- Vyúčtování ---
export function vVyuct(S, U) {
  const kc = S.league?.kc || 5, today = nyDate();
  const keys = Object.keys(S.months).sort().reverse();
  const detail = (s) => {
    const pays = (x) => s.filter((y) => y.pts > x.pts).map((y) => ({ to: y.owner, d: y.pts - x.pts }));
    return `<div class="mbody">
    <div class="panel scroll"><table><thead><tr><th></th><th>Hráč</th><th class="num">Body</th><th class="num">Bilance</th></tr></thead>
    <tbody>${s.map((x, i) => `<tr class="${x.leader ? "leader" : ""}"><td class="rank">${i + 1}</td><td class="own">${esc(x.owner)}</td><td class="num pts">${x.pts}</td><td class="num ${balCls(x.bal)}"><b>${signKc(x.bal)}</b></td></tr>`).join("")}</tbody></table></div>
    <h3 class="mh">Kdo komu platí</h3>
    <div class="pay">${s.map((x) => { const p = pays(x), out = p.reduce((t, q) => t + q.d * kc, 0), inn = x.bal + out;
      return `<div class="panel payrow"><div style="min-width:0"><div class="who">${esc(x.owner)}</div>
        <div class="tname">${p.length ? "platí: " + p.map((q) => `${esc(q.to)} ${q.d}×${kc} = ${q.d * kc} Kč`).join(" · ") : "nikomu neplatí"}</div>
        <div class="tname">dostane: ${fmtKc(inn)} · platí: ${fmtKc(out)}</div></div><div class="kc ${balCls(x.bal)}">${signKc(x.bal)}</div></div>`; }).join("")}</div>
    <div class="panel scroll" style="margin-top:12px"><table class="matrix"><thead><tr><th>platí ↓ / dostává →</th>${s.map((y) => `<th class="num">${esc(y.owner)}</th>`).join("")}</tr></thead>
    <tbody>${s.map((x) => `<tr><td class="own">${esc(x.owner)}</td>${s.map((y) => `<td class="num">${y.pts > x.pts ? (y.pts - x.pts) * kc : '<span class="tname">·</span>'}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
  };
  return `<div class="months">${keys.map((k) => { const s = standings(S, k), o = U.openM.has(k), pd = !!S.months[k].paid, closed = S.months[k].locked || today.slice(0, 7) > k;
    return `<div class="panel month-card"><div class="mrow" data-act="mopen" data-m="${k}" role="button" tabindex="0">
      <div><div class="mname">${monthLabel(k)} <span class="car">${o ? "▾" : "▸"}</span></div>
      <div class="tname">${closed ? "uzavřeno" : "průběžně – uzavře se poslední den měsíce (čas NHL)"} · vede ${esc(s[0]?.owner)} ${signKc(s[0]?.bal || 0)}</div></div>
      ${closed ? `<button class="btn ${pd ? "paidb" : "pri"}" data-act="paid" data-m="${k}">${pd ? "✓ Vyplaceno" : "Označit jako vyplaceno"}</button>` : ""}
    </div>${o ? detail(s) : ""}</div>`; }).join("")}</div>
  <div class="panel rules"><h4>Pravidla</h4><ul>
    <li>Útočník: gól 2 b., asistence 1 b. Obránce: gól 3 b., asistence 1 b. Brankář: čisté konto 5 b., asistence 1 b.</li>
    <li>Každý platí každému, kdo je nad ním, ${kc} Kč za každý bod rozdílu. Na konci měsíce se body nulují.</li>
    <li>Měsíc se uzavírá poslední den měsíce podle času NHL. Zápas hraný v Americe 31. večer (u nás už 1. ráno) patří ještě do starého měsíce.</li>
    <li>Každé místo v sestavě boduje maximálně 82 zápasů. Jen základní část.</li>
  </ul></div>`;
}
