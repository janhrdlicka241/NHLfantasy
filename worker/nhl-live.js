// Cloudflare Worker „nhl-live“ – pro aplikaci Fantasy NHL:
//  1) GET  /score/now, /score/RRRR-MM-DD, /gamecenter/ID/landing|boxscore – přeposílá živá data NHL (NHL nedovoluje číst je z webu přímo)
//  2) POST /translate – překládá novinky z NHL do češtiny přes Workers AI (vyžaduje binding „AI“ typu Workers AI)
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const SYS = "Jsi překladatel sportovních zpráv o hokejové NHL. Přelož titulek (t) a popis (d) z angličtiny do přirozené, stručné češtiny, jak by to napsal český sportovní novinář. Jména hráčů, trenérů a názvy týmů nepřekládej. Odpověz pouze JSON objektem {\"t\":\"…\",\"d\":\"…\"} bez dalšího textu.";
export default {
  async fetch(req, env) {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const path = new URL(req.url).pathname.replace(/^\/+/, "");

    if (path === "translate" && req.method === "POST") {
      if (!env.AI) return json({ error: "chybí binding AI (Workers AI)" }, 501);
      let body; try { body = await req.json(); } catch { return json({ error: "špatný požadavek" }, 400); }
      const out = [];
      for (const it of (body.items || []).slice(0, 10)) {
        const t = String(it.t || "").slice(0, 300), d = String(it.d || "").slice(0, 600);
        try {
          const r = await env.AI.run(MODEL, { messages: [{ role: "system", content: SYS }, { role: "user", content: JSON.stringify({ t, d }) }], max_tokens: 500 });
          let x = r?.response ?? r;
          if (typeof x === "string") { const m = x.match(/\{[\s\S]*\}/); x = m ? JSON.parse(m[0]) : null; }
          out.push({ id: it.id, t: x?.t || "", d: x?.d || "" });
        } catch (e) { out.push({ id: it.id, error: String(e.message || e) }); }
      }
      return json({ items: out });
    }

    if (req.method !== "GET" || !/^(score\/(now|\d{4}-\d{2}-\d{2})|gamecenter\/\d{10}\/(landing|boxscore))$/.test(path)) return json({ error: "neznámá adresa" }, 404);
    const r = await fetch(`https://api-web.nhle.com/v1/${path}`, { cf: { cacheTtl: 15, cacheEverything: true }, headers: { "User-Agent": "fantasy-nhl-live" } });
    return new Response(r.body, { status: r.status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=15" } });
  },
};
