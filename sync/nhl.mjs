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
    })),
  }));
}
export const isFinal = (g) => g.state === "OFF" || g.state === "FINAL";
export const isLive = (g) => g.state === "LIVE" || g.state === "CRIT";

export const boxscore = (id) => getJson(`${WEB}/gamecenter/${id}/boxscore`);
export const landing = (id) => getJson(`${WEB}/gamecenter/${id}/landing`);

// Odehrané zápasy týmů v sezóně (pro počítadlo 82)
export async function teamGamesPlayed() {
  const j = await getJson(`${WEB}/standings/now`);
  const out = {};
  for (const t of j.standings || []) out[t.teamAbbrev?.default] = t.gamesPlayed || 0;
  return out;
}

const lastTeam = (s) => (s || "").split(",").pop().trim();
// Všichni hráči sezóny se statistikami
export async function pool(seasonId) {
  const exp = encodeURIComponent(`seasonId=${seasonId} and gameTypeId=2`);
  const sk = await getJson(`${STATS}/skater/summary?limit=-1&sort=points&cayenneExp=${exp}`);
  const go = await getJson(`${STATS}/goalie/summary?limit=-1&sort=wins&cayenneExp=${exp}`);
  return {
    skaters: (sk.data || []).map((p) => [p.playerId, p.skaterFullName, lastTeam(p.teamAbbrevs), p.positionCode, p.gamesPlayed, p.goals, p.assists]),
    goalies: (go.data || []).map((p) => [p.playerId, p.goalieFullName, lastTeam(p.teamAbbrevs), p.gamesPlayed, p.wins, p.losses, p.otLosses,
      p.goalsAgainstAverage == null ? null : Math.round(p.goalsAgainstAverage * 100) / 100,
      p.savePct == null ? null : Math.round(p.savePct * 1000) / 1000, p.shutouts]),
  };
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
