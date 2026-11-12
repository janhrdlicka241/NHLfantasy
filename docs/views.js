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
// klikací jméno hráče → karta hráče
export const pc = (id, html) => (id ? `<span class="pcl" data-act="pcard" data-id="${id}">${html}</span>` : html);
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
// řádky poolu: nově objekty {i,n,t,…} (Firestore neumí pole v poli), dřív pole
const skRow = (r) => (Array.isArray(r) ? r : [r.i, r.n, r.t, r.p, r.gp, r.g, r.a, r.c || "", r.r || 0]);
const goRow = (r) => (Array.isArray(r) ? r : [r.i, r.n, r.t, r.gp, r.w, r.l, r.ot, r.gaa, r.sv, r.so, r.c || ""]);
export function poolList(S, pos) {
  const P0 = S.pool; if (!P0) return [];
  const P = { skaters: (P0.skaters || []).map(skRow), goalies: (P0.goalies || []).map(goRow) };
  if (pos === "G") return P.goalies.map((r) => ({ id: r[0], name: r[1], team: r[2], pos: "G", gp: r[3], w: r[4], l: r[5], ot: r[6], gaa: r[7], sv: r[8], so: r[9], score: r[9] * 100 + r[4], nat: r[10] || "" }));
  return P.skaters.map((r) => ({ id: r[0], name: r[1], team: r[2], code: r[3], pos: r[3] === "D" ? "D" : "F", gp: r[4], g: r[5], a: r[6], pts: r[5] + r[6], score: r[5] + r[6], nat: r[7] || "", rook: !!r[8] }))
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
    <div class="panel stat"><div class="k">Vede ${monthLabel(mk).split(" ")[0].toLowerCase()}</div><div class="v">${L ? esc(s.filter((x) => x.leader).map((x) => x.owner).join(", ")) : "–"}</div><div class="s">${L ? `${L} bodů · ${signKc(s[0].bal)}` : "zatím nikdo nebodoval"}</div></div>
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
        <td>${pc(+p.id, esc(p.name))} <span class="nhl">${esc(p.team)}</span> ${p.role === "sub" ? '<span class="tag sub">náhradník</span>' : ""}</td>
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
  const isOpen = (g) => U.openG?.has(String(g.id));
  const chipsPts = (pl) => { const per = {}; for (const e of pl || []) per[e.owner] = (per[e.owner] || 0) + e.pts;
    return Object.entries(per).sort((x, y) => y[1] - x[1]).map(([o, p]) => `<span class="oc2" style="background:${col(S, o)}">${esc(o)} +${p}</span>`).join(""); };
  // rozdělení: zápasy s našimi hráči (nebo rozkliknuté) přes celou šířku, ostatní po dvou
  const split = (gs, ours) => [gs.filter((g) => ours(g) || isOpen(g)), gs.filter((g) => !ours(g) && !isOpen(g))];
  if (mode === "past") {
    const days = Object.entries(S.results?.days || {}).sort((a, b) => b[0].localeCompare(a[0]));
    if (!days.length) return `<div class="dayhead"><h2>Zápasy</h2></div>${seg}<div class="panel empty">Výsledky se načtou při další synchronizaci.</div>`;
    const head = (g, mini) => { const win = g.as > g.hs ? "a" : g.hs > g.as ? "h" : "", op = isOpen(g);
      return `<div class="g1h" data-act="gopen" data-id="${g.id}" role="button"><span class="sc"><span class="${win === "a" ? "" : "lose"}">${g.away}</span> ${g.as ?? "–"}:${g.hs ?? "–"} <span class="${win === "h" ? "" : "lose"}">${g.home}</span>${g.last === "OT" ? ' <span class="ot">pp</span>' : g.last === "SO" ? ' <span class="ot">sn</span>' : ""}</span>
        ${mini ? "" : `<span class="who">${chipsPts(g.pl)}</span>`}<span class="ar">${op ? "▾" : "▸"}</span></div>`; };
    const body = (g) => {
      const ow = (id) => (g.pl || []).find((e) => e.id === id)?.owner;
      const nm = (p) => { const o = ow(p.id); return pc(p.id, o ? `<span class="ours" style="--oc:${col(S, o)}">${esc(p.n)}</span>` : esc(p.n)); };
      return `${g.goals?.length ? `<div class="goals">${g.goals.map((gl) => `<div class="goal"><span class="gtime">${gl.p >= 4 ? "prodl." : gl.p + ". tř."} ${gl.t}</span><span class="gteam ${gl.team === g.away ? "" : "home"}">${gl.team}</span>
          <span class="gwho"><b>${nm(gl.s)}</b>${gl.a?.length ? ` <span class="tname">(${gl.a.map(nm).join(", ")})</span>` : ""}${gl.k ? ` <span class="chip">${{ PP: "přesilovka", SH: "oslabení", EN: "prázdná brána" }[gl.k] || gl.k}</span>` : ""}</span>${gl.v ? `<a class="vid ${[gl.s, ...(gl.a || [])].some((p) => ow(p.id)) ? "our" : ""}" href="${esc(gl.v)}" target="_blank" rel="noopener" title="Video gólu">▶</a>` : ""}</div>`).join("")}</div>` : ""}
        ${g.pl?.length ? `<div class="glist">${[...g.pl].sort((a, b) => b.pts - a.pts).map((e) => `<div class="grow"><span class="pos ${e.pos}">${POSL[e.pos]}</span>
          <span class="gname">${pc(e.id, esc(short(e.name)))} <span class="nhl">${e.team}</span></span><span class="tname">${statTxt(e)}</span>
          ${ownChip(S, e.owner)}<b class="gpts ${e.pts ? "" : "zero"}">${e.pts ? "+" + e.pts : "0"}</b></div>`).join("")}</div>` : ""}
        ${pastOpen(S, U, g)}`; };
    return `<div class="dayhead"><h2>Zápasy</h2><span class="tname">datum podle času NHL</span></div>${seg}
    ${days.map(([date, gs]) => {
      const per = {}; for (const g of gs) for (const e of g.pl || []) per[e.owner] = (per[e.owner] || 0) + e.pts;
      const sums = Object.entries(per).sort((a, b) => b[1] - a[1]);
      const [big, small] = split([...gs].sort((a, b) => (b.pl?.length || 0) - (a.pl?.length || 0) || a.start.localeCompare(b.start)), (g) => g.pl?.length);
      return `<h3 class="mh">${dayLabel(date)}</h3>
      ${sums.length ? `<div class="daysum">${sums.map(([o, p]) => `<span class="who2">${ownChip(S, o)} <b>+${p}</b></span>`).join("")}</div>` : ""}
      ${big.map((g) => `<div class="panel g1 ${isOpen(g) ? "open" : ""}">${head(g)}${isOpen(g) ? `<div class="g1b">${body(g)}</div>` : ""}</div>`).join("")}
      ${small.length ? `<div class="mini">${small.map((g) => `<div class="panel g1 dim">${head(g, true)}</div>`).join("")}</div>` : ""}`; }).join("")}`;
  }
  const byTeam = new Map();
  for (const [o, r] of Object.entries(S.rosters)) for (const sl of r.slots || []) {
    const a = activeOf(S, o, sl); if (!a) continue;
    if (!byTeam.has(a.team)) byTeam.set(a.team, []);
    byTeam.get(a.team).push({ id: a.id, own: o, n: a.name, pos: sl.pos, t: a.team });
  }
  const groups = {};
  for (const g of S.upcoming?.games || []) {
    const d = new Date(g.start), k = fDay(d);
    (groups[k] ||= []).push({ d, ...g, pl: [...(byTeam.get(g.away) || []), ...(byTeam.get(g.home) || [])] });
  }
  const head = (g, mini) => `<div class="g1h" data-act="gopen" data-id="${g.id}" role="button"><span class="tm2">${fTime(g.d)}</span><span class="sc">${g.away} <span class="at">@</span> ${g.home}</span>
    ${mini ? "" : `<span class="who">${[...new Set(g.pl.map((p) => p.own))].map((o) => `<span class="oc2" style="background:${col(S, o)}">${esc(o)}</span>`).join("")}</span>`}<span class="ar">${isOpen(g) ? "▾" : "▸"}</span></div>`;
  const body = (g) => `${g.pl.length ? `<div class="gp">${g.pl.map((p) => `<span class="who2"><span class="pos ${p.pos}">${POSL[p.pos]}</span> ${pc(p.id, esc(short(p.n)))} <span class="nhl">${p.t}</span> ${ownChip(S, p.own)}</span>`).join("")}</div>` : ""}${nextOpen(S, U, g)}`;
  return `<div class="dayhead"><h2>Zápasy</h2><span class="tname">časy v našem čase</span></div>${seg}
  ${Object.keys(groups).length ? Object.entries(groups).map(([day, gs]) => { const [big, small] = split(gs, (g) => g.pl.length);
    return `<h3 class="mh">${day}</h3>
    ${big.map((g) => `<div class="panel g1 ${isOpen(g) ? "open" : ""}">${head(g)}${isOpen(g) ? `<div class="g1b">${body(g)}</div>` : ""}</div>`).join("")}
    ${small.length ? `<div class="mini">${small.map((g) => `<div class="panel g1 dim">${head(g, true)}</div>`).join("")}</div>` : ""}`; }).join("") : `<div class="panel empty">Rozpis se načte při další synchronizaci.</div>`}`;
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
    // náhradníci a hráči s body v měsíci, kteří teď nejsou v sestavě (Excel, skončení náhradníci)
    const inSlots = new Set((r.slots || []).flatMap((sl) => [String(sl.base.id), sl.sub ? String(sl.sub.id) : null]));
    const others = Object.entries(mp).filter(([id]) => !inSlots.has(String(id))).map(([id, p]) => p).sort((a, b) => b.pts - a.pts);
    const extra = others.length ? `<div class="xhead">Náhradníci v měsíci</div>${others.map((p) => `<div class="slotrow"><span class="pos ${p.pos}">${POSL[p.pos]}</span>
      <div class="nb"><div>${esc(p.name)} <span class="nhl">${esc(p.team || "")}</span> <span class="tag sub">náhradník</span>${p.manual ? ' <span class="tname">z Excelu</span>' : ""}</div>
      <div class="mstat">${p.pos === "G" ? `${p.so} nul · ${p.a} A` : `${p.g} G · ${p.a} A`}${p.gp ? ` · ${p.gp} záp.` : ""}</div></div>
      <div class="num"><b>${p.pts}</b></div></div>`).join("")}` : "";
    if (!r.locked) return `<div class="panel team"><div class="th"><div><h3>${esc(o)}</h3></div>${others.length ? `<div class="pts">${m?.owners?.[o]?.pts || 0}</div>` : ownChip(S, o)}</div>
      <div class="empty">${S.rosterPicks[o]?.status === "pending" ? "Sestava odeslaná, čeká na potvrzení." : "Sestavu zatím nevybral."}</div>${extra}</div>`;
    const tot = m?.owners?.[o]?.pts || 0;
    return `<div class="panel team"><div class="th"><div><h3>${esc(o)}</h3></div><div class="pts">${tot}</div></div>
      ${r.slots.map((sl) => { const inj = openInj(S, o, sl.key), a = activeOf(S, o, sl);
        const bp = mp[sl.base.id]?.pts || 0, spt = sl.sub ? mp[sl.sub.id]?.pts || 0 : 0;
        const line = (id) => { const p = mp[id] || { g: 0, a: 0, so: 0, gp: 0 };
          return `<div class="mstat">${sl.pos === "G" ? `${p.so} ${p.so === 1 ? "nula" : p.so >= 2 && p.so <= 4 ? "nuly" : "nul"} · ${p.a} A` : `${p.g} G · ${p.a} A`}${p.gp ? ` · ${p.gp} záp.` : ""}</div>`; };
        return `<div class="slotrow"><span class="pos ${sl.pos}">${POSL[sl.pos]}</span>
          <div class="nb"><div>${pc(sl.base.id, esc(sl.base.name))} <span class="nhl">${sl.base.team}</span> ${inj ? '<span class="tag inj">ZRANĚN</span> ' + injToggle(inj, U) : ""}</div>
          ${line(sl.base.id)}
          ${sl.sub ? `<div>${pc(sl.sub.id, esc(sl.sub.name))} <span class="nhl">${sl.sub.team}</span> <span class="tag sub">náhradník</span> <span class="num">${spt} b.</span></div>${line(sl.sub.id)}` : inj ? `<div class="err">čeká na náhradníka</div>` : ""}
          ${inj && sl.bank > 0 ? `<div class="gamesc">${inj.baseBack ? `${esc(short(sl.base.name))} je zpět – náhradník dohraje ještě ${sl.bank}` : `v bance ${sl.bank} ${sl.bank === 1 ? "zápas" : sl.bank < 5 ? "zápasy" : "zápasů"} pro náhradníka`}</div>` : ""}
          <div class="gamesc">${slotLabel(sl.key)} · ${sl.games}/84 zápasů</div>${inj ? injDetail(inj, U) : ""}</div>
          <div class="num"><b>${bp}</b></div></div>`; }).join("")}
      ${extra}
    </div>`; }).join("")}</div>
  <p class="note">Body jsou za vybraný měsíc (${monthLabel(mk)}). Počítadlo zápasů běží za celou sezónu, po 84 zápasech místo přestane bodovat.</p>`;
}

// --- Zranění ---
// Kontrola: zápasy, které základní hráč vynechal, a zápasy, které za něj odehrál náhradník
const zap = (n) => (n === 1 ? "zápas" : n >= 2 && n <= 4 ? "zápasy" : "zápasů");
const dmy = (d) => { const [, m, dd] = d.split("-"); return `${+dd}.${+m}.`; };
function injToggle(i, U) { return `<button class="dtog" data-act="injdet" data-id="${i.id}">${U.openInj.has(i.id) ? "▾" : "▸"} zápasy</button>`; }
export function injDetail(i, U) {
  if (!U.openInj.has(i.id)) return "";
  const ml = i.missedList || [], sl = i.subList || [];
  const subName = short(i.sub?.name || sl[sl.length - 1]?.name || "Náhradník");
  const bank = i.bankMode ? (i.bank || 0) : Math.max(0, ml.length - sl.length);
  const empty = !ml.length && !sl.length;
  const ok = !empty && ml.length === sl.length && bank === 0;
  const sum = empty ? "Seznam zápasů se doplní při další synchronizaci." : ok ? `Vynechal <b>${ml.length}</b> · odehrál <b>${sl.length}</b> · v bance <b>0</b> ✓ sedí`
    : `Vynechal <b>${ml.length}</b> · odehrál <b>${sl.length}</b> · v bance <b>${bank}</b>${bank > 0 ? ` → ${esc(subName)} odehraje ještě ${bank}` : ""}`;
  const stat = (x) => x.excel ? `<span class="x tname">Excel</span>`
    : `<span class="x">${x.so ? "nula " : ""}${x.g ? x.g + "G " : ""}${x.a ? x.a + "A " : ""}<b>${x.pts ? "+" + x.pts : "0"}</b></span>`;
  return `<div class="det">
    <div class="cols">
      <div class="col"><h5><span class="who">${esc(short(i.player.name))}</span> vynechal <span class="n">${ml.length}</span></h5>
        <div class="gl">${ml.map((x) => `<div class="gi miss"><span class="d">${dmy(x.d)}</span><span>${x.opp}</span></div>`).join("") || `<div class="tname">–</div>`}</div></div>
      <div class="col"><h5><span class="who">${esc(subName)}</span> odehrál <span class="n">${sl.length}</span></h5>
        <div class="gl">${sl.map((x) => `<div class="gi play ${x.excel ? "excel" : ""}"><span class="d">${dmy(x.d)}</span><span>${x.opp}</span>${stat(x)}</div>`).join("") || `<div class="tname">–</div>`}</div></div>
    </div>
    <div class="sum ${empty ? "" : ok ? "ok" : "warn"}">${sum}</div>
  </div>`;
}
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
    <div class="acts"><button class="btn pri" data-act="pickopen" data-id="${i.id}">${open ? "Zavřít výběr" : "Vybrat náhradníka"}</button><button class="btn" data-act="bestfree" data-pos="${i.pos}">Nejlepší volní</button></div>
    ${open ? picker(S, U, ctx, i.pos, reserved(S, null)) + `<button class="btn pri" style="margin-top:8px" data-act="pickok" data-id="${i.id}" ${U.sel[ctx] ? "" : "disabled"}>Potvrdit náhradníka</button>` : ""}`;
  } else body = `<div class="tname">Čeká, až ${esc(i.owner)} vybere náhradníka – zbývá ${hrs} h.</div>`;
  return `<div class="panel notice ${!i.sub && mine && !myPick ? "urgent" : ""}"><div class="ico ${i.sub ? "info" : "warn"}">${i.sub ? "⇄" : "!"}</div><div class="nb">
    <div class="ihead"><span class="pos ${i.pos}">${POSL[i.pos]}</span> <b>${esc(i.player.name)}</b> <span class="nhl">${i.player.team}</span> ${ownChip(S, i.owner)} <span class="tag inj">ZRANĚN</span></div>
    <div class="tname">${[i.status, i.ret, `vynechal ${i.missed} ${i.missed === 1 ? "zápas" : i.missed < 5 ? "zápasy" : "zápasů"}`, `od ${fDT(i.openedAt)}`].filter(Boolean).map(esc).join(" · ")}</div>
    ${i.bankMode && i.bank > 0 ? `<div class="bankline">${i.baseBack ? `${esc(short(i.player.name))} se vrátil – náhradník dohraje ještě <b>${i.bank}</b> ${i.bank === 1 ? "zápas" : i.bank < 5 ? "zápasy" : "zápasů"}` : `V bance <b>${i.bank}</b> ${i.bank === 1 ? "zápas" : i.bank < 5 ? "zápasy" : "zápasů"} – náhradník je odehraje`}</div>` : ""}
    ${body}
    <div class="acts">${injToggle(i, U)}<a class="btn sm" href="https://www.tsn.ca/nhl/injuries" target="_blank" rel="noopener">Ověřit na TSN</a></div>
    ${injDetail(i, U)}
  </div></div>`;
}
export function vZraneni(S, U) {
  const act = S.injuries.filter((i) => i.active).sort((a, b) => (b.owner === U.me) - (a.owner === U.me));
  return `<div class="dayhead"><h2>Zranění</h2><span class="tname">přihlášen jako <b>${esc(U.me)}</b> · náhradníka vybírá jen majitel</span></div>
  <div class="notes">${act.length ? act.map((i) => injCard(S, U, i)).join("") : `<div class="panel empty">Nikdo z vašich hráčů teď není zraněný.</div>`}</div>
  ${(() => { const done = S.injuries.filter((i) => i.active === false && i.closedAt && (i.missedList?.length || i.subList?.length)).sort((a, b) => b.closedAt.localeCompare(a.closedAt)).slice(0, 10);
    return done.length ? `<h3 class="mh">Ukončená</h3><div class="notes">${done.map((i) => `<div class="panel notice"><div class="ico ok">✓</div><div class="nb">
      <div class="ihead"><span class="pos ${i.pos}">${POSL[i.pos]}</span> <b>${esc(i.player.name)}</b> <span class="nhl">${i.player.team}</span> ${ownChip(S, i.owner)} <span class="tag sub">vrátil se</span></div>
      <div class="tname">${(i.subList || []).length ? `náhradník ${esc(short(i.subList[i.subList.length - 1].name))} · ` : ""}ukončeno ${fDT(i.closedAt)}</div>
      <div class="acts">${injToggle(i, U)}</div>${injDetail(i, U)}</div></div>`).join("")}</div>` : ""; })()}
  <h3 class="mh">Oznámení</h3>
  <div class="panel feed">${S.feed.length ? S.feed.map((f) => `<div class="frow"><span class="ico ${f.kind === "warn" ? "warn" : f.kind === "back" ? "info" : "ok"} s">${f.kind === "warn" ? "!" : f.kind === "back" ? "↩" : "✓"}</span><div class="nb">${esc(f.txt)}</div><span class="tname">${ago(f.ts)}</span></div>`).join("") : `<div class="empty">Zatím žádná oznámení.</div>`}</div>
  <div class="panel rules"><h4>Jak to funguje</h4><ul>
    <li>Když hráč vynechá zápas svého týmu, majitel hned dostane výzvu vybrat náhradníka. Brankář se počítá jen při zranění (když není na soupisce zápasu), ne když chytá dvojka.</li>
    <li>Každý vynechaný zápas jde do banky. Náhradník banku odehrává – vynechal-li hráč 4 zápasy, náhradník odehraje 4.</li>
    <li>Když se hráč vrátí dřív, než náhradník banku odehraje, náhradník ji dohraje a pak automaticky končí. Každé místo tak má na konci 84 zápasů.</li>
    <li>Náhradníka vybírá jen majitel, ze stejné pozice a jen volného hráče. Na výběr je 48 h, pak se nasadí nejlepší volný hráč. Kdo vybere dřív, má přednost.</li>
    <li>Když se zraní i náhradník (vynechá 2 zápasy), vybírá se další.</li>
  </ul></div>`;
}

// --- NHL body ---
function vHraci(S, U) {
  if (!S.pool) return `<div class="panel empty">Statistiky se načtou při první synchronizaci.</div>`;
  const own = ownership(S);
  const SK = { pts: (r) => r.pts, g: (r) => r.g, a: (r) => r.a };
  const cmp = (a, b) => SK[U.sortK](b) - SK[U.sortK](a) || b.pts - a.pts || b.g - a.g;
  const f = (r) => (!U.onlyFree || !own.has(r.id)) && (!U.nat || r.nat === U.nat) && (!U.rook || r.rook);
  const sk = poolList(S, null);
  const all = [...sk].sort(cmp).filter(f).slice(0, 50);
  const fw = sk.filter((r) => r.pos === "F").sort(cmp).filter(f).slice(0, 10);
  const df = sk.filter((r) => r.pos === "D").sort(cmp).filter(f).slice(0, 10);
  const GK = { w: (r) => r.w, so: (r) => r.so, sv: (r) => (r.gp >= 3 ? r.sv || 0 : 0), gaa: (r) => (r.gp >= 3 && r.gaa != null ? -r.gaa : -99) };
  const glAll = poolList(S, "G").filter((r) => !U.nat || r.nat === U.nat).sort((a, b) => GK[U.sortG](b) - GK[U.sortG](a) || b.w - a.w).filter(f);
  const gl = U.allG ? glAll : glAll.slice(0, 10);
  const thG = (k, l) => `<th class="num"><button class="sortb ${U.sortG === k ? "on" : ""}" data-act="sortg" data-k="${k}">${l}${U.sortG === k ? " ▾" : ""}</button></th>`;
  const thS = (k, l) => `<th class="num"><button class="sortb ${U.sortK === k ? "on" : ""}" data-act="sort" data-k="${k}">${l}${U.sortK === k ? " ▾" : ""}</button></th>`;
  const tbl = (rows) => `<div class="panel scroll"><table><thead><tr><th></th><th>Hráč</th><th class="num">Z</th>${thS("g", "G")}${thS("a", "A")}${thS("pts", "B")}<th>Majitel</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr><td class="rank" style="font-size:17px">${i + 1}</td><td><span class="pos ${r.pos}">${POSL[r.pos]}</span> ${pc(r.id, esc(r.name))} <span class="nhl">${r.team}</span>${r.nat ? ` <span class="flag" title="${natName(r.nat)}">${flag(r.nat)}</span>` : ""}</td>
    <td class="num">${r.gp}</td><td class="num">${r.g}</td><td class="num">${r.a}</td><td class="num pts" style="font-size:19px">${r.pts}</td><td>${ownChip(S, own.get(r.id))}</td></tr>`).join("")}</tbody></table></div>`;
  const owners = S.league?.owners || [];
  return `<div class="dayhead"><h2>Kanadské bodování NHL</h2>
    <label class="opt" style="padding:6px 10px"><input type="checkbox" id="onlyFree" data-act="free" ${U.onlyFree ? "checked" : ""}><span>Jen volní hráči</span></label></div>
  <div class="seg"><span class="tname">Řadit podle:</span>${[["pts", "Body"], ["g", "Střelci"], ["a", "Nahrávači"]].map(([k, l]) => `<button class="btn ${U.sortK === k ? "pri" : ""}" data-act="sort" data-k="${k}">${l}</button>`).join("")}</div>
  ${natBar(S, U)}
  <div class="legend">${owners.map((o) => ownChip(S, o)).join("")}${ownChip(S, null)}</div>
  <div class="jump"><a href="#top50" class="btn">Top 50</a><a href="#topf" class="btn">Útočníci</a><a href="#topd" class="btn">Obránci</a><a href="#topg" class="btn">Brankáři</a></div>
  <h3 class="mh" id="top50">Top 50 hráčů${U.nat ? ` – ${flag(U.nat)} ${natName(U.nat)}` : ""}${U.rook ? " – nováčci" : ""}</h3>${all.length ? tbl(all) : `<div class="panel empty">Nikdo neodpovídá filtru.</div>`}
  <h3 class="mh" id="topf">Top 10 útočníků</h3>${tbl(fw)}
  <h3 class="mh" id="topd">Top 10 obránců</h3>${tbl(df)}
  <h3 class="mh" id="topg">${U.allG ? `Všichni brankáři (${glAll.length})` : "Top 10 brankářů"}</h3>
  <div class="panel scroll"><table><thead><tr><th></th><th>Brankář</th><th class="num">Z</th>${thG("w", "V")}<th class="num">P</th><th class="num">PvP</th>${thG("gaa", "GAA")}${thG("sv", "Úsp.")}${thG("so", "Nuly")}<th>Majitel</th></tr></thead>
  <tbody>${gl.map((r, i) => `<tr><td class="rank" style="font-size:17px">${i + 1}</td><td><span class="pos G">B</span> ${pc(r.id, esc(r.name))} <span class="nhl">${r.team}</span>${r.nat ? ` <span class="flag" title="${natName(r.nat)}">${flag(r.nat)}</span>` : ""}</td>
    <td class="num">${r.gp}</td><td class="num"><b>${r.w}</b></td><td class="num">${r.l}</td><td class="num">${r.ot}</td><td class="num">${r.gaa ?? "–"}</td><td class="num">${r.sv != null ? r.sv.toFixed(3).replace(/^0/, "") : "–"}</td><td class="num"><b>${r.so}</b></td><td>${ownChip(S, own.get(r.id))}</td></tr>`).join("")}</tbody></table></div>
  <div class="acts" style="margin-top:10px"><button class="btn pri" data-act="allg">${U.allG ? "Zobrazit jen top 10" : `Zobrazit všechny brankáře (${glAll.length})`}</button></div>
  <p class="note">Řadit jde kliknutím na V, GAA, Úsp. nebo Nuly. U GAA a úspěšnosti se počítají jen brankáři s aspoň 3 zápasy.</p>`;
}

// --- Vyúčtování ---
export function vVyuct(S, U) {
  const kc = S.league?.kc || 5, today = nyDate();
  const keys = Object.keys(S.months).sort().reverse();
  const total = (s) => s.reduce((t, x) => t + x.pts, 0);
  const subFor = (o, p) => { if (p.role !== "sub") return ""; const sl = (S.rosters[o]?.slots || []).find((x) => x.key === p.slot); return sl ? `za ${short(sl.base.name)}` : "náhradník"; };
  const prows = (k, o) => Object.values(S.months[k]?.owners?.[o]?.players || {}).sort((a, b) => b.pts - a.pts).map((p) => {
    const sf = subFor(o, p), st = p.pos === "G" ? [p.so ? `${p.so}× nula` : "", p.a ? `${p.a} A` : ""].filter(Boolean).join(", ") || "bez bodů" : `${p.g || 0} G, ${p.a || 0} A`;
    return `<tr class="prow"><td></td><td><span class="pos ${p.pos}">${POSL[p.pos]}</span> ${esc(p.name)} <span class="nhl">${esc(p.team || "")}</span>${sf ? ` <span class="tag sub">${esc(sf)}</span>` : ""}<div class="tname">${st}</div></td><td class="num"><b>${p.pts}</b></td><td></td></tr>`; }).join("");
  const podium = (s) => { const t = [s[1], s[0], s[2]]; return `<div class="pod">${t.map((x, i) => x ? `<div class="${i === 1 ? "p1" : ""}" style="--c:${col(S, x.owner)}"><div class="m">${[2, 1, 3][i]}.</div><div class="n">${esc(x.owner)}</div><div class="b">${x.pts} b.</div><div class="k ${balCls(x.bal)}">${signKc(x.bal)}</div></div>` : "<div></div>").join("")}</div>`; };
  const detail = (s, k) => {
    const pays = (x) => s.filter((y) => y.pts > x.pts).map((y) => ({ to: y.owner, d: y.pts - x.pts }));
    return `<div class="mbody">${podium(s)}
    <div class="tot"><span>Celkem bodů za měsíc</span><b>${total(s)}</b></div>
    <div class="panel scroll"><table><thead><tr><th></th><th>Hráč</th><th class="num">Body</th><th class="num">Bilance</th></tr></thead>
    <tbody>${s.map((x, i) => { const op = U.openO?.has(k + "|" + x.owner);
      return `<tr class="${x.leader ? "leader" : ""} ${op ? "op" : ""}" data-act="oopen" data-k="${k}|${esc(x.owner)}" role="button" style="cursor:pointer"><td class="rank">${i + 1}</td><td class="own">${esc(x.owner)} <span class="car">${op ? "▾" : "▸"}</span></td><td class="num pts">${x.pts}</td><td class="num bal ${balCls(x.bal)}"><b>${signKc(x.bal)}</b></td></tr>${op ? prows(k, x.owner) : ""}`; }).join("")}</tbody></table></div>
    <h3 class="mh">Kdo komu platí</h3>
    <div class="pay">${s.map((x) => { const p = pays(x), out = p.reduce((t, q) => t + q.d * kc, 0), inn = x.bal + out;
      return `<div class="panel payrow"><div style="min-width:0"><div class="who">${esc(x.owner)}</div>
        <div class="tname">${p.length ? "platí: " + p.map((q) => `${esc(q.to)} ${q.d}×${kc} = ${q.d * kc} Kč`).join(" · ") : "nikomu neplatí"}</div>
        <div class="tname">dostane: ${fmtKc(inn)} · platí: ${fmtKc(out)}</div></div><div class="kc ${balCls(x.bal)}">${signKc(x.bal)}</div></div>`; }).join("")}</div>
    <div class="panel scroll" style="margin-top:12px"><table class="matrix"><thead><tr><th>platí ↓ / dostává →</th>${s.map((y) => `<th class="num">${esc(y.owner)}</th>`).join("")}</tr></thead>
    <tbody>${s.map((x) => `<tr><td class="own">${esc(x.owner)}</td>${s.map((y) => `<td class="num">${y.pts > x.pts ? (y.pts - x.pts) * kc : '<span class="tname">·</span>'}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    ${bobSettle(S, k)}</div>`;
  };
  // přehled sezóny – měsíce vedle sebe
  const asc = [...keys].reverse(), owners = S.league?.owners || [], kcMode = U.vyuK === "k";
  const per = Object.fromEntries(asc.map((k) => [k, Object.fromEntries(standings(S, k).map((x) => [x.owner, kcMode ? x.bal : x.pts]))]));
  const srow = owners.map((o) => ({ o, v: asc.map((k) => per[k][o] || 0) })).map((r) => ({ ...r, s: r.v.reduce((t, x) => t + x, 0) })).sort((a, b) => b.s - a.s);
  const mx = asc.map((_, j) => Math.max(...srow.map((r) => r.v[j])));
  const fv = (n) => (kcMode ? `<span class="${balCls(n)}">${signKc(n)}</span>` : n);
  const MS = ["Led", "Úno", "Bře", "Dub", "Kvě", "Čer", "Čvc", "Srp", "Zář", "Říj", "Lis", "Pro"];
  const season = asc.length ? `<h3 class="mh" style="margin-top:0">Přehled sezóny</h3>
  <div class="seg"><button class="btn ${kcMode ? "" : "pri"}" data-act="vyuk" data-k="b">Body</button><button class="btn ${kcMode ? "pri" : ""}" data-act="vyuk" data-k="k">Kč</button></div>
  <div class="panel scroll"><table class="ss"><thead><tr><th></th><th>Hráč</th>${asc.map((k) => `<th class="num">${MS[+k.slice(5, 7) - 1]}</th>`).join("")}<th class="num">Sezóna</th></tr></thead>
  <tbody>${srow.map((r, i) => `<tr><td class="rank" style="font-size:17px">${i + 1}</td><td>${ownChip(S, r.o)}</td>${r.v.map((v, j) => `<td class="num ${v === mx[j] && v > 0 ? "best" : ""}">${fv(v)}</td>`).join("")}<td class="num pts" style="font-size:19px">${fv(r.s)}</td></tr>`).join("")}</tbody>
  ${kcMode ? "" : `<tfoot><tr><td></td><td>Celkem</td>${asc.map((_, j) => `<td class="num">${srow.reduce((t, r) => t + r.v[j], 0)}</td>`).join("")}<td class="num">${srow.reduce((t, r) => t + r.s, 0)}</td></tr></tfoot>`}</table></div>
  <p class="note" style="margin-bottom:18px">Zlatě = nejlepší v měsíci.${kcMode ? " Kč = bilance (kolik kdo dostal nebo zaplatil)." : ""}</p>` : "";
  return `${season}<div class="months">${keys.map((k) => { const s = standings(S, k), o = U.openM.has(k), pd = !!S.months[k].paid, closed = S.months[k].locked || today.slice(0, 7) > k;
    return `<div class="panel month-card"><div class="mrow" data-act="mopen" data-m="${k}" role="button" tabindex="0">
      <div><div class="mname">${monthLabel(k)} <span class="car">${o ? "▾" : "▸"}</span></div>
      <div class="tname">${closed ? "uzavřeno" : "průběžně – uzavře se poslední den měsíce (čas NHL)"} · celkem ${total(s)} bodů · vede ${esc(s[0]?.owner)} ${signKc(s[0]?.bal || 0)}</div></div>
      ${closed ? `<button class="btn ${pd ? "paidb" : "pri"}" data-act="paid" data-m="${k}">${pd ? "✓ Vyplaceno" : "Označit jako vyplaceno"}</button>` : ""}
    </div>${o ? detail(s, k) : ""}</div>`; }).join("")}</div>
  <div class="panel rules"><h4>Pravidla</h4><ul>
    <li>Útočník: gól 2 b., asistence 1 b. Obránce: gól 3 b., asistence 1 b. Brankář: čisté konto 5 b., asistence 1 b.</li>
    <li>Každý platí každému, kdo je nad ním, ${kc} Kč za každý bod rozdílu. Na konci měsíce se body nulují.</li>
    <li>Měsíc se uzavírá poslední den měsíce podle času NHL. Zápas hraný v Americe 31. večer (u nás už 1. ráno) patří ještě do starého měsíce.</li>
    <li>Každé místo v sestavě boduje maximálně 84 zápasů. Jen základní část.</li>
  </ul></div>`;
}

// --- Statistiky: Hráči / Tabulky NHL / Forma / Nejlepší volní ---
const STAT_TABS = [["hr", "Hráči"], ["tab", "Tabulky NHL"], ["for", "Forma"], ["vol", "Nejlepší volní"]];
const segBtns = (act, cur, items) => items.map(([k, l]) => `<button class="btn ${String(cur) === String(k) ? "pri" : ""}" data-act="${act}" data-k="${k}">${l}</button>`).join("");
export function vNhl(S, U) {
  const t = U.stat || "hr";
  const body = { hr: vHraci, tab: vTabulky, for: vForma, vol: vVolni }[t](S, U);
  return `<div class="seg subtabs">${segBtns("stat", t, STAT_TABS)}</div>${body}`;
}
const fpts = (pos, g, a, so) => (pos === "F" ? 2 * g + a : pos === "D" ? 3 * g + a : a + 5 * so);
// forma hráče: nejnovější první [{d,g,a,so}]
const formOf = (S, id) => (S.form?.p?.[id] || "").split(" ").filter(Boolean).map((x) => { const [d, g, a, so] = x.split("."); return { d, g: +g, a: +a, so: +so }; });
function allPlayers(S) { return [...poolList(S, null), ...poolList(S, "G")]; }
function formStats(S, p, n) {
  const l = formOf(S, p.id).slice(0, n);
  const g = l.reduce((t, x) => t + x.g, 0), a = l.reduce((t, x) => t + x.a, 0), so = l.reduce((t, x) => t + x.so, 0);
  return { l, g, a, so, b: fpts(p.pos, g, a, so), last: l[0]?.d || "" };
}
const dots = (S, p, l, n) => `<span class="dots">${Array.from({ length: n }, (_, i) => l[n - 1 - i]).map((x) => `<i class="${x && fpts(p.pos, x.g, x.a, x.so) > 0 ? "p" : x ? "" : "na"}"></i>`).join("")}</span>`;
const injSet = (S) => { const m = new Map(); for (const x of S.form?.inj || []) { const [n, st] = x.split("|"); m.set(normName(n), st || ""); } return m; };
const normName = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");
const recentFrom = () => nyDate(new Date(Date.now() - 10 * 864e5)).replaceAll("-", "");
const noForm = `<div class="panel empty">Forma se načte při příští synchronizaci.</div>`;

function vForma(S, U) {
  if (!S.form?.p) return noForm;
  const n = U.formN || 5, own = ownership(S), rf = recentFrom();
  const rows = allPlayers(S).map((p) => ({ p, ...formStats(S, p, n) })).filter((r) => r.l.length && r.last >= rf && (!U.formFree || !own.has(r.p.id)))
    .sort((a, b) => b.b - a.b || b.g - a.g || b.a - a.a).slice(0, 40);
  return `<div class="dayhead"><div class="seg" style="margin:0">${segBtns("formn", n, [[5, "Posl. 5 zápasů"], [10, "Posl. 10"]])}</div>
    <label class="opt" style="padding:6px 10px"><input type="checkbox" data-act="formfree" ${U.formFree ? "checked" : ""}><span>Jen volní hráči</span></label></div>
  <div class="panel scroll"><table><thead><tr><th></th><th>Hráč</th><th class="num">G</th><th class="num">A</th><th class="num">B ▾</th><th>Zápasy</th><th>Majitel</th></tr></thead>
  <tbody>${rows.map((r, i) => `<tr><td class="rank" style="font-size:17px">${i + 1}</td><td><span class="pos ${r.p.pos}">${POSL[r.p.pos]}</span> ${pc(r.p.id, esc(r.p.name))} <span class="nhl">${r.p.team}</span></td>
    <td class="num">${r.p.pos === "G" ? (r.so ? `${r.so}× nula` : "–") : r.g}</td><td class="num">${r.a}</td><td class="num pts" style="font-size:19px">${r.b}</td><td>${dots(S, r.p, r.l, n)}</td><td>${ownChip(S, own.get(r.p.id))}</td></tr>`).join("")}</tbody></table></div>
  <p class="note">Fantasy body za posledních ${n} odehraných zápasů hráče (útočník gól 2, obránce gól 3, asistence 1, brankář nula 5). Čtverečky: modrý = bodoval, šedý = nebodoval (vlevo nejstarší). Jen hráči, kteří hráli v posledních 10 dnech.</p>`;
}

function nextGame(S, team) {
  const now = new Date().toISOString();
  const g = (S.upcoming?.games || []).find((x) => (x.away === team || x.home === team) && x.start > now);
  if (!g) return "";
  const d = new Date(g.start), day = d.toLocaleDateString("en-CA", { timeZone: "Europe/Prague" });
  const td = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Prague" }), tm = new Date(Date.now() + 864e5).toLocaleDateString("en-CA", { timeZone: "Europe/Prague" });
  const dl = day === td ? "dnes" : day === tm ? "zítra" : d.toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague", weekday: "short", day: "numeric", month: "numeric" });
  return `${g.away === team ? "@" : "vs"} ${g.away === team ? g.home : g.away} ${dl} ${fTime(d)}`;
}
function vVolni(S, U) {
  if (!S.pool) return `<div class="panel empty">Statistiky se načtou při první synchronizaci.</div>`;
  const pos = U.volPos || "F", srt = U.volSort || "s", taken = reserved(S, null), inj = injSet(S);
  let rows = poolList(S, pos).filter((p) => !taken.has(p.id)).map((p) => {
    const f = formStats(S, p, 5), st = inj.get(normName(p.name));
    return { p, f, st, season: pos === "G" ? 5 * p.so : fpts(pos, p.g, p.a, 0) };
  }).filter((r) => r.st === undefined || /day/i.test(r.st));
  rows.sort(srt === "f" ? (a, b) => b.f.b - a.f.b || b.season - a.season : pos === "G" ? (a, b) => b.p.so - a.p.so || b.p.w - a.p.w : (a, b) => b.season - a.season || b.f.b - a.f.b);
  rows = rows.slice(0, 25);
  const nm = (r) => `<span class="pos ${pos}">${POSL[pos]}</span> ${pc(r.p.id, esc(r.p.name))} <span class="nhl">${r.p.team}</span>${r.st ? ' <span class="tag inj">DTD</span>' : ""}<div class="tname">${esc(nextGame(S, r.p.team) ? "další zápas: " + nextGame(S, r.p.team) : "")}</div>`;
  const head = pos === "G" ? `<th class="num">Z</th><th class="num">V</th><th class="num">Nuly</th>` : `<th class="num">Z</th><th class="num">G</th><th class="num">A</th>`;
  const cells = (r) => pos === "G" ? `<td class="num">${r.p.gp}</td><td class="num">${r.p.w}</td><td class="num">${r.p.so}</td>` : `<td class="num">${r.p.gp}</td><td class="num">${r.p.g}</td><td class="num">${r.p.a}</td>`;
  return `<div class="seg">${segBtns("volpos", pos, [["F", "Útočníci"], ["D", "Obránci"], ["G", "Brankáři"]])}</div>
  <div class="seg"><span class="tname">Řadit:</span>${segBtns("volsort", srt, [["s", "Sezóna"], ["f", "Forma (5 z.)"]])}</div>
  <div class="panel scroll"><table><thead><tr><th></th><th>Volný ${POSN[pos]}</th>${head}<th class="num">B${srt === "s" ? " ▾" : ""}</th><th class="num">Forma${srt === "f" ? " ▾" : ""}</th></tr></thead>
  <tbody>${rows.map((r, i) => `<tr><td class="rank" style="font-size:17px">${i + 1}</td><td>${nm(r)}</td>${cells(r)}<td class="num pts" style="font-size:19px">${r.season}</td><td class="num">${r.f.l.length ? r.f.b : "–"}</td></tr>`).join("")}</tbody></table></div>
  <p class="note">Jen hráči, které nikdo nemá ani si je právě nevybírá. Zranění podle ESPN jsou vynechaní (DTD = den ode dne, může hrát). B = fantasy body za sezónu${pos === "G" ? " (5 za nulu)" : ""}, Forma = fantasy body za posledních 5 zápasů.</p>`;
}

const DIVN = { Atlantic: "Atlantická divize", Metropolitan: "Metropolitní divize", Central: "Centrální divize", Pacific: "Pacifická divize" };
const CONFN = { Eastern: "Východní konference", Western: "Západní konference" };
function vTabulky(S, U) {
  const T = S.standings?.teams; if (!T?.length) return `<div class="panel empty">Tabulky se načtou při příští synchronizaci.</div>`;
  const v = U.stdV || "div", tf = S.standings.form || {};
  const owners = {}; // tým -> majitelé s aktivním hráčem
  for (const [o, r] of Object.entries(S.rosters)) for (const sl of r.slots || []) { const p = activeOf(S, o, sl); if (p?.team) (owners[p.team] ||= new Set()).add(o); }
  const frm = (t) => `<span class="frm">${[...(tf[t] || "").slice(-5)].map((c) => `<b class="${c}"></b>`).join("")}</span>`;
  const tbl = (rows, cut, wc) => `<div class="panel scroll"><table class="std"><thead><tr><th></th><th>Tým</th><th class="num">Z</th><th class="num">V</th><th class="num">P</th><th class="num">PP</th><th class="num">B</th><th class="num">+/−</th><th>Forma</th></tr></thead>
    <tbody>${rows.map((t, i) => { const os = [...(owners[t.t] || [])];
      return `<tr class="${os.length ? "mine" : ""} ${cut && i === cut - 1 ? "cut" : ""}" style="--c:${os.length ? col(S, os[0]) : "transparent"}" title="${esc(t.n)}">
      <td class="rank" style="font-size:17px">${i + 1}</td><td class="tm"><b>${t.t}</b>${os.map((o) => `<i class="od" style="background:${col(S, o)}" title="${esc(o)}"></i>`).join("")}${wc && t.ds > 3 && t.wc >= 1 && t.wc <= 2 ? ' <span class="wc">WC</span>' : ""}</td>
      <td class="num">${t.gp}</td><td class="num">${t.w}</td><td class="num">${t.l}</td><td class="num">${t.ot}</td><td class="num pts" style="font-size:19px">${t.pts}</td><td class="num">${t.gd > 0 ? "+" : t.gd < 0 ? "−" : ""}${Math.abs(t.gd)}</td><td>${frm(t.t)}</td></tr>`; }).join("")}</tbody></table></div>`;
  let out = "";
  if (v === "div") for (const d of ["Atlantic", "Metropolitan", "Central", "Pacific"]) {
    const r = T.filter((t) => t.div === d).sort((a, b) => a.ds - b.ds);
    if (r.length) out += `<h3 class="mh">${DIVN[d]}</h3>${tbl(r, 3)}`;
  }
  else if (v === "conf") for (const c of ["Eastern", "Western"]) {
    const r = T.filter((t) => t.conf === c), inPo = (t) => t.ds <= 3 || (t.wc >= 1 && t.wc <= 2);
    const po = r.filter(inPo).sort((a, b) => a.cs - b.cs), rest = r.filter((t) => !inPo(t)).sort((a, b) => a.cs - b.cs);
    if (r.length) out += `<h3 class="mh">${CONFN[c]}</h3>${tbl([...po, ...rest], po.length, true)}`;
  }
  else out += `<h3 class="mh">Celá liga</h3>${tbl([...T].sort((a, b) => a.ls - b.ls), 0)}`;
  return `<div class="seg">${segBtns("stdv", v, [["div", "Divize"], ["conf", "Konference"], ["lg", "Celá liga"]])}</div>${out}
  <p class="note">${v === "div" ? "Čárkovaná čára = postup z divize (první 3)." : v === "conf" ? "Nad čárou týmy v play-off (první 3 z každé divize + 2 wild card – WC)." : ""} Podbarvené týmy = máme v nich hráče (tečka = barva majitele). Forma za posledních 5 zápasů: zelená výhra, červená prohra, žlutá prohra v prodloužení nebo nájezdech.</p>`;
}

// --- v1.28: rozkliknutý zápas – videa, formace, zajímavosti ---
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
const plural = (n, a, b, c) => `${n} ${n === 1 ? a : n >= 2 && n <= 4 ? b : c}`;
function luTeam(S, gid, team) {
  const t = S.lineups?.g?.[gid]?.t?.[team]; if (!t) return null;
  const P = new Map((t.p || []).map((x) => { const [id, n, pos, g, a, pm, toi] = x.split("|"); return [+id, { id: +id, n, pos, g: +g, a: +a, pm: +pm, toi }]; }));
  const G = (t.g || []).map((x) => { const [id, n, sa, pct, toi] = x.split("|"); return { id: +id, n, sa, pct, toi }; });
  const lines = (arr) => (arr || []).map((x) => { const [ids, sec] = x.split("|"); return { ids: ids.split(",").map(Number), sec: +sec }; });
  return { P, G, f: lines(t.f), d: lines(t.d) };
}
const teamSeg = (g, cur, label) => `<div class="seg" style="margin:0">${[g.away, g.home].map((t) => `<button class="btn ${cur === t ? "pri" : ""}" data-act="lut" data-id="${g.id}" data-k="${t}">${label} ${t}</button>`).join("")}</div>`;
function linesHtml(S, lu, withStats, inj) {
  const own = ownership(S);
  const pl = (id) => { const p = lu.P.get(id); if (!p) return ""; const o = own.get(id), out = inj && inj.has(normName(p.n));
    const nm = pc(id, o ? `<span class="ours" style="--oc:${col(S, o)}">${esc(short(p.n))}</span>` : esc(short(p.n)));
    return `<span class="pl ${out ? "outp" : ""}">${nm}${withStats && (p.g || p.a) ? ` <span class="tname">${p.g}+${p.a}</span>` : ""}</span>`; };
  const row = (lab, x) => `<div class="line"><span class="ln">${lab}</span><span>${x.ids.map(pl).join("")}</span><span class="t">${withStats ? mmss(x.sec) : ""}</span></div>`;
  if (!lu.f.length) { // bez střídání – aspoň seznam podle času na ledě
    const list = (pos) => [...lu.P.values()].filter((p) => p.pos === pos).sort((a, b) => String(b.toi).localeCompare(String(a.toi), undefined, { numeric: true }));
    return `<p class="tname" style="margin:6px 2px">Formace zatím nejsou k dispozici (NHL zveřejní střídání se zpožděním).</p>
      <h4>Útočníci</h4><div class="line"><span></span><span>${list("F").map((p) => pl(p.id)).join("")}</span><span></span></div>
      <h4>Obránci</h4><div class="line"><span></span><span>${list("D").map((p) => pl(p.id)).join("")}</span><span></span></div>`;
  }
  return `<h4>Útoky</h4>${lu.f.map((x, i) => row(`${i + 1}. útok`, x)).join("")}<h4>Obrana</h4>${lu.d.map((x, i) => row(`${i + 1}. obrana`, x)).join("")}`;
}
function pastOpen(S, U, g) {
  const team = U.luT?.[g.id] || g.away, lu = luTeam(S, String(g.id), team);
  const goalies = lu?.G?.length ? `<h4>Brankář</h4><table><thead><tr><th>Hráč</th><th class="num">Zás.</th><th class="num">%</th><th class="num">Čas</th></tr></thead><tbody>${lu.G.map((x) => `<tr><td><span class="pos G">B</span> ${esc(short(x.n))}</td><td class="num">${esc(x.sa)}</td><td class="num">${x.pct ? Number(x.pct).toFixed(3).replace(/^0/, "") : "–"}</td><td class="num">${esc(x.toi)}</td></tr>`).join("")}</tbody></table>` : "";
  const own = ownership(S), ow = (id) => (g.pl || []).find((e) => e.id === id)?.owner || own.get(id);
  const stars = g.stars?.length ? `<h4>3 hvězdy zápasu</h4><div class="stars">${g.stars.map((x, i) => { const o = ow(x.id);
    return `<div><div class="s">${"★".repeat(i + 1)}</div>${pc(x.id, o ? `<span class="ours" style="--oc:${col(S, o)}">${esc(short(x.n))}</span>` : esc(short(x.n)))} <span class="nhl">${esc(x.t)}</span></div>`; }).join("")}</div>` : "";
  return `<div class="gact">${g.rc ? `<a class="btn pri" href="${esc(g.rc)}" target="_blank" rel="noopener">▶ Sestřih zápasu</a>` : `<span class="tname">Sestřih zatím není.</span>`}${g.goals?.some((x) => x.v) ? `<span class="tname" style="align-self:center">▶ u gólu = video na nhl.com</span>` : ""}</div>
  ${stars}${gameStatsHtml(g)}<div class="lu">${teamSeg(g, team, "Formace")}${lu ? linesHtml(S, lu, true) + goalies : `<p class="tname" style="margin:8px 2px">Sestava se načte při další synchronizaci.</p>`}</div>`;
}
// zajímavosti před zápasem – skládané z dat
function seasonOf(S) {
  return (S.standings?.games || []).map((x) => { const [d, a, h, as, hs, last] = x.split("|"); return { d, a, h, as: +as, hs: +hs, last }; });
}
function teamName(S, t) {
  const T = S.standings?.teams || [], r = T.find((x) => x.t === t);
  if (!r?.pl) return t;
  return T.filter((x) => x.pl === r.pl).length > 1 ? r.cn || t : r.pl;
}
function teamRes(G, t) { return G.filter((x) => x.a === t || x.h === t).map((x) => { const mine = x.a === t ? x.as : x.hs, th = x.a === t ? x.hs : x.as; return mine > th ? "W" : x.last !== "REG" ? "O" : "L"; }); }
const DIVL = { Atlantic: "Atlantické", Metropolitan: "Metropolitní", Central: "Centrální", Pacific: "Pacifické" };
function preview(S, g) {
  const G = seasonOf(S), T = S.standings?.teams || [], out = [];
  const tf = [];
  for (const t of [g.away, g.home]) {
    const r = teamRes(G, t); if (r.length < 3) continue;
    let w = 0; for (let i = r.length - 1; i >= 0 && r[i] === "W"; i--) w++;
    let nw = 0; for (let i = r.length - 1; i >= 0 && r[i] !== "W"; i--) nw++;
    const l5 = r.slice(-5).filter((x) => x === "W").length, nm = `<b>${esc(teamName(S, t))}</b>`;
    if (w >= 3) tf.push(`${nm} má sérii ${plural(w, "výhry", "výher", "výher").replace(/^(\d+) /, "$1 ")}`);
    else if (nw >= 3) tf.push(`${nm} čeká na výhru už ${plural(nw, "zápas", "zápasy", "zápasů")}`);
    else if (l5 >= 4) tf.push(`${nm} má ${plural(l5, "výhru", "výhry", "výher")} z posledních 5 zápasů`);
    else if (l5 <= 1) tf.push(`${nm} má jen ${plural(l5, "výhru", "výhry", "výher")} z posledních 5 zápasů`);
  }
  if (tf.length) out.push(tf.join(", ") + ".");
  // naši hráči
  const own = [];
  for (const p of g.pl || []) {
    const pos = p.pos, l = formOf(S, p.id), fp = (x) => fpts(pos, x.g, x.a, x.so);
    const nm = `<span class="ours" style="--oc:${col(S, p.own)}">${esc(short(p.n))}</span> (${esc(p.own)})`;
    if (pos === "G") { const gp = poolList(S, "G").find((x) => x.id === p.id); if (gp?.gp) own.push([1, `${nm} má v sezóně ${plural(gp.so, "nulu", "nuly", "nul")}${gp.sv ? `, úspěšnost ${Number(gp.sv).toFixed(3).replace(/^0/, "")}` : ""}.`]); continue; }
    if (!l.length) continue;
    let st = 0; for (const x of l) { if (fp(x) > 0) st++; else break; }
    let dr = 0; for (const x of l) { if (fp(x) === 0) dr++; else break; }
    const f5 = l.slice(0, 5).reduce((t, x) => t + fp(x), 0);
    if (st >= 3) own.push([3 + st, `${nm} bodoval v ${st} zápasech v řadě – za posledních 5 má ${plural(f5, "bod", "body", "bodů")}.`]);
    else if (f5 >= 6) own.push([3, `${nm} je ve formě: ${plural(f5, "bod", "body", "bodů")} za posledních 5 zápasů.`]);
    else if (dr >= 3) own.push([2, `${nm} nebodoval už ${plural(dr, "zápas", "zápasy", "zápasů")}.`]);
  }
  own.sort((a, b) => b[0] - a[0]).slice(0, 2).forEach((x) => out.push(x[1]));
  // vzájemné zápasy
  const h2h = G.filter((x) => (x.a === g.away && x.h === g.home) || (x.a === g.home && x.h === g.away));
  if (G.length) out.push(h2h.length ? `Letos spolu hráli ${h2h.length}×: ${h2h.map((x) => `${x.a} ${x.as}:${x.hs} ${x.h}${x.last !== "REG" ? (x.last === "OT" ? " pp" : " sn") : ""} (${+x.d.slice(6)}. ${+x.d.slice(4, 6)}.)`).join(", ")}.` : "Týmy se letos utkají poprvé.");
  // tabulka
  const A = T.find((x) => x.t === g.away), H = T.find((x) => x.t === g.home);
  if (A && H && A.div === H.div && Math.abs(A.pts - H.pts) <= 3) {
    const d = Math.abs(A.pts - H.pts);
    out.push(`Souboj sousedů v ${DIVL[A.div] || ""} divizi: ${A.t} je ${A.ds}., ${H.t} ${H.ds}.${d ? `, dělí je ${plural(d, "bod", "body", "bodů")}` : ", mají stejně bodů"}.`);
  } else for (const x of [A, H]) if (x?.ls === 1) out.push(`<b>${esc(teamName(S, x.t))}</b> vede celou NHL.`);
  return out.slice(0, 4);
}
function compare(S, g) {
  const T = S.standings?.teams || [], A = T.find((x) => x.t === g.away), H = T.find((x) => x.t === g.home); if (!A || !H) return "";
  const tf = S.standings.form || {}, ts = S.standings.ts || {};
  const frm = (t) => `<span class="frm">${[...(tf[t] || "").slice(-5)].map((c) => `<b class="${c}"></b>`).join("")}</span>`;
  const pg = (x, k) => (x[k] != null && x.gp ? (x[k] / x.gp).toFixed(1).replace(".", ",") : "–");
  const pc = (v) => (v != null ? Math.round(v * 100) + " %" : "–");
  const DS = { Atlantic: "Atlantická", Metropolitan: "Metropolitní", Central: "Centrální", Pacific: "Pacifická" };
  const r = (a, lab, b) => `<span>${a}</span><span class="c">${lab}</span><span class="r">${b}</span>`;
  return `<div class="facts"><b>${g.away}</b><span class="c">srovnání</span><b class="r">${g.home}</b>
    ${r(`${A.ds}. ${DS[A.div] || ""} · ${A.pts} b.`, "tabulka", `${H.ds}. ${DS[H.div] || ""} · ${H.pts} b.`)}
    ${r(frm(A.t), "forma", frm(H.t))}
    ${r(`${pg(A, "gf")} / ${pg(A, "ga")}`, "góly dané / dostané", `${pg(H, "gf")} / ${pg(H, "ga")}`)}
    ${ts[A.t] || ts[H.t] ? r(pc(ts[A.t]?.pp), "přesilovky", pc(ts[H.t]?.pp)) + r(pc(ts[A.t]?.pk), "oslabení", pc(ts[H.t]?.pk)) : ""}</div>`;
}
function nextOpen(S, U, g) {
  const team = U.luT?.[g.id] || g.away, lastId = S.lineups?.last?.[team], lu = lastId ? luTeam(S, lastId, team) : null, inj = injSet(S);
  const lg = lastId ? S.lineups.g[lastId] : null, lgDate = lg ? new Date(lg.start).toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric" }) : "";
  const own = ownership(S);
  const gl = poolList(S, "G").filter((x) => x.team === team).sort((a, b) => b.gp - a.gp);
  const facts = preview(S, g);
  return `${g.venue ? `<div class="tname">${esc(g.venue)}</div>` : ""}
  ${facts.length ? `<div class="prev">${facts.map((x) => `<p>${x}</p>`).join("")}</div>` : ""}
  ${compare(S, g)}
  <div class="lu">${teamSeg(g, team, "Formace")}
  ${lu ? `<p class="tname" style="margin:8px 2px">Předpokládané formace podle minulého zápasu (${lgDate}). Přeškrtnutí = zranění podle ESPN.</p>${linesHtml(S, lu, false, inj)}` : `<p class="tname" style="margin:8px 2px">Formace z minulého zápasu nejsou k dispozici.</p>`}
  ${gl.length ? `<h4>Brankáři v sezóně</h4><table><thead><tr><th>Hráč</th><th class="num">Z</th><th class="num">V</th><th class="num">Nuly</th><th class="num">%</th></tr></thead><tbody>${gl.map((x) => { const o = own.get(x.id);
    return `<tr class="${o ? "ourp" : ""}" style="--c:${o ? col(S, o) : "transparent"}"><td><span class="pos G">B</span> ${pc(x.id, esc(short(x.name)))} ${o ? ownChip(S, o) : ""}</td><td class="num">${x.gp}</td><td class="num">${x.w}</td><td class="num">${x.so}</td><td class="num">${x.sv ? Number(x.sv).toFixed(3).replace(/^0/, "") : "–"}</td></tr>`; }).join("")}</tbody></table>` : ""}</div>`;
}

function gameStatsHtml(g) {
  const x = g.gs; if (!x || !Object.keys(x).length) return "";
  const num = (v) => { const m = String(v).match(/^(\d+)\/(\d+)$/); return m ? +m[1] : parseFloat(v) || 0; };
  const row = (k, lab, fmt = (v) => v, rev = false) => { if (!x[k]) return ""; const [a, h] = x[k].split("|");
    const na = num(a), nh = num(h), pa = na + nh ? Math.round((na / (na + nh)) * 100) : 50;
    return `<div class="gs"><span class="l">${esc(fmt(a))}</span><span class="m">${lab}</span><span class="r">${esc(fmt(h))}</span><div class="gb"><i style="width:${pa}%"></i><b style="width:${100 - pa}%"></b></div></div>`; };
  const pct = (v) => (v === "" ? "–" : Math.round(parseFloat(v) * (parseFloat(v) <= 1 ? 100 : 1)) + " %");
  const sbp = x.sbp ? (() => { const [a, h] = x.sbp.split("|"); return `<div class="gs"><span class="l">${esc(a)}</span><span class="m">po třetinách</span><span class="r">${esc(h)}</span></div>`; })() : "";
  const gt = x.gv && x.tk ? (() => { const [ga, gh] = x.gv.split("|"), [ta, th] = x.tk.split("|"); return `<div class="gs"><span class="l">${esc(ga)} / ${esc(ta)}</span><span class="m">ztráty / zisky</span><span class="r">${esc(gh)} / ${esc(th)}</span></div>`; })() : "";
  return `<h4>Statistiky zápasu</h4><div class="sts"><div class="gs"><b class="l">${g.away}</b><span class="m"></span><b class="r">${g.home}</b></div>
    ${row("sog", "střely na branku")}${sbp}${row("pp", "přesilovky")}${row("fo", "vhazování", pct)}${row("pim", "trestné minuty")}${row("hits", "hity")}${row("blk", "zblok. střely")}${gt}</div>`;
}

// --- národnosti ---
const NAT = { CAN: ["CA", "Kanada"], USA: ["US", "USA"], CZE: ["CZ", "Česko"], SVK: ["SK", "Slovensko"], SWE: ["SE", "Švédsko"], FIN: ["FI", "Finsko"], RUS: ["RU", "Rusko"],
  DEU: ["DE", "Německo"], CHE: ["CH", "Švýcarsko"], DNK: ["DK", "Dánsko"], NOR: ["NO", "Norsko"], AUT: ["AT", "Rakousko"], LVA: ["LV", "Lotyšsko"], BLR: ["BY", "Bělorusko"],
  FRA: ["FR", "Francie"], GBR: ["GB", "Británie"], SVN: ["SI", "Slovinsko"], KAZ: ["KZ", "Kazachstán"], UKR: ["UA", "Ukrajina"], AUS: ["AU", "Austrálie"], NLD: ["NL", "Nizozemsko"],
  ITA: ["IT", "Itálie"], POL: ["PL", "Polsko"], JPN: ["JP", "Japonsko"], HUN: ["HU", "Maďarsko"], EST: ["EE", "Estonsko"], LTU: ["LT", "Litva"], KOR: ["KR", "Korea"], CHN: ["CN", "Čína"] };
export const natName = (c) => NAT[c]?.[1] || c;
export const flag = (c) => { const a = NAT[c]?.[0]; return a ? String.fromCodePoint(...[...a].map((x) => 0x1f1a5 + x.charCodeAt(0))) : c; };
function natBar(S, U) {
  const sk = poolList(S, null); if (!sk.some((r) => r.nat)) return "";
  const cnt = {}; for (const r of [...sk, ...poolList(S, "G")]) if (r.nat) cnt[r.nat] = (cnt[r.nat] || 0) + 1;
  const main = ["CZE", "SVK", "CAN", "USA", "SWE", "FIN", "RUS"].filter((c) => cnt[c]);
  const rest = Object.keys(cnt).filter((c) => !main.includes(c)).sort((a, b) => cnt[b] - cnt[a]);
  return `<div class="seg natbar"><button class="btn ${!U.nat ? "pri" : ""}" data-act="nat" data-k="">Všichni</button>${main.map((c) => `<button class="btn ${U.nat === c ? "pri" : ""}" data-act="nat" data-k="${c}" title="${natName(c)}">${flag(c)} ${c}</button>`).join("")}
    <select class="natsel" data-act="natsel"><option value="">další…</option>${rest.map((c) => `<option value="${c}" ${U.nat === c ? "selected" : ""}>${flag(c)} ${natName(c)} (${cnt[c]})</option>`).join("")}</select>
    ${sk.some((r) => r.rook) ? `<label class="opt" style="padding:6px 10px"><input type="checkbox" data-act="rook" ${U.rook ? "checked" : ""}><span>Jen nováčci</span></label>` : ""}</div>`;
}

// --- karta hráče ---
export function vCard(S, id) {
  const sk = poolList(S, null), gl = poolList(S, "G");
  const p = sk.find((x) => x.id === id) || gl.find((x) => x.id === id);
  const close = `<button class="pcx" data-act="pclose" aria-label="Zavřít">✕</button>`;
  if (!p) return `<div class="pcard panel">${close}<p class="tname">Hráč zatím nemá v sezóně odehraný zápas.</p></div>`;
  const own = ownership(S).get(id), inj = injSet(S).get(normName(p.name));
  const rank = (list, key) => 1 + list.filter((x) => key(x) > key(p)).length;
  const box = (v, l) => `<div class="pb"><b>${v}</b><span>${l}</span></div>`;
  const f = formStats(S, p, 5);
  let stats, ranks;
  if (p.pos === "G") {
    stats = box(p.gp, "zápasy") + box(p.w, "výhry") + box(p.so, "nuly") + box(p.sv != null ? p.sv.toFixed(3).replace(/^0/, "") : "–", "úspěšnost") + box(p.gaa ?? "–", "GAA");
    ranks = [`${rank(gl, (x) => x.w)}. v NHL ve výhrách`, `${rank(gl, (x) => x.so)}. v nulách`, p.nat ? `${rank(gl.filter((x) => x.nat === p.nat), (x) => x.w)}. z brankářů ${flag(p.nat)} ${natName(p.nat)}` : ""];
  } else {
    stats = box(p.gp, "zápasy") + box(p.g, "góly") + box(p.a, "asistence") + box(p.pts, "body") + box(fpts(p.pos, p.g, p.a, 0), "fantasy");
    const same = sk.filter((x) => x.pos === p.pos);
    ranks = [`${rank(sk, (x) => x.pts)}. v kanadském bodování NHL`, `${rank(sk, (x) => x.g)}. mezi střelci`, `${rank(same, (x) => x.pts)}. mezi ${p.pos === "D" ? "obránci" : "útočníky"}`,
      p.nat ? `${rank(sk.filter((x) => x.nat === p.nat), (x) => x.pts)}. mezi hráči ${flag(p.nat)} ${natName(p.nat)}` : "", p.rook ? `${rank(sk.filter((x) => x.rook), (x) => x.pts)}. mezi nováčky` : ""];
  }
  const ng = nextGame(S, p.team);
  return `<div class="pcard panel">${close}
    <div class="pch"><span class="pos ${p.pos}">${POSL[p.pos]}</span><div><div class="pcn">${esc(p.name)}</div>
      <div class="tname">${esc(p.team)}${p.nat ? ` · ${flag(p.nat)} ${natName(p.nat)}` : ""}${p.rook ? " · nováček" : ""}</div></div></div>
    <div class="pco">${own ? ownChip(S, own) : ownChip(S, null)}${inj ? ` <span class="tag inj">${/day/i.test(inj) ? "DTD" : "zraněný"}</span>` : ""}</div>
    <div class="pbs">${stats}</div>
    <ul class="pranks">${ranks.filter(Boolean).map((r) => `<li>${r}</li>`).join("")}</ul>
    ${f.l.length ? `<div class="pform"><span class="tname">Forma (5 z.)</span> ${dots(S, p, f.l, 5)} <b>${p.pos === "G" ? `${f.so}× nula` : `${f.g}+${f.a}`}</b> <span class="tname">· ${f.b} fantasy b.</span></div>` : ""}
    ${ng ? `<div class="tname">Další zápas: ${esc(ng)}</div>` : ""}
    <a class="btn" href="https://www.nhl.com/player/${id}" target="_blank" rel="noopener" style="text-decoration:none;justify-self:start">Profil na nhl.com ↗</a>
  </div>`;
}

// --- Bobovka ---
const tipWord = (n) => `${n} ${n === 1 ? "tip" : n >= 2 && n <= 4 ? "tipy" : "tipů"}`;
const kcB = (n) => `${Math.round(n * 100) / 100}`.replace(".", ",") + " Kč";
const sKcB = (n) => (n > 0.004 ? "+" : n < -0.004 ? "−" : "") + kcB(Math.abs(n));
function bobRows(S, mk) {
  const m = S.bob?.months?.[mk]?.owners || {};
  return (S.league?.owners || []).map((o) => { const x = m[o] || { tips: 0, hits: 0, staked: 0, won: 0 }; return { o, ...x, bal: Math.round((x.won - x.staked) * 100) / 100 }; })
    .sort((a, b) => b.bal - a.bal || b.hits - a.hits);
}
// kdo komu: dlužníci platí věřitelům (co nejméně převodů)
function netting(rows) {
  const cr = rows.filter((r) => r.bal > 0.004).map((r) => ({ o: r.o, v: r.bal })), db = rows.filter((r) => r.bal < -0.004).map((r) => ({ o: r.o, v: -r.bal }));
  const out = [];
  for (const d of db) for (const c of cr) { if (d.v < 0.005) break; const x = Math.min(d.v, c.v); if (x < 0.005) continue; out.push({ from: d.o, to: c.o, v: Math.round(x * 100) / 100 }); d.v -= x; c.v -= x; }
  return out;
}
function bobSettle(S, mk, title = "Bobovka") {
  if (!S.bob?.months?.[mk]) return "";
  const rows = bobRows(S, mk), tr = netting(rows), paid = S.bpaid?.[mk]?.paid;
  return `<h3 class="mh">${title}</h3><div class="panel" style="padding:10px 14px">
    ${tr.length ? tr.map((t) => `<div class="btr">${ownChip(S, t.from)} → ${ownChip(S, t.to)} <b>${kcB(t.v)}</b></div>`).join("") : `<div class="tname">Nikdo nikomu nic.</div>`}
    <div class="acts" style="margin-top:8px"><button class="btn ${paid ? "" : "pri"}" data-act="bpaid" data-m="${mk}">${paid ? "✓ Bobovka vyplacena" : "Označit Bobovku jako vyplacenou"}</button></div></div>`;
}
export function vBobovka(S, U) {
  const sub = U.bsub || "tip";
  const seg = `<div class="seg">${[["tip", "Tipovat"], ["res", "Výsledky"], ["tab", "Tabulka"]].map(([k, l]) => `<button class="btn ${sub === k ? "pri" : ""}" data-act="bsub" data-k="${k}">${l}</button>`).join("")}</div>`;
  const head = `<div class="dayhead"><h2>Bobovka</h2><span class="tname">přesný výsledek po 60 min · 10 Kč za tip</span></div>${seg}`;
  const jp = S.bob?.jackpot || 0;
  const tipsOf = (gid) => (S.tips || []).filter((t) => String(t.gameId) === String(gid));
  const chips = (g, tips, r) => `<div class="tips">${tips.map(([o, v]) => `<span class="${r && v === r ? "hit" : ""}"><i class="dot" style="background:${col(S, o)}"></i>${esc(o)} ${v}${r && v === r ? " ✓" : ""}</span>`).join("")}</div>`;
  if (sub === "tip") {
    const now = new Date().toISOString(), up = (S.upcoming?.games || []).filter((g) => g.start > now);
    const groups = {}; for (const g of up) (groups[fDay(new Date(g.start))] ||= []).push(g);
    const done = new Set(Object.keys(S.bob?.games || {}));
    const live = (S.upcoming?.games || []).filter((g) => g.start <= now && !done.has(String(g.id)) && tipsOf(g.id).length);
    return `${head}
    <div class="jp"><div><small>Jackpot</small><div style="font-weight:700">${jp ? "bere první přesná trefa" : "zatím prázdný – nevyhrané banky se sčítají sem"}</div></div><b>${kcB(jp)}</b></div>
    ${live.length ? `<h3 class="mh">Rozehrané – tipy všech</h3>${live.map((g) => `<div class="panel tg"><div class="tr"><span class="t">${g.away}</span><span class="tname">@</span><span class="t">${g.home}</span><span class="bank"><b>${kcB(tipsOf(g.id).length * 10)}</b>${tipWord(tipsOf(g.id).length)}</span></div>${chips(g, tipsOf(g.id).map((t) => [t.owner, `${t.a}:${t.h}`]))}</div>`).join("")}` : ""}
    ${Object.keys(groups).length ? Object.entries(groups).map(([day, gs]) => `<h3 class="mh">${day}</h3>${gs.map((g) => {
      const ts = tipsOf(g.id), my = ts.find((t) => t.owner === U.me), dr = U.tipDraft?.[`${U.me}|${g.id}`] || {};
      const va = dr.a ?? (my ? my.a : ""), vh = dr.h ?? (my ? my.h : "");
      return `<div class="panel tg" data-gid="${g.id}" data-start="${g.start}"><div class="tr"><span class="tm">${fTime(new Date(g.start))}</span><span class="t">${g.away}</span>
        <span class="sc"><input id="tip-${g.id}-a" class="tipin ${my ? "f" : ""}" data-s="a" inputmode="numeric" maxlength="2" value="${esc(va)}" aria-label="góly ${g.away}"> : <input id="tip-${g.id}-h" class="tipin ${my ? "f" : ""}" data-s="h" inputmode="numeric" maxlength="2" value="${esc(vh)}" aria-label="góly ${g.home}"></span>
        <span class="t">${g.home}</span><span class="bank"><b>${kcB(ts.length * 10)}</b>${tipWord(ts.length)}</span></div>
        ${my ? `<div class="saved">✓ tip uložen · do začátku jde změnit</div>` : ""}</div>`; }).join("")}`).join("")
      : `<div class="panel empty">Žádné zápasy k tipování v příštích 7 dnech.</div>`}
    <p class="note">Tip se uloží sám, když vyplníš obě čísla. Tipy ostatních uvidíš po začátku zápasu. Netipnutý zápas tě nic nestojí.</p>`;
  }
  if (sub === "res") {
    const gs = Object.entries(S.bob?.games || {}).sort((a, b) => b[1].s.localeCompare(a[1].s)).slice(0, 40);
    if (!gs.length) return `${head}<div class="panel empty">Zatím žádný vyhodnocený zápas.</div>`;
    const groups = {}; for (const [id, g] of gs) (groups[g.d] ||= []).push(g);
    return `${head}${Object.entries(groups).map(([d, list]) => `<h3 class="mh">${dayLabel(d)}</h3>${list.map((g) => { const [a, h] = g.m.split("-");
      return `<div class="panel tg"><div class="tr"><span class="t">${a}</span><span class="res">${g.r.replace(":", " : ")}${g.f ? ` <small>(konečně ${esc(g.f)})</small>` : ""}</span><span class="t">${h}</span>
        <span class="bank ${g.hit?.length ? "" : "roll"}"><b>${kcB(g.bank)}</b>${g.hit?.length ? tipWord(Object.keys(g.t).length) : "nikdo → jackpot"}</span></div>
        ${chips(g, Object.entries(g.t).sort(), g.r)}
        ${g.hit?.length ? `<div class="win">🏆 ${g.hit.map((o) => esc(o)).join(" a ")} ${g.hit.length > 1 ? "berou po" : "bere"} <b>${kcB(g.w)}</b>${g.jp ? ` (včetně jackpotu ${kcB(g.jp)})` : ""}</div>` : ""}</div>`; }).join("")}`).join("")}`;
  }
  const ms = Object.keys(S.bob?.months || {}).sort(), cur = nyDate().slice(0, 7);
  const mk = U.bmonth && ms.includes(U.bmonth) ? U.bmonth : ms.includes(cur) ? cur : ms[ms.length - 1];
  if (!mk) return `${head}<div class="panel empty">Tabulka se ukáže po prvním vyhodnoceném zápase.</div>`;
  const rows = bobRows(S, mk), i = ms.indexOf(mk);
  return `${head}<div class="seg">${ms.map((k) => `<button class="btn ${k === mk ? "pri" : ""}" data-act="bmonth" data-k="${k}">${monthLabel(k)}</button>`).join("")}</div>
  <div class="panel scroll"><table><thead><tr><th></th><th>Hráč</th><th class="num">Tipů</th><th class="num">Trefa</th><th class="num">Vsadil</th><th class="num">Vyhrál</th><th class="num">Kč</th></tr></thead><tbody>
  ${rows.map((r, j) => `<tr><td class="rank">${j + 1}</td><td>${ownChip(S, r.o)}</td><td class="num">${r.tips}</td><td class="num"><b>${r.hits}</b></td><td class="num">${kcB(r.staked).replace(" Kč", "")}</td><td class="num">${kcB(r.won).replace(" Kč", "")}</td><td class="num bal ${r.bal > 0 ? "plus" : r.bal < 0 ? "owe" : ""}"><b>${sKcB(r.bal).replace(" Kč", "")}</b></td></tr>`).join("")}</tbody></table></div>
  <p class="note">Vsadil = tipy, jejichž peníze už někdo vyhrál (i přes jackpot). Peníze v jackpotu (${kcB(jp)}) se naúčtují, až ho někdo trefí.</p>
  ${bobSettle(S, mk, "Kdo komu platí")}`;
}
