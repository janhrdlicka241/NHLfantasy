import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, collection, onSnapshot, query, where, orderBy, limit, setDoc, addDoc, updateDoc, serverTimestamp, Timestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import * as V from "./views.js";

const db = getFirestore(initializeApp(firebaseConfig));
const iso = (v) => (v instanceof Timestamp ? v.toDate().toISOString() : v);
const norm = (o) => Array.isArray(o) ? o.map(norm) : o && typeof o === "object" && !(o instanceof Timestamp)
  ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, norm(v)])) : iso(o);

let raf = 0;
const S = { league: null, rosters: {}, rosterPicks: {}, months: {}, injuries: [], picks: [], feed: [], pool: null, upcoming: null, results: null, meta: null };
const store = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const keep = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const U = { me: store("fnhl-me"), month: null, tab: "tabulka", openT: new Set(), openM: new Set(), q: {}, sel: {}, slotOpen: null, pickOpen: null, sortK: "pts", onlyFree: false, openInj: new Set(), sortG: "w", allG: false };
const TABS = ["tabulka", "den", "tymy", "zraneni", "nhl", "vyuctovani"];
const h = (location.hash || "").slice(1); if (TABS.includes(h)) U.tab = h;

// --- živá data ---
const one = (path, key) => onSnapshot(doc(db, path), (d) => { S[key] = d.exists() ? norm(d.data()) : null; render(); }, err);
const map = (col, key) => onSnapshot(collection(db, col), (q) => { S[key] = Object.fromEntries(q.docs.map((d) => [d.id, norm(d.data())])); render(); }, err);
const list = (qq, key) => onSnapshot(qq, (q) => { S[key] = q.docs.map((d) => ({ ...norm(d.data()), id: d.id })); render(); }, err);
function err(e) { console.error(e); document.getElementById("view").innerHTML = `<div class="panel empty">Nepodařilo se načíst data (${V.esc(e.code || e.message)}). Zkontroluj firebase-config.js a pravidla Firestore.</div>`; }
one("config/league", "league"); one("public/pool", "pool"); one("public/upcoming", "upcoming"); one("public/results", "results"); one("meta/state", "meta");
map("rosters", "rosters"); map("rosterPicks", "rosterPicks"); map("months", "months");
list(collection(db, "injuries"), "injuries"); // všechna – aktivní i ukončená (kvůli kontrole zápasů)
list(query(collection(db, "picks"), where("status", "==", "pending")), "picks");
list(query(collection(db, "feed"), orderBy("ts", "desc"), limit(40)), "feed");

// --- vykreslení ---
function render() { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); }
function draw() {
  const owners = S.league?.owners || [];
  const sel = document.getElementById("meSel");
  if (owners.length && sel.options.length !== owners.length) sel.innerHTML = owners.map((o) => `<option>${V.esc(o)}</option>`).join("");
  if (owners.length && (!U.me || !owners.includes(U.me))) showWho(owners); else document.getElementById("whoOv").hidden = true;
  if (U.me) sel.value = U.me;
  const keys = Object.keys(S.months).sort(), cur = V.nyDate().slice(0, 7);
  if (!U.month || !keys.includes(U.month)) U.month = keys.includes(cur) ? cur : keys[keys.length - 1] || cur;
  const i = keys.indexOf(U.month);
  document.getElementById("mLabel").textContent = V.monthLabel(U.month);
  document.getElementById("mSub").textContent = S.months[U.month]?.locked ? "uzavřeno" : U.month === cur ? "průběžně" : "";
  document.getElementById("prevM").disabled = i <= 0; document.getElementById("nextM").disabled = i < 0 || i >= keys.length - 1;
  document.querySelectorAll("nav button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === U.tab));
  // odznak: nepřečtená oznámení od poslední návštěvy záložky Zranění; červeně, když musím vybrat náhradníka
  const bd = document.getElementById("injBadge");
  if (U.tab === "zraneni") { U.seen = new Date().toISOString(); keep("fnhl-seen-" + U.me, U.seen); }
  else U.seen = store("fnhl-seen-" + U.me) || "";
  const mine = S.injuries.filter((x) => x.active && x.owner === U.me && x.needPick).length;
  const unread = S.feed.filter((f) => f.ts > U.seen).length;
  bd.textContent = mine || unread || ""; bd.classList.toggle("hot", mine > 0);
  // zachovat fokus ve vyhledávání
  const f = document.activeElement, fid = f?.id, pos = f?.selectionStart;
  const view = { tabulka: V.vTabulka, den: V.vDen, tymy: V.vTymy, zraneni: V.vZraneni, nhl: V.vNhl, vyuctovani: V.vVyuct }[U.tab];
  document.getElementById("view").innerHTML = S.league ? view(S, U) : `<div class="panel empty">Liga ještě není založená – spusť na GitHubu workflow „NHL data“ v režimu seed.</div>`;
  if (fid) { const n = document.getElementById(fid); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } }
  document.getElementById("upd").textContent = S.meta?.lastRun ? `Data z NHL aktualizována ${new Date(S.meta.lastRun).toLocaleString("cs-CZ")}` : "";
}
function showWho(owners) {
  const ov = document.getElementById("whoOv"); ov.hidden = false;
  document.getElementById("whoGrid").innerHTML = owners.map((o) => `<button class="btn" data-who="${V.esc(o)}">${V.esc(o)}</button>`).join("");
}
document.getElementById("whoGrid").addEventListener("click", (e) => { const b = e.target.closest("[data-who]"); if (b) setMe(b.dataset.who); });
document.getElementById("meSel").onchange = (e) => setMe(e.target.value);
function setMe(o) { U.me = o; keep("fnhl-me", o); U.slotOpen = null; U.pickOpen = null; render(); }
document.getElementById("prevM").onclick = () => { const k = Object.keys(S.months).sort(); U.month = k[k.indexOf(U.month) - 1] || U.month; render(); };
document.getElementById("nextM").onclick = () => { const k = Object.keys(S.months).sort(); U.month = k[k.indexOf(U.month) + 1] || U.month; render(); };
document.querySelectorAll("nav button").forEach((b) => b.onclick = () => go(b.dataset.tab));
function go(t) { U.tab = t; try { history.replaceState(null, "", "#" + t); } catch {} render(); scrollTo(0, 0); }

// --- akce ---
const findPlayer = (id) => {
  for (const pos of ["F", "D", "G"]) { const p = V.poolList(S, pos).find((x) => x.id === id); if (p) return p; }
  return null;
};
async function saveRoster(players, status) {
  const data = { owner: U.me, players, status, updatedAt: serverTimestamp() };
  if (status === "pending") data.confirmedAt = serverTimestamp();
  try { await setDoc(doc(db, "rosterPicks", U.me), data); } catch (e) { alert2(`Uložení se nepovedlo: ${e.message}`); }
}
function alert2(msg) { const v = document.getElementById("view"); v.insertAdjacentHTML("afterbegin", `<div class="status bad" style="margin-bottom:10px">${V.esc(msg)}</div>`); }

document.getElementById("view").addEventListener("click", async (e) => {
  const t = e.target.closest("[data-act]"); if (!t) return;
  const a = t.dataset.act;
  if (a === "tab") return go(t.dataset.tab);
  if (a === "toggleT") { const o = t.dataset.o; U.openT.has(o) ? U.openT.delete(o) : U.openT.add(o); }
  else if (a === "mopen") { if (e.target.closest('[data-act="paid"]')) return; const k = t.dataset.m; U.openM.has(k) ? U.openM.delete(k) : U.openM.add(k); }
  else if (a === "paid") { e.stopPropagation(); const k = t.dataset.m; try { await updateDoc(doc(db, "months", k), { paid: !S.months[k].paid }); } catch (er) { alert2(er.message); } return; }
  else if (a === "sort") U.sortK = t.dataset.k;
  else if (a === "injdet") { e.stopPropagation(); const k = t.dataset.id; U.openInj.has(k) ? U.openInj.delete(k) : U.openInj.add(k); }
  else if (a === "games") U.games = t.dataset.k;
  else if (a === "sortg") U.sortG = t.dataset.k;
  else if (a === "allg") U.allG = !U.allG;
  else if (a === "free") U.onlyFree = t.checked;
  else if (a === "sel") U.sel[t.dataset.ctx] = +t.dataset.id;
  else if (a === "slot") { U.slotOpen = U.slotOpen === t.dataset.k ? null : t.dataset.k; }
  else if (a === "slotok") {
    const k = t.dataset.k, p = findPlayer(U.sel["slot-" + k]); if (!p) return;
    const players = { ...(S.rosterPicks[U.me]?.players || {}), [k]: { id: p.id, name: p.name, team: p.team, pos: p.pos } };
    U.slotOpen = null; delete U.sel["slot-" + k];
    await saveRoster(players, "draft"); return;
  }
  else if (a === "confirm") { await saveRoster(S.rosterPicks[U.me]?.players || {}, "pending"); return; }
  else if (a === "unconfirm") { await saveRoster(S.rosterPicks[U.me]?.players || {}, "draft"); return; }
  else if (a === "pickopen") U.pickOpen = U.pickOpen === t.dataset.id ? null : t.dataset.id;
  else if (a === "pickok") {
    const inj = S.injuries.find((i) => i.id === t.dataset.id), p = findPlayer(U.sel["inj-" + inj.id]);
    if (!inj || !p || inj.owner !== U.me) return;
    try { await addDoc(collection(db, "picks"), { injuryId: inj.id, owner: U.me, playerId: p.id, name: p.name, team: p.team, pos: p.pos, createdAt: serverTimestamp(), status: "pending" }); }
    catch (er) { alert2(`Výběr se nepovedl: ${er.message}`); }
    U.pickOpen = null; return;
  }
  else return;
  render();
});
document.getElementById("view").addEventListener("input", (e) => { const t = e.target; if (t.classList.contains("srch")) { U.q[t.dataset.ctx] = t.value; render(); } });
render();
