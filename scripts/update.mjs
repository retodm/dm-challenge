// Actualiza data/ranking.json con las victorias de Deathmatch + Team Deathmatch
// de cada tracker listado en trackers.json, para la temporada de config.json.
//
// Estrategia (de más ligera a más pesada, para no saturar ni ser baneados):
//   1) API JSON interna de tracker.gg (la misma que usa su web).
//   2) Si la API responde 403/429 (Cloudflare), se abre la página con un
//      navegador real (Chrome del runner) y se leen las respuestas JSON que
//      la propia página descarga, o en último caso el HTML (Wins + avatar).
//   3) Si todo falla para un jugador, se conserva su último dato bueno.
//
// Uso: node scripts/update.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const ROOT = new URL("..", import.meta.url);
const path = (p) => new URL(p, ROOT);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const API = "https://api.tracker.gg/api/v2/valorant/standard/profile/riot/";
// Playlists que cuentan: Deathmatch y Team Deathmatch ("hurm" en la API de Riot)
const PLAYLISTS = { deathmatch: "dmWins", hurm: "tdmWins" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pause = () => sleep(2500 + Math.random() * 3000); // 2.5–5.5 s entre peticiones

// ---------- utilidades ----------

export function parseTracker(url, defaultSeason) {
  const u = new URL(url.trim());
  const m = u.pathname.match(/\/valorant\/profile\/riot\/([^/]+)/);
  if (!m) throw new Error(`URL de tracker no válida: ${url}`);
  const riotId = decodeURIComponent(m[1]);
  const [name, tag = ""] = riotId.split("#");
  return {
    riotId,
    name,
    tag,
    season: u.searchParams.get("season") || defaultSeason,
    url: u.toString(),
  };
}

function pageUrl(p, playlist) {
  return (
    `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(p.riotId)}/overview` +
    `?platform=pc&playlist=${playlist}&season=${p.season}`
  );
}

// Busca en cualquier JSON de tracker.gg el segmento de una playlist/temporada
// y devuelve matchesWon.
export function winsFromJson(json, playlist, season) {
  const segs = [];
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (o.attributes && o.stats) segs.push(o);
    Object.values(o).forEach(walk);
  };
  walk(json);
  const seg = segs.find(
    (s) =>
      s.attributes.playlist === playlist &&
      (!s.attributes.seasonId || !season || s.attributes.seasonId === season) &&
      s.stats.matchesWon
  );
  const v = seg?.stats?.matchesWon?.value;
  return typeof v === "number" ? v : null;
}

export function avatarFromJson(json) {
  return json?.data?.platformInfo?.avatarUrl || null;
}

class BlockedError extends Error {}

async function getJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      Origin: "https://tracker.gg",
      Referer: "https://tracker.gg/",
    },
  });
  if (res.status === 403 || res.status === 429 || res.status === 503)
    throw new BlockedError(`HTTP ${res.status}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.json();
}

// ---------- estrategia 1: API ----------

async function viaApi(p) {
  const base = API + encodeURIComponent(p.riotId);
  const out = { avatar: null, dmWins: 0, tdmWins: 0 };
  const profile = await getJson(`${base}?source=web`);
  out.avatar = avatarFromJson(profile);
  for (const [pl, key] of Object.entries(PLAYLISTS)) {
    await pause();
    const seg = await getJson(
      `${base}/segments/playlist?playlist=${pl}&seasonId=${p.season}&source=web`
    );
    out[key] = winsFromJson(seg, pl, p.season) ?? 0; // sin segmento = 0 partidas
  }
  return out;
}

// ---------- estrategia 2: navegador ----------

let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import("playwright-core");
      const opts = { headless: true, args: ["--disable-blink-features=AutomationControlled"] };
      // En GitHub Actions hay Google Chrome instalado; en local se puede usar CHROME_PATH
      if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
      else opts.channel = "chrome";
      const browser = await chromium.launch(opts);
      const ctx = await browser.newContext({ userAgent: UA, locale: "es-ES" });
      return { browser, ctx };
    })();
  }
  return browserPromise;
}

async function viaBrowser(p) {
  const { ctx } = await getBrowser();
  const out = { avatar: null, dmWins: 0, tdmWins: 0 };
  for (const [pl, key] of Object.entries(PLAYLISTS)) {
    const page = await ctx.newPage();
    const jsons = [];
    page.on("response", async (r) => {
      if (r.url().includes("api.tracker.gg/api/v2/valorant/standard/profile/riot/")) {
        try { jsons.push(await r.json()); } catch {}
      }
    });
    try {
      await page.goto(pageUrl(p, pl), { waitUntil: "domcontentloaded", timeout: 60000 });
      // Espera a que cargue el perfil (o a que Cloudflare resuelva su comprobación)
      await page.waitForSelector(".user-avatar__image, .stat", { timeout: 45000 }).catch(() => {});
      await sleep(3000);

      let wins = null;
      for (const j of jsons) {
        wins ??= winsFromJson(j, pl, p.season);
        out.avatar ??= avatarFromJson(j);
      }
      // Último recurso: leer el HTML
      const dom = await page.evaluate(() => {
        const img = document.querySelector("img.user-avatar__image");
        let wins = null;
        for (const el of document.querySelectorAll("span, div, h3")) {
          if (el.children.length === 0 && el.textContent.trim() === "Wins") {
            const box = el.closest(".stat, .numbers, .giant-stats > *") || el.parentElement;
            const n = box && box.textContent.replace("Wins", "").match(/[\d,.]+/);
            if (n) { wins = parseInt(n[0].replace(/[.,]/g, ""), 10); break; }
          }
        }
        const noData = /no (matches|stats|data)/i.test(document.body.innerText);
        return { avatar: img?.src || null, wins, noData };
      });
      out.avatar ??= dom.avatar;
      wins ??= dom.wins;
      if (wins == null && !dom.noData) throw new Error(`No se encontraron Wins (${pl})`);
      out[key] = wins ?? 0;
    } finally {
      await page.close();
    }
    await pause();
  }
  return out;
}

// ---------- principal ----------

async function fetchPlayer(p, prev) {
  let data, source;
  try {
    data = await viaApi(p);
    source = "api";
  } catch (e) {
    console.warn(`  API falló para ${p.riotId}: ${e.message} → probando navegador`);
    data = await viaBrowser(p);
    source = "browser";
  }
  return {
    ...p,
    avatar: data.avatar || prev?.avatar || null,
    dmWins: data.dmWins,
    tdmWins: data.tdmWins,
    wins: data.dmWins + data.tdmWins,
    source,
    ok: true,
    lastOkAt: new Date().toISOString(),
  };
}

async function main() {
  const config = JSON.parse(await readFile(path("config.json"), "utf8"));
  const list = JSON.parse(await readFile(path("trackers.json"), "utf8"));
  const prevFile = path("data/ranking.json");
  const prev = existsSync(prevFile) ? JSON.parse(await readFile(prevFile, "utf8")) : {};
  const prevBy = new Map(
    [...(prev.players || []), prev.retador].filter(Boolean).map((x) => [x.riotId.toLowerCase(), x])
  );

  const entries = list
    .map((x) => (typeof x === "string" ? { url: x } : x))
    .filter((x) => x.url && x.url.trim());

  async function run(entry, label) {
    let p;
    try {
      p = parseTracker(entry.url, config.seasonId);
    } catch (e) {
      console.error(e.message);
      return null;
    }
    if (entry.nombre) p.displayName = entry.nombre;
    const old = prevBy.get(p.riotId.toLowerCase());
    console.log(`${label} ${p.riotId}`);
    try {
      const r = await fetchPlayer(p, old);
      console.log(`  ✓ DM ${r.dmWins} + TDM ${r.tdmWins} = ${r.wins} (${r.source})`);
      return r;
    } catch (e) {
      console.error(`  ✗ ${e.message}`);
      return {
        ...p,
        avatar: old?.avatar || null,
        dmWins: old?.dmWins ?? 0,
        tdmWins: old?.tdmWins ?? 0,
        wins: old?.wins ?? 0,
        ok: false,
        error: e.message,
        lastOkAt: old?.lastOkAt || null,
      };
    } finally {
      await pause();
    }
  }

  // Elimina duplicados por Riot ID
  const seen = new Set();
  const players = [];
  for (const entry of entries) {
    const r = await run(entry, "→");
    if (!r || seen.has(r.riotId.toLowerCase())) continue;
    seen.add(r.riotId.toLowerCase());
    players.push(r);
  }

  let retador = null;
  if (config.retador?.tracker) {
    retador = await run({ url: config.retador.tracker, nombre: config.retador.nombre }, "★");
  }

  players.sort((a, b) => b.wins - a.wins || b.dmWins - a.dmWins || a.riotId.localeCompare(b.riotId));

  const out = {
    updatedAt: new Date().toISOString(),
    seasonId: config.seasonId,
    retador,
    players,
  };
  await mkdir(path("data"), { recursive: true });
  await writeFile(prevFile, JSON.stringify(out, null, 2) + "\n");

  const okCount = players.filter((x) => x.ok).length;
  console.log(`\nListo: ${okCount}/${players.length} actualizados.`);

  if (browserPromise) (await browserPromise).browser.close();
  // Si absolutamente todo falló, se marca el job como fallido para enterarse
  if (players.length && okCount === 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
