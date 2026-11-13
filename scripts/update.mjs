// Actualiza data/ranking.json con las victorias de Deathmatch + Team Deathmatch
// de cada jugador de trackers.json.
//
// Funcionamiento:
//   - Cada jugador entra con las victorias que ya tiene en tracker.gg
//     (victoriasDM / victoriasTDM en trackers.json).
//   - La primera vez que el script lo ve, apunta la fecha en "desde" (en trackers.json).
//   - Desde ese momento suma cada victoria nueva de DM/TDM que encuentra en la API.
//
// Fuente: HenrikDev API (https://docs.henrikdev.xyz). Requiere HENRIK_API_KEY.
// Cada partida contada se guarda en data/matches.json para no contarla dos veces.
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

async function api(pathname) {
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
  if (Array.isArray(m.teams)) for (const t of m.teams) teams[lc(t.team_id)] = { won: t.won, rounds: t.rounds?.won, placement: t.placement };
  else if (m.teams) for (const [k, t] of Object.entries(m.teams)) if (t) teams[lc(k)] = { won: t.has_won, rounds: t.rounds_won };
  return { id, queue, season, startedAt, players, teams };
}

// ¿Ganó este jugador la partida?
export function didWin(match, puuid, modeKey) {
  const me = match.players.find((p) => p.puuid === puuid);
  if (!me) return null;
  // Marca oficial de Riot (en DM cada jugador es su propio "equipo"): es lo que usa tracker.gg
  const official = match.teams[me.team];
  if (official && typeof official.won === "boolean") return official.won;
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

// ---------- jugador ----------

async function updatePlayer(p, entry, cache, config) {
  const acc = await api(`/valorant/v1/account/${enc(p.name)}/${enc(p.tag)}`);
  if (!acc?.data) throw new Error("Cuenta no encontrada (¿Riot ID cambiado?)");
  const { puuid } = acc.data;
  const region = acc.data.region || "eu";
  p.puuid = puuid;
  p.avatar = cardUrl(acc.data.card);
  p.name = acc.data.name || p.name;
  p.tag = acc.data.tag || p.tag;

  const desde = entry.desde ? new Date(entry.desde) : null;
  if (desde && isNaN(desde)) throw new Error(`Fecha "desde" no válida: ${entry.desde}`);
  const mine = (cache[puuid] ||= {});

  // Jugador nuevo: se marca la fecha y no hace falta consultar partidas todavía
  if (!desde) {
    entry.desde = new Date().toISOString();
    p.nuevo = true;
  } else {
    const season = config.seasonId;
    const cuenta = (m) => (!m.season || lc(m.season) === lc(season)) && m.startedAt && new Date(m.startedAt) > desde;

    for (const mode of MODES) {
      // Se piden páginas de 10 partidas (las más recientes primero) hasta llegar a partidas
      // anteriores a "desde". Siempre se revisan al menos 2 páginas por si alguna partida
      // no estaba disponible en la pasada anterior.
      for (let page = 0; page < 10; page++) {
        const q = `mode=${mode.query}&size=10&start=${page * 10}`;
        const res = await api(`/valorant/v4/matches/${region}/pc/${enc(p.name)}/${enc(p.tag)}?${q}`);
        const list = res?.data || [];
        let older = 0, known = 0, added = 0;
        for (const raw of list) {
          const m = normalizeMatch(raw);
          if (!m.id) continue;
          if (!cuenta(m)) { older++; continue; }
          if (mine[m.id]) { known++; continue; }
          const won = didWin(m, puuid, mode.key);
          if (won === null) continue;
          mine[m.id] = { mode: mode.key, won, at: m.startedAt };
          added++;
          if (DEBUG) console.log(`  [debug] ${mode.key} ${m.startedAt?.slice(0, 16)} ${m.id.slice(0, 8)} → ${won ? "VICTORIA" : "derrota"}`);
        }
        if (DEBUG) console.log(`  [debug] ${mode.key} pág ${page + 1}: ${list.length} partidas · ${added} nuevas · ${known} ya contadas · ${older} anteriores a "desde"`);
        if (list.length < 10 || older > 0 || (page >= 1 && added === 0)) break;
      }
    }
  }

  const vals = Object.values(mine).filter((v) => !desde || new Date(v.at) > desde);
  p.desde = entry.desde;
  p.baseDm = Number(entry.victoriasDM) || 0;
  p.baseTdm = Number(entry.victoriasTDM) || 0;
  p.newDm = vals.filter((v) => v.mode === "dm" && v.won).length;
  p.newTdm = vals.filter((v) => v.mode === "tdm" && v.won).length;
  p.dmWins = p.baseDm + p.newDm;
  p.tdmWins = p.baseTdm + p.newTdm;
  p.wins = p.dmWins + p.tdmWins;
  return p;
}

// ---------- principal ----------

async function main() {
  if (!KEY) {
    console.error("Falta la variable de entorno HENRIK_API_KEY.");
    process.exit(1);
  }
  const read = async (f, def) => (existsSync(path(f)) ? JSON.parse(await readFile(path(f), "utf8")) : def);
  const config = await read("config.json", {});
  const rawList = await read("trackers.json", []);
  const prev = await read("data/ranking.json", {});
  const cache = await read("data/matches.json", {});
  const prevBy = new Map([...(prev.players || []), prev.retador].filter(Boolean).map((x) => [lc(x.riotId), x]));

  // Se admiten URLs sueltas o objetos; se normaliza todo a objetos
  const list = rawList.map((x) => (typeof x === "string" ? { url: x } : x)).filter((x) => x.url?.trim());
  let trackersChanged = list.some((x, i) => typeof rawList[i] === "string");
  let configChanged = false;

  async function run(entry, label) {
    let p;
    try { p = parseTracker(entry.url); } catch (e) { console.error(e.message); return null; }
    if (entry.nombre) p.displayName = entry.nombre;
    const old = prevBy.get(lc(p.riotId));
    const hadDesde = !!entry.desde;
    console.log(`${label} ${p.riotId}`);
    try {
      await updatePlayer(p, entry, cache, config);
      if (!hadDesde) console.log(`  ★ nuevo: empieza a contar desde ${entry.desde} con DM ${p.baseDm} + TDM ${p.baseTdm}`);
      else console.log(`  ✓ DM ${p.baseDm}+${p.newDm} · TDM ${p.baseTdm}+${p.newTdm} → ${p.wins} victorias`);
      return { p: { ...p, ok: true, lastOkAt: new Date().toISOString() }, marked: !hadDesde };
    } catch (e) {
      console.error(`  ✗ ${e.message}`);
      const base = { dmWins: Number(entry.victoriasDM) || 0, tdmWins: Number(entry.victoriasTDM) || 0 };
      const keep = old ? { avatar: old.avatar, dmWins: old.dmWins, tdmWins: old.tdmWins, baseDm: old.baseDm, baseTdm: old.baseTdm, newDm: old.newDm, newTdm: old.newTdm, desde: old.desde } : base;
      return {
        p: { ...p, ...keep, wins: (keep.dmWins || 0) + (keep.tdmWins || 0), ok: false, error: e.message, lastOkAt: old?.lastOkAt || null },
        marked: false,
      };
    }
  }

  const seen = new Set();
  const players = [];
  for (const entry of list) {
    if (process.env.SOLO && !process.env.SOLO.split(",").some((t) => lc(decodeURIComponent(entry.url)).includes(lc(t.trim())))) continue;
    const r = await run(entry, "→");
    if (!r) continue;
    if (r.marked) trackersChanged = true;
    if (seen.has(lc(r.p.riotId))) continue;
    seen.add(lc(r.p.riotId));
    players.push(r.p);
  }

  let retador = null;
  if (config.retador?.tracker) {
    const r = await run({ ...config.retador, url: config.retador.tracker }, "🎯");
    if (r) {
      retador = r.p;
      if (r.marked) { config.retador.desde = retador.desde; configChanged = true; }
    }
  }

  players.sort((a, b) => b.wins - a.wins || b.dmWins - a.dmWins || a.riotId.localeCompare(b.riotId));
  const okCount = players.filter((x) => x.ok).length;
  console.log(`\n${okCount}/${players.length} jugadores actualizados · ${reqCount} peticiones`);
  console.table(players.map((x, i) => ({ "#": i + 1, jugador: x.riotId, DM: x.dmWins, TDM: x.tdmWins, total: x.wins, ok: x.ok })));

  if (DRY) { console.log("(--dry-run: no se guarda nada)"); return; }
  if (players.length && okCount === 0) { process.exitCode = 1; return; } // no pisar datos buenos

  const json = (o) => JSON.stringify(o, null, 2) + "\n";
  await mkdir(path("data/"), { recursive: true });
  if (trackersChanged) await writeFile(path("trackers.json"), json(list));
  if (configChanged) await writeFile(path("config.json"), json(config));
  await writeFile(path("data/matches.json"), JSON.stringify(cache) + "\n");
  await writeFile(
    path("data/ranking.json"),
    json({ updatedAt: new Date().toISOString(), seasonId: config.seasonId, retador, players })
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
