// Actualiza data/ranking.json con las victorias de Deathmatch + Team Deathmatch
// de cada jugador de trackers.json durante el acto (config.json → seasonId).
//
// Fuente: HenrikDev API (https://docs.henrikdev.xyz), que da acceso al historial
// público de partidas de Riot. Requiere la variable de entorno HENRIK_API_KEY.
//
// Cada partida se guarda en data/matches.json la primera vez que se ve, así que:
//   - nunca se cuenta dos veces,
//   - no se pierde aunque salga del historial reciente de Riot,
//   - cada partida solo se consulta una vez (menos peticiones).
//
// Uso:
//   HENRIK_API_KEY=xxxx node scripts/update.mjs            → actualiza los ficheros
//   HENRIK_API_KEY=xxxx node scripts/update.mjs --dry-run  → solo muestra resultados
//   ... --debug                                            → detalle de cada partida

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const ROOT = new URL("..", import.meta.url);
const path = (p) => new URL(p, ROOT);
const DRY = process.argv.includes("--dry-run");
const DEBUG = process.argv.includes("--debug");
const KEY = process.env.HENRIK_API_KEY;
const BASE = "https://api.henrikdev.xyz";

// Modos que cuentan. "hurm" es el id interno de Riot para Team Deathmatch.
const MODES = [
  { key: "dm", query: "deathmatch", queues: ["deathmatch"] },
  { key: "tdm", query: "teamdeathmatch", queues: ["hurm", "teamdeathmatch"] },
];
const DM_KILL_LIMIT = 40; // en DM gana quien llega a 40 kills (o quien más tenga al acabar el tiempo)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;
const lc = (s) => String(s ?? "").toLowerCase();

// ---------- HTTP con límite de ritmo ----------
// HenrikDev (clave Basic) permite 30 peticiones/minuto. Se leen sus cabeceras
// x-ratelimit-remaining / x-ratelimit-reset para ir lo más rápido posible sin pasarse.

const MIN_GAP_MS = 300;
let lastReq = 0;
let reqCount = 0;
let remaining = Infinity;
let resetAt = 0;

async function api(pathname, debugName) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (remaining <= 1 && Date.now() < resetAt) await sleep(resetAt - Date.now() + 500);
    const gap = lastReq + MIN_GAP_MS - Date.now();
    if (gap > 0) await sleep(gap);
    lastReq = Date.now();
    reqCount++;
    const res = await fetch(BASE + pathname, {
      headers: { Authorization: KEY, Accept: "application/json" },
    });
    const rem = Number(res.headers.get("x-ratelimit-remaining"));
    const rst = Number(res.headers.get("x-ratelimit-reset"));
    if (Number.isFinite(rem)) remaining = rem;
    if (Number.isFinite(rst)) resetAt = Date.now() + rst * 1000;
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after")) || rst || 60;
      console.warn(`  límite de peticiones alcanzado, esperando ${ra}s…`);
      remaining = 0;
      resetAt = Date.now() + ra * 1000;
      continue;
    }
    const body = await res.json().catch(() => null);
    if (DEBUG && debugName) {
      await mkdir(path("debug/"), { recursive: true });
      await writeFile(path(`debug/${debugName}.json`), JSON.stringify(body, null, 2));
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      const msg = body?.errors?.[0]?.message || body?.message || "";
      if (res.status >= 500 && attempt < 4) { await sleep(5000); continue; }
      throw new Error(`HTTP ${res.status} ${msg} (${pathname})`);
    }
    return body;
  }
  throw new Error(`Demasiados reintentos (${pathname})`);
}

// ---------- utilidades ----------

export function parseTracker(url) {
  const u = new URL(url.trim());
  const m = u.pathname.match(/\/valorant\/profile\/riot\/([^/]+)/);
  if (!m) throw new Error(`URL de tracker no válida: ${url}`);
  const riotId = decodeURIComponent(m[1]);
  const i = riotId.lastIndexOf("#");
  return { riotId, name: riotId.slice(0, i), tag: riotId.slice(i + 1), url: u.toString() };
}

const cardUrl = (card) => {
  if (!card) return null;
  if (typeof card === "object") return card.small || card.wide || card.large || null;
  return `https://media.valorant-api.com/playercards/${card}/smallart.png`;
};

// Normaliza una partida completa (formato v4 o v3 de HenrikDev).
export function normalizeMatch(m) {
  const md = m.metadata || {};
  const id = md.match_id || md.matchid;
  const queue = lc(md.queue?.id || md.mode_id || md.mode);
  const season = md.season?.id || md.season_id || null;
  const startedAt = md.started_at || (md.game_start ? new Date(md.game_start * 1000).toISOString() : null);
  const rawPlayers = Array.isArray(m.players) ? m.players : m.players?.all_players || [];
  const players = rawPlayers.map((p) => ({
    puuid: p.puuid,
    team: lc(p.team_id || p.team),
    kills: p.stats?.kills ?? 0,
    score: p.stats?.score ?? 0,
  }));
  let teams = {};
  if (Array.isArray(m.teams)) for (const t of m.teams) teams[lc(t.team_id)] = { won: t.won, rounds: t.rounds?.won };
  else if (m.teams) for (const [k, t] of Object.entries(m.teams)) if (t) teams[lc(k)] = { won: t.has_won, rounds: t.rounds_won };
  return { id, queue, season, startedAt, players, teams };
}

// ¿Ganó este jugador la partida?
export function didWin(match, puuid, modeKey) {
  const me = match.players.find((p) => p.puuid === puuid);
  if (!me) return null;
  if (modeKey === "tdm") {
    const t = match.teams[me.team];
    if (t && typeof t.won === "boolean") return t.won;
    // Sin dato de equipo: suma de kills por equipo
    const sum = {};
    for (const p of match.players) sum[p.team] = (sum[p.team] || 0) + p.kills;
    const others = Object.entries(sum).filter(([k]) => k !== me.team).map(([, v]) => v);
    return others.length ? sum[me.team] > Math.max(...others) : null;
  }
  // DM: gana quien más kills tiene (desempate por puntuación)
  const best = [...match.players].sort((a, b) => b.kills - a.kills || b.score - a.score)[0];
  return best?.puuid === puuid;
}

const modeOfQueue = (q) => MODES.find((m) => m.queues.includes(lc(q)) || lc(m.query) === lc(q).replace(/\s/g, ""));

// ---------- jugador ----------

async function updatePlayer(p, cache, config) {
  const acc = await api(`/valorant/v1/account/${enc(p.name)}/${enc(p.tag)}`, `account_${p.name}`);
  if (!acc?.data) throw new Error("Cuenta no encontrada (¿Riot ID cambiado?)");
  const { puuid } = acc.data;
  const region = acc.data.region || "eu";
  p.puuid = puuid;
  p.avatar = cardUrl(acc.data.card);
  p.name = acc.data.name || p.name;
  p.tag = acc.data.tag || p.tag;

  const mine = (cache[puuid] ||= {});
  const season = config.seasonId;
  const inAct = (s, date) =>
    s ? lc(s) === lc(season) : config.inicioActo ? new Date(date) >= new Date(config.inicioActo) : false;

  for (const mode of MODES) {
    // 1) Historial de partidas completas (incluyen a todos los jugadores → resultado exacto).
    //    Se pide página a página (10 partidas) hasta llegar a partidas de antes del acto,
    //    o a una página en la que todas las partidas ya estaban guardadas.
    const bf = (cache._historialCompleto ||= {});
    const bfKey = `${puuid}:${mode.key}`;
    let useV4 = true;
    for (let start = 0, page = 0; page < 20; start += 10, page++) {
      const q = `mode=${mode.query}&size=10&start=${start}`;
      let res = null;
      if (useV4) {
        res = await api(`/valorant/v4/matches/${region}/pc/${enc(p.name)}/${enc(p.tag)}?${q}`, null).catch((e) => {
          console.warn(`  v4 no disponible (${e.message}), uso v3`);
          return undefined;
        });
        if (res === undefined) useV4 = false;
      }
      if (!useV4) res = await api(`/valorant/v3/matches/${region}/${enc(p.name)}/${enc(p.tag)}?${q}`, null);
      const list = res?.data || [];
      let older = 0, known = 0, added = 0;
      for (const raw of list) {
        const m = normalizeMatch(raw);
        if (!m.id) continue;
        if (!inAct(m.season, m.startedAt)) { older++; continue; }
        if (mine[m.id]) { known++; continue; }
        const won = didWin(m, puuid, mode.key);
        if (DEBUG) {
          const me = m.players.find((x) => x.puuid === puuid);
          const rival = [...m.players].filter((x) => x.puuid !== puuid).sort((a, b) => b.kills - a.kills)[0];
          console.log(`  [debug] ${mode.key} ${m.id.slice(0, 8)} ${m.startedAt?.slice(0, 16)} mis kills=${me?.kills ?? "?"} mejor rival=${rival?.kills ?? "?"} → ${won ? "VICTORIA" : "derrota"}`);
        }
        if (won !== null) { mine[m.id] = { mode: mode.key, won, at: m.startedAt }; added++; }
      }
      if (DEBUG) console.log(`  [debug] página ${page + 1} (${useV4 ? "v4" : "v3"}): ${list.length} partidas · ${added} nuevas · ${known} ya guardadas · ${older} de otro acto`);
      if (list.length === 0 || older > 0 || list.length < 10) { bf[bfKey] = true; break; }
      if (bf[bfKey] && known > 0 && added === 0) break; // ya teníamos el resto
    }

    // 2) Historial guardado por HenrikDev (más largo, pero solo con mis estadísticas)
    for (let page = 1; page <= 10; page++) {
      const st = await api(
        `/valorant/v1/stored-matches/${region}/${enc(p.name)}/${enc(p.tag)}?mode=${mode.query}&page=${page}&size=25`,
        page === 1 ? `stored_${mode.key}_${p.name}` : null
      );
      const list = st?.data || [];
      let reachedOlder = false;
      for (const s of list) {
        const id = s.meta?.id;
        const sSeason = s.meta?.season?.id;
        if (!id) continue;
        if (!inAct(sSeason, s.meta?.started_at)) { reachedOlder = true; continue; }
        if (mine[id]) continue;
        let won = null;
        if (mode.key === "tdm" && s.teams && s.stats?.team) {
          const myTeam = lc(s.stats.team);
          const other = myTeam === "red" ? "blue" : "red";
          if (s.teams[myTeam] != null && s.teams[other] != null) won = s.teams[myTeam] > s.teams[other];
        } else if (mode.key === "dm" && (s.stats?.kills ?? 0) >= DM_KILL_LIMIT) {
          won = true;
        }
        if (won === null) {
          // Resultado dudoso → se consulta la partida completa (una sola vez)
          const full = await api(`/valorant/v4/match/${region}/${id}`, `match_${id}`).catch(() => null);
          if (full?.data) won = didWin(normalizeMatch(full.data), puuid, mode.key);
        }
        if (DEBUG) console.log(`  [debug] stored ${mode.key} ${id.slice(0, 8)} kills=${s.stats?.kills} team=${s.stats?.team} teams=${JSON.stringify(s.teams)} → ${won}`);
        if (won !== null) mine[id] = { mode: mode.key, won, at: s.meta?.started_at };
      }
      if (reachedOlder || list.length < 25) break;
    }
  }

  const vals = Object.values(mine);
  p.dmWins = vals.filter((v) => v.mode === "dm" && v.won).length;
  p.tdmWins = vals.filter((v) => v.mode === "tdm" && v.won).length;
  p.dmPlayed = vals.filter((v) => v.mode === "dm").length;
  p.tdmPlayed = vals.filter((v) => v.mode === "tdm").length;
  p.wins = p.dmWins + p.tdmWins;
  return p;
}

// ---------- principal ----------

async function main() {
  if (!KEY) {
    console.error("Falta la variable de entorno HENRIK_API_KEY.");
    process.exit(1);
  }
  const config = JSON.parse(await readFile(path("config.json"), "utf8"));
  const list = JSON.parse(await readFile(path("trackers.json"), "utf8"));
  const read = async (f, def) => (existsSync(path(f)) ? JSON.parse(await readFile(path(f), "utf8")) : def);
  const prev = await read("data/ranking.json", {});
  const cache = await read("data/matches.json", {});
  const prevBy = new Map(
    [...(prev.players || []), prev.retador].filter(Boolean).map((x) => [lc(x.riotId), x])
  );

  async function run(entry, label) {
    let p;
    try { p = parseTracker(entry.url); } catch (e) { console.error(e.message); return null; }
    if (entry.nombre) p.displayName = entry.nombre;
    const old = prevBy.get(lc(p.riotId));
    console.log(`${label} ${p.riotId}`);
    try {
      await updatePlayer(p, cache, config);
      console.log(`  ✓ DM ${p.dmWins}/${p.dmPlayed} + TDM ${p.tdmWins}/${p.tdmPlayed} → ${p.wins} victorias`);
      return { ...p, ok: true, lastOkAt: new Date().toISOString() };
    } catch (e) {
      console.error(`  ✗ ${e.message}`);
      return {
        ...p, ...(old ? { avatar: old.avatar, dmWins: old.dmWins, tdmWins: old.tdmWins, wins: old.wins } : { dmWins: 0, tdmWins: 0, wins: 0 }),
        ok: false, error: e.message, lastOkAt: old?.lastOkAt || null,
      };
    }
  }

  const entries = list.map((x) => (typeof x === "string" ? { url: x } : x)).filter((x) => x.url?.trim());
  const seen = new Set();
  const players = [];
  for (const entry of entries) {
    if (process.env.SOLO && !lc(entry.url).includes(lc(process.env.SOLO))) continue;
    const r = await run(entry, "→");
    if (!r || seen.has(lc(r.riotId))) continue;
    seen.add(lc(r.riotId));
    players.push(r);
  }
  const retador = config.retador?.tracker
    ? await run({ url: config.retador.tracker, nombre: config.retador.nombre }, "★")
    : null;

  players.sort((a, b) => b.wins - a.wins || b.dmWins - a.dmWins || a.riotId.localeCompare(b.riotId));
  const okCount = players.filter((x) => x.ok).length;
  console.log(`\n${okCount}/${players.length} jugadores actualizados · ${reqCount} peticiones`);
  console.table(players.map((x, i) => ({ "#": i + 1, jugador: x.riotId, DM: x.dmWins, TDM: x.tdmWins, total: x.wins, ok: x.ok })));

  if (DRY) { console.log("(--dry-run: no se guarda nada)"); return; }
  if (players.length && okCount === 0) { process.exitCode = 1; return; } // no pisar datos buenos

  await mkdir(path("data/"), { recursive: true });
  await writeFile(path("data/matches.json"), JSON.stringify(cache) + "\n");
  await writeFile(
    path("data/ranking.json"),
    JSON.stringify({ updatedAt: new Date().toISOString(), seasonId: config.seasonId, retador, players }, null, 2) + "\n"
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
