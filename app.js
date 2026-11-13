// Lee config.json + data/ranking.json (generado por GitHub Actions) y pinta el podio.
(() => {
  const $ = (s) => document.querySelector(s);
  const REFRESH_MS = 5 * 60 * 1000; // la web vuelve a leer el JSON cada 5 min (fichero estático, sin coste)

  const REDES = {
    discord: "Discord", twitch: "Twitch", youtube: "YouTube",
    tiktok: "TikTok", instagram: "Instagram", x: "X / Twitter",
  };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const fmtAgo = (iso) => {
    if (!iso) return "nunca";
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return "ahora mismo";
    if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60);
    if (h < 48) return `hace ${h} h`;
    return `hace ${Math.round(h / 24)} días`;
  };

  const avatar = (p) =>
    p.avatar
      ? `<img class="avatar" src="${esc(p.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer"
           onerror="this.outerHTML='<div class=&quot;avatar&quot;>${esc(initial(p))}</div>'">`
      : `<div class="avatar">${esc(initial(p))}</div>`;
  const initial = (p) => (p.displayName || p.name || "?").trim().charAt(0).toUpperCase();

  const nameHtml = (p) =>
    p.displayName
      ? esc(p.displayName)
      : `${esc(p.name)}<small>#${esc(p.tag)}</small>`;

  const staleHtml = (p) =>
    p.ok === false
      ? `<span class="stale" title="No se pudo actualizar en la última pasada. Dato de ${esc(fmtAgo(p.lastOkAt))}.">⚠</span>`
      : "";

  const extraNote = (p) =>
    p.extraDM || p.extraTDM
      ? ` title="Incluye victorias añadidas a mano (partidas antiguas que ya no da la API de Riot): DM +${p.extraDM || 0}, TDM +${p.extraTDM || 0}"`
      : "";

  let record = null; // victorias del retador (marca a batir)
  const beats = (p) => record != null && p.wins > record;
  const badge = (p) => (beats(p) ? `<span class="badge">Supera el récord</span>` : "");

  function renderPodium(players) {
    const html = [0, 1, 2].map((i) => {
      const p = players[i];
      const cls = `spot p${i + 1}`;
      if (!p) {
        return `<div class="${cls} vacant"><div class="crown"></div><div class="avatar">?</div>
          <div class="name">—</div><div class="block"><div class="pos">${i + 1}</div></div></div>`;
      }
      return `<div class="${cls}">
        <div class="crown">${i === 0 ? "👑" : ""}</div>
        <a href="${esc(p.url)}" target="_blank" rel="noopener" title="Ver tracker de ${esc(p.riotId)}">
          ${avatar(p)}
          <div class="name">${nameHtml(p)}${staleHtml(p)}</div>
        </a>
        ${badge(p)}
        <div class="block">
          <div class="pos">${i + 1}</div>
          <div class="wins">${p.wins}<span>VICTORIAS</span></div>
          <div class="detail"${extraNote(p)}>DM ${p.dmWins} · TDM ${p.tdmWins}</div>
        </div>
      </div>`;
    });
    $("#podium").innerHTML = html.join("");
  }

  function renderList(players) {
    const rest = players.slice(3);
    $("#list").innerHTML = rest.map((p, i) => `
      <li class="row">
        <a href="${esc(p.url)}" target="_blank" rel="noopener" title="Ver tracker de ${esc(p.riotId)}">
          <span class="pos">${i + 4}</span>
          ${avatar(p)}
          <span class="name">${nameHtml(p)}${staleHtml(p)}${badge(p)}</span>
          <span class="wins"${extraNote(p)}>${p.wins}<small>DM ${p.dmWins} · TDM ${p.tdmWins}</small></span>
        </a>
      </li>`).join("");
    $("#empty").classList.toggle("hidden", players.length > 0);
  }

  function renderSocial(redes) {
    const links = Object.entries(REDES)
      .filter(([k]) => redes?.[k])
      .map(([k, label]) =>
        `<a class="${k}" href="${esc(redes[k])}" target="_blank" rel="noopener">${label}</a>`)
      .join("");
    $("#social").innerHTML = links;
    $("#socialHelp").innerHTML = links;
  }

  let countdownTimer;
  function renderCountdown(fin) {
    const el = $("#countdown");
    if (!fin) return el.classList.add("hidden");
    const end = new Date(fin);
    if (isNaN(end)) return el.classList.add("hidden");
    const tick = () => {
      const ms = end - Date.now();
      if (ms <= 0) { el.textContent = "🏁 Acto terminado"; return clearInterval(countdownTimer); }
      const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60;
      el.textContent = `⏳ Quedan ${d}d ${h}h ${m}m`;
    };
    el.classList.remove("hidden");
    tick();
    clearInterval(countdownTimer);
    countdownTimer = setInterval(tick, 30000);
  }

  async function getJson(url) {
    const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  }

  async function load() {
    try {
      const [config, data] = await Promise.all([getJson("config.json"), getJson("data/ranking.json")]);

      document.title = config.titulo || document.title;
      $("#titulo").textContent = (config.titulo || "Reto Deathmatch").replace(config.acto || "", "").trim();
      $("#acto").textContent = config.acto || "";
      document.querySelectorAll("[data-acto]").forEach((e) => (e.textContent = config.acto));
      if (config.premio) {
        $("#premio").textContent = `🎁 ${config.premio}`;
        document.querySelectorAll("[data-premio]").forEach((e) => (e.textContent = config.premio));
      }
      renderSocial(config.redes);
      renderCountdown(config.finActo);

      record = data.retador && typeof data.retador.wins === "number" ? data.retador.wins : null;
      const rec = $("#record");
      if (record != null) {
        const who = data.retador.displayName || config.retador?.nombre || data.retador.name;
        rec.innerHTML = `🎯 Marca a batir: <b>${record}</b> (${esc(who)})`;
        rec.classList.remove("hidden");
        rec.classList.add("record");
      } else rec.classList.add("hidden");

      const players = data.players || [];
      renderPodium(players);
      renderList(players);
      $("#updated").textContent = data.updatedAt
        ? `Última actualización: ${new Date(data.updatedAt).toLocaleString("es-ES")} (${fmtAgo(data.updatedAt)})`
        : "Esperando la primera actualización…";
    } catch (e) {
      console.error(e);
      $("#updated").textContent = "No se pudieron cargar los datos. Reintentando…";
    }
  }

  // Ayuda
  const dlg = $("#help");
  $("#openHelp").addEventListener("click", () => dlg.showModal());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  if (location.hash === "#ayuda") dlg.showModal();

  load();
  setInterval(load, REFRESH_MS);
})();
