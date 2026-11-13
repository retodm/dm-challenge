# Podio Reto Deathmatch V26:A6

Web estática (GitHub Pages) con el ranking del reto: victorias de **Deathmatch + Team Deathmatch** del acto, leídas de tracker.gg.

## Cómo funciona

```
trackers.json ──► GitHub Actions (cada 30 min) ──► data/ranking.json ──► GitHub Pages (index.html)
```

- Cada participante entra con las victorias que **ya tiene en tracker.gg** (`victoriasDM`, `victoriasTDM`).
- La primera vez que el script lo ve, apunta la fecha en `"desde"` (en el propio `trackers.json`).
- Desde ese momento suma cada victoria nueva de DM y TDM. **Total = victorias al entrar + victorias nuevas.**
- Los datos se piden **una sola vez cada 30 min desde GitHub**, no desde cada visitante.
- Fuente: [HenrikDev API](https://docs.henrikdev.xyz) (historial de partidas de Riot). tracker.gg no tiene API pública para Valorant.
- Por qué así: Riot solo devuelve el historial **reciente**, así que las partidas antiguas pueden faltar. Partiendo del número de tracker.gg y consultando cada 30 min, no se pierde ninguna.
- Cada partida contada se guarda en `data/matches.json`, así que nunca se cuenta dos veces.
- Límite de la clave gratuita de HenrikDev: **30 peticiones/minuto**. El script lee las cabeceras de la API y va lo más rápido que permite sin pasarse (~5 peticiones por jugador y actualización: con 30 jugadores, unos 5 min). Si se queda corto, HenrikDev ofrece claves de mayor límite en su Discord.
- Si un jugador falla, se conserva su último dato y aparece un ⚠ junto a su nombre.

## Clave de HenrikDev (una vez)

1. Entra en https://api.henrikdev.xyz/dashboard/ con Discord y genera una clave *Basic*.
2. En el repo: *Settings → Secrets and variables → Actions → New repository secret* → nombre `HENRIK_API_KEY`, valor la clave.

## Añadir participantes

Edita `trackers.json` (desde la web de GitHub: icono del lápiz → *Commit changes*). Añade un bloque por jugador con su URL de tracker y sus victorias actuales en tracker.gg **de este acto**:

```json
[
  {
    "url": "https://tracker.gg/valorant/profile/riot/Zumito%23CHUPO/overview?platform=pc&playlist=deathmatch&season=d816f426-48ea-f052-117f-9697a155b319",
    "victoriasDM": 2,
    "victoriasTDM": 2
  }
]
```

- **victoriasDM**: *Wins* del tracker con `playlist=deathmatch`.
- **victoriasTDM**: *Wins* con `playlist=hurm` (Team Deathmatch). Cambia eso en la URL para verlo.
- Opcional: `"nombre": "Texto a mostrar"` en lugar del Riot ID.
- **No pongas `"desde"`**: al guardar se lanza la actualización (1–3 min) y el script lo añade solo con la fecha y hora de ese momento. Si quieres fijarla a mano, usa el formato `"2026-11-13T18:00:00+01:00"`.

Para corregir las victorias iniciales de alguien basta con cambiar `victoriasDM`/`victoriasTDM`; las victorias nuevas ya contadas se mantienen.

## Configuración (`config.json`)

| Campo | Para qué |
|---|---|
| `seasonId` | ID del acto en tracker.gg (V26:A6 = `d816f426-…`) |
| `finActo` | Fecha de fin (`"AAAA-MM-DD"`, p. ej. `"2027-01-06"`). Muestra los días que faltan. Vacío = sin cuenta atrás |
| `retador` | Opcional. Añádelo con `tracker`, `victoriasDM`, `victoriasTDM` (y `nombre`) para mostrar una "Marca a batir" fuera del podio |
| `redes.*` | Enlaces a Discord y redes sociales. Las vacías no se muestran |

## Publicación (GitHub Pages)

La web está en **https://retodm.github.io/dm-challenge/** (repo `retodm/dm-challenge`). Ajustes necesarios del repo, por si hubiera que revisarlos:

- *Settings → Secrets and variables → Actions*: secreto `HENRIK_API_KEY` (ver arriba).
- *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.
- *Settings → Actions → General → Workflow permissions:* **Read and write permissions**.

Para forzar una actualización: *Actions → "Actualizar ranking y publicar" → Run workflow*.

Si el repo es público, los minutos de Actions son gratis e ilimitados.

## Probar sin publicar

*Actions → Actualizar ranking y publicar → Run workflow* → marca **Solo probar**. El resultado sale en el log del paso "Probar (sin guardar)".
