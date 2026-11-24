// Napojení na veřejné (neoficiální) NHL API a ESPN. Všechny adresy na jednom místě.
const WEB = "https://api-web.nhle.com/v1";
const STATS = "https://api.nhle.com/stats/rest/en";
const ESPN_INJ = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries";

async function getJson(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "fantasy-nhl-friends/1.0" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise((res) => setTimeout(res, 1500 * i));
    }
  }
}

// Rozpis týdne od data (NHL čas): [{date, games:[{id,date,start,away,home,state,type}]}]
export async function scheduleWeek(date) {
  const j = await getJson(`${WEB}/schedule/${date}`);
  return (j.gameWeek || []).map((d) => ({
    date: d.date,
    games: (d.games || []).map((g) => ({
      id: g.id, date: d.date, start: g.startTimeUTC, type: g.gameType, state: g.gameState,
      away: g.awayTeam?.abbrev, home: g.homeTeam?.abbrev,
      venue: g.venue?.default || "",
      as: g.awayTeam?.score ?? null, hs: g.homeTeam?.score ?? null, last: g.gameOutcome?.lastPeriodType || null,
    })),
  }));
}
export const isFinal = (g) => g.state === "OFF" || g.state === "FINAL";
export const isLive = (g) => g.state === "LIVE" || g.state === "CRIT";

export const boxscore = (id) => getJson(`${WEB}/gamecenter/${id}/boxscore`);
export const landing = (id) => getJson(`${WEB}/gamecenter/${id}/landing`);

// Tabulka NHL (pořadí, divize, konference) – zároveň odehrané zápasy týmů pro počítadlo 84
export async function standings() {
  const j = await getJson(`${WEB}/standings/now`);
  return (j.standings || []).map((t) => ({
    t: t.teamAbbrev?.default, n: t.teamName?.default || t.placeName?.default || "", pl: t.placeName?.default || "", cn: t.teamCommonName?.default || "",
    gf: t.goalFor ?? null, ga: t.goalAgainst ?? null, conf: t.conferenceName || "", div: t.divisionName || "",
    gp: t.gamesPlayed || 0, w: t.wins || 0, l: t.losses || 0, ot: t.otLosses || 0, pts: t.points || 0, gd: t.goalDifferential ?? 0,
    ds: t.divisionSequence || 0, cs: t.conferenceSequence || 0, ls: t.leagueSequence || 0, wc: t.wildcardSequence || 0,
  })).filter((t) => t.t);
}
// Přesilovky a oslabení týmů (podle plného názvu – statistiky NHL nemají zkratky)
export async function teamStats(seasonId) {
  const exp = encodeURIComponent(`seasonId=${seasonId} and gameTypeId=2`);
  const j = await getJson(`${STATS}/team/summary?limit=100&cayenneExp=${exp}`);
  return (j.data || []).map((t) => ({ name: t.teamFullName, pp: t.powerPlayPct, pk: t.penaltyKillPct }));
}
// Střídání hráčů (pro spočítání formací) a videa k zápasu
export const shiftcharts = (id) => getJson(`${STATS}/shiftcharts?cayenneExp=${encodeURIComponent(`gameId=${id}`)}`);
export const rightRail = (id) => getJson(`${WEB}/gamecenter/${id}/right-rail`);
export async function teamGamesPlayed() {
  return Object.fromEntries((await standings()).map((t) => [t.t, t.gp]));
}

const lastTeam = (s) => (s || "").split(",").pop().trim();
// Všichni hráči sezóny se statistikami
// Statistiky NHL vrací najednou jen omezený počet řádků (limit=-1 už nefunguje) – stahujeme po stránkách
const SORT_ID = encodeURIComponent(JSON.stringify([{ property: "playerId", direction: "ASC" }]));
export async function statsAll(path, exp, tries) {
  const out = [], seen = new Set(), PAGE = 100;
  for (let start = 0; start < 5000; start += PAGE) {
    const j = await getJson(`${STATS}/${path}?start=${start}&limit=${PAGE}&sort=${SORT_ID}&cayenneExp=${exp}`, tries);
    const d = j.data || [];
    for (const r of d) { const k = r.playerId ?? r.teamId ?? JSON.stringify(r); if (!seen.has(k)) { seen.add(k); out.push(r); } }
    if (d.length < PAGE || (j.total != null && out.length >= j.total)) break;
  }
  return { data: out };
}
export async function pool(seasonId) {
  const exp = encodeURIComponent(`seasonId=${seasonId} and gameTypeId=2`);
  const sk = await statsAll("skater/summary", exp);
  const go = await statsAll("goalie/summary", exp);
  console.log(`Statistiky NHL: ${sk.data.length} hráčů v poli, ${go.data.length} brankářů`);
  // národnost (bios) a nováčci – nepovinné, když selžou, jede se bez nich
  const nat = new Map(), rook = new Set();
  for (const kind of ["skater", "goalie"]) {
    try { const b = await statsAll(`${kind}/bios`, exp, 2); for (const p of b.data || []) if (p.nationalityCode) nat.set(p.playerId, p.nationalityCode); }
    catch (e) { console.log(`Národnost (${kind}):`, e.message); }
  }
  try { const r = await statsAll("skater/summary", encodeURIComponent(`seasonId=${seasonId} and gameTypeId=2 and isRookie='1'`), 2); for (const p of r.data || []) rook.add(p.playerId); }
  catch (e) { console.log("Nováčci:", e.message); }
  console.log(`Národnost: ${nat.size} hráčů, nováčků: ${rook.size}`);
  return {
    skaters: (sk.data || []).map((p) => [p.playerId, p.skaterFullName, lastTeam(p.teamAbbrevs), p.positionCode, p.gamesPlayed, p.goals, p.assists, nat.get(p.playerId) || "", rook.has(p.playerId) ? 1 : 0]),
    goalies: (go.data || []).map((p) => [p.playerId, p.goalieFullName, lastTeam(p.teamAbbrevs), p.gamesPlayed, p.wins, p.losses, p.otLosses,
      p.goalsAgainstAverage == null ? null : Math.round(p.goalsAgainstAverage * 100) / 100,
      p.savePct == null ? null : Math.round(p.savePct * 1000) / 1000, p.shutouts, nat.get(p.playerId) || ""]),
  };
}

// Soupisky všech týmů – doplní hráče, kteří zatím nenastoupili (hlavně brankáře)
export async function rosters(teams) {
  const out = [];
  for (const t of teams) {
    try {
      const j = await getJson(`${WEB}/roster/${t}/current`, 2);
      for (const p of [...(j.forwards || []), ...(j.defensemen || []), ...(j.goalies || [])]) {
        out.push({ id: p.id, name: `${p.firstName?.default || ""} ${p.lastName?.default || ""}`.trim(), team: t, pos: p.positionCode });
      }
    } catch (e) { console.log(`Soupiska ${t} nedostupná: ${e.message}`); }
  }
  return out;
}

// Seznam zranění z ESPN (nepovinné – když selže, jede se dál)
export async function espnInjuries() {
  const j = await getJson(ESPN_INJ, 2);
  const out = [];
  for (const team of j.injuries || []) for (const i of team.injuries || []) {
    const name = i.athlete?.displayName; if (!name) continue;
    const ret = i.details?.returnDate ? `návrat odhadem ${new Date(i.details.returnDate).toLocaleDateString("cs-CZ")}` : "";
    out.push({ name, status: [i.status, i.details?.type].filter(Boolean).join(" – "), ret });
  }
  return out;
}

// Novinky ESPN o NHL (titulek, popis, fotka, odkaz, hráči a týmy, o kterých zpráva je)
export async function espnNews(limit = 40) {
  const j = await getJson(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/news?limit=${limit}`, 2);
  return (j.articles || []).filter((a) => a.headline && a.links?.web?.href).map((a) => ({
    id: String(a.id || a.dataSourceIdentifier || a.links.web.href), te: a.headline, de: a.description || "", url: a.links.web.href,
    img: a.images?.[0]?.url || "", ts: a.published || a.lastModified || "", src: "ESPN",
    ath: (a.categories || []).filter((c) => c.type === "athlete" && c.description).map((c) => c.description),
    tm: (a.categories || []).filter((c) => c.type === "team" && c.description).map((c) => c.description),
  }));
}
// překlad přes Cloudflare Worker s AI
export async function translate(items) {
  const r = await fetch(`${LIVE_WORKER}/translate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
  if (!r.ok) throw new Error(`překlad ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return (await r.json()).items || [];
}
export const LIVE_WORKER = "https://nhl-live.janhrdlicka241.workers.dev";

// Novinky NHL.com (obsahové API NHL); vynecháme každodenní předzápasové sestavy, kterých je moc
export async function nhlNews(limit = 40) {
  const j = await getJson(`https://forge-dapi.d3.nhle.com/v2/content/en-us/stories?tags.slug=nhl&$limit=${limit}`, 2);
  return (j.items || []).filter((x) => x.slug && x.headline)
    .filter((x) => !(x.tags || []).some((t) => t.slug === "game-preview" || t.slug === "lineup"))
    .map((x) => {
      const firstPar = String(x.summary || "").split("\n").map((s) => s.trim()).find((s) => s.length > 30) || "";
      const tpl = x.thumbnail?.templateUrl || "";
      return {
        id: `nhl-${x._entityId || x.slug}`, te: x.headline, de: (x.fields?.description || firstPar).slice(0, 300),
        url: `https://www.nhl.com/news/${x.slug}`, img: tpl ? tpl.replace("{formatInstructions}", "t_ratio16_9-size20") : (x.thumbnail?.thumbnailUrl || ""),
        ts: x.contentDate || x.lastUpdatedDate || "", src: "NHL.com",
        ath: (x.tags || []).filter((t) => t.externalSourceName === "player" && t.title).map((t) => t.title),
        tm: (x.tags || []).filter((t) => t.externalSourceName === "team" && t.title).map((t) => t.title),
      };
    });
}

// Spekulace a přesuny – RSS kanály ProHockeyRumors a Daily Faceoff
const unent = (s) => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ")
  .replace(/&#8217;|&rsquo;/g, "’").replace(/&#8216;|&lsquo;/g, "‘").replace(/&#8220;|&ldquo;/g, "“").replace(/&#8221;|&rdquo;/g, "”").replace(/&#8211;|&ndash;/g, "–").replace(/&#8212;|&mdash;/g, "—")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ").trim();
export async function rssNews(url, src, limit = 25) {
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (fantasy-nhl)" } });
  if (!r.ok) throw new Error(`${src} ${r.status}`);
  const xml = await r.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit).map(([, it]) => {
    const tag = (n) => (it.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)<\\/${n}>`)) || [])[1] || "";
    const link = unent(tag("link")), img = (it.match(/<media:content[^>]+url="([^"]+)"/) || it.match(/<enclosure[^>]+url="([^"]+)"/) || it.match(/<img[^>]+src="([^"]+)"/) || [])[1] || "";
    const d = unent(tag("description")).replace(/\s*The post .*$/, "").replace(/\s*\[…\]\s*$|\s*\[&#8230;\]\s*$/, "…");
    const ts = Date.parse(unent(tag("pubDate")));
    return { id: `${src}-${link}`, te: unent(tag("title")), de: d.slice(0, 300), url: link, img, ts: isFinite(ts) ? new Date(ts).toISOString() : "", src,
      cat: [...it.matchAll(/<category>([\s\S]*?)<\/category>/g)].map((m) => unent(m[1])).slice(0, 8), rum: true, ath: [], tm: [] };
  }).filter((x) => x.te && x.url);
}
