// Cloudflare Worker „nhl-live“ – přeposílá živá data NHL do aplikace Fantasy NHL.
// NHL nedovoluje číst svoje data přímo z webové stránky (CORS), worker k nim přidá povolení.
// Pustí jen pár konkrétních adres a odpovědi drží 15 s v mezipaměti, takže NHL zbytečně nezatěžuje.
export default {
  async fetch(req) {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const path = new URL(req.url).pathname.replace(/^\/+/, "");
    if (!/^(score\/(now|\d{4}-\d{2}-\d{2})|gamecenter\/\d{10}\/(landing|boxscore))$/.test(path)) {
      return new Response(JSON.stringify({ error: "neznámá adresa" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
    }
    const r = await fetch(`https://api-web.nhle.com/v1/${path}`, { cf: { cacheTtl: 15, cacheEverything: true }, headers: { "User-Agent": "fantasy-nhl-live" } });
    return new Response(r.body, { status: r.status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=15" } });
  },
};
