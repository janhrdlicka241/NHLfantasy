// Načtení a uložení stavu ve Firestore (firebase-admin obchází pravidla – zapisuje jen tento skript).
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

export function db() {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  if (!sa.project_id) throw new Error("Chybí secret FIREBASE_SERVICE_ACCOUNT (JSON servisního účtu Firebase).");
  initializeApp({ credential: cert(sa) });
  return getFirestore();
}

// Timestamp → ISO řetězec, ať logika pracuje jen s řetězci
const iso = (v) => (v instanceof Timestamp ? v.toDate().toISOString() : v);
const clean = (o) => {
  if (Array.isArray(o)) return o.map(clean);
  if (o && typeof o === "object" && !(o instanceof Timestamp)) return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, clean(v)]));
  return iso(o);
};

export async function load(fs) {
  const [league, meta, rosters, rosterPicks, picks, injuries, months] = await Promise.all([
    fs.doc("config/league").get(), fs.doc("meta/state").get(),
    fs.collection("rosters").get(), fs.collection("rosterPicks").get(),
    fs.collection("picks").where("status", "==", "pending").get(),
    fs.collection("injuries").where("active", "==", true).get(),
    fs.collection("months").get(),
  ]);
  if (!league.exists) throw new Error("Liga ještě není založená – spusť workflow v režimu seed.");
  const byId = (snap, keyed) => Object.fromEntries(snap.docs.map((d) => [d.id, clean({ ...d.data(), ...(keyed ? {} : { id: d.id }) })]));
  return {
    league: clean(league.data()), meta: clean(meta.exists ? meta.data() : {}),
    rosters: byId(rosters, true), rosterPicks: byId(rosterPicks, true),
    picks: picks.docs.map((d) => clean({ ...d.data(), id: d.id })),
    injuries: injuries.docs.map((d) => clean({ ...d.data(), id: d.id })),
    months: byId(months, true),
  };
}

export async function save(fs, st, extra) {
  const writes = [];
  for (const path of st.dirty) {
    const [col, id] = path.split("/");
    let data;
    if (col === "rosters") data = st.rosters[id];
    else if (col === "rosterPicks") data = st.rosterPicks[id];
    else if (col === "months") data = st.months[id];
    else if (col === "injuries") { const { id: _, ...rest } = st.injuries.find((i) => i.id === id); data = rest; }
    else if (col === "picks") { const p = st.picks.find((x) => x.id === id); data = { status: p.status, reason: p.reason || null }; }
    writes.push([fs.doc(path), data, col === "picks"]);
  }
  for (const f of st.feed) writes.push([fs.collection("feed").doc(), f, false]);
  for (const [path, data] of Object.entries(extra)) writes.push([fs.doc(path), data, false]);
  // dávky po 400 zápisech
  for (let i = 0; i < writes.length; i += 400) {
    const b = fs.batch();
    for (const [ref, data, merge] of writes.slice(i, i + 400)) merge ? b.set(ref, data, { merge: true }) : b.set(ref, data);
    await b.commit();
  }
  return writes.length;
}
