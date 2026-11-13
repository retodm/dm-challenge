# Podio Reto Deathmatch V26:A6

Web estática (GitHub Pages) con el ranking del reto: victorias de **Deathmatch + Team Deathmatch** del acto, leídas de tracker.gg.

## Cómo funciona

```
trackers.json ──► GitHub Actions (cada 30 min) ──► data/ranking.json ──► GitHub Pages (index.html)
```

- Los datos se piden **una sola vez cada 30 min desde GitHub**, no desde cada visitante. La web solo lee `data/ranking.json`.
- Fuente: [HenrikDev API](https://docs.henrikdev.xyz) (historial público de partidas de Riot). tracker.gg no tiene API pública para Valorant y bloquea las peticiones desde servidores.
- Cada partida del acto se guarda en `data/matches.json` la primera vez que aparece: no se cuenta dos veces y no se pierde aunque salga del historial reciente.
- En **DM** gana quien acaba con más kills; en **TDM**, el equipo ganador.
- Límite de la clave gratuita de HenrikDev: **30 peticiones/minuto**. El script lee las cabeceras de la API y va lo más rápido que permite sin pasarse. Cada jugador nuevo cuesta unas 6–10 peticiones la primera vez (más si tiene muchas partidas) y luego ~5 por actualización, así que con 30 jugadores una actualización tarda unos 5–6 min. Si se queda corto, HenrikDev ofrece claves de mayor límite solicitándolas en su Discord.
- Si un jugador falla, se conserva su último dato y aparece un ⚠ junto a su nombre.

> Riot solo expone un historial reciente, así que las partidas jugadas antes de entrar en el ranking pueden faltar: se corrigen con el ajuste manual (ver abajo). El resultado oficial es la revisión en directo de los trackers.

## Clave de HenrikDev (una vez)

1. Entra en https://api.henrikdev.xyz/dashboard/ con Discord y genera una clave *Basic*.
2. En el repo: *Settings → Secrets and variables → Actions → New repository secret* → nombre `HENRIK_API_KEY`, valor la clave.

## Añadir participantes

Edita `trackers.json` (desde la web de GitHub sirve: icono del lápiz → *Commit changes*). Cada línea es la URL de un tracker:

```json
[
  "https://tracker.gg/valorant/profile/riot/Zumito%23CHUPO/overview?platform=pc&playlist=deathmatch&season=d816f426-48ea-f052-117f-9697a155b319",
  { "url": "https://tracker.gg/valorant/profile/riot/Deuve%23aot/overview", "nombre": "Nombre opcional a mostrar" }
]
```

### Ajuste manual (`extraDM` / `extraTDM`)

Riot solo devuelve el historial **reciente** de cada jugador. Las partidas jugadas antes de que el jugador entrara en el ranking pueden no aparecer (tracker.gg sí las tiene porque las guarda según se juegan). Para compensarlo, una sola vez por jugador:

1. Mira sus *Wins* en tracker.gg (Deathmatch y, si hace falta, Team Deathmatch) y compáralas con la web.
2. Añade la diferencia a su entrada:

```json
{ "url": "https://tracker.gg/valorant/profile/riot/Huguicius%235613/overview?...", "extraDM": 14, "extraTDM": 0 }
```

El ajuste se suma a lo que encuentre la API y **no hay que volver a tocarlo**: desde que un jugador está en el ranking, cada partida nueva se guarda en cuanto aparece (cada 30 min), así que no se pierde ninguna.

Al guardar se lanza la actualización automáticamente (tarda 1–3 min). Si la URL no lleva `season=`, se usa `seasonId` de `config.json`.

## Configuración (`config.json`)

| Campo | Para qué |
|---|---|
| `seasonId` | ID del acto en tracker.gg (V26:A6 = `d816f426-…`) |
| `inicioActo` | Solo por si la API no devuelve el acto de alguna partida: cuenta las jugadas desde esta fecha. Normalmente vacío |
| `finActo` | Fecha de fin, p. ej. `"2026-12-10T12:00:00+01:00"`. Activa la cuenta atrás. Vacío = sin cuenta atrás |
| `retador.tracker` | Tu tracker. Se muestra como "Marca a batir" y no entra en el podio |
| `redes.*` | Enlaces a Discord y redes sociales. Las vacías no se muestran |

## Publicar en GitHub Pages (una vez)

1. Crea un repositorio **público** en GitHub y sube esta carpeta.
2. Añade el secreto `HENRIK_API_KEY` (ver arriba).
3. *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.
4. *Settings → Actions → General → Workflow permissions:* **Read and write permissions**.
5. Pestaña *Actions → "Actualizar ranking y publicar" → Run workflow*.
6. La web queda en `https://carlosrodrih.github.io/dm-challenge/`.

Si el repo es público, los minutos de Actions son gratis e ilimitados.

## Probar

**En GitHub sin publicar nada:** *Actions → Actualizar ranking y publicar → Run workflow* → marca **Solo probar**. El resultado sale en el log del paso "Probar (sin guardar)".

**En tu PC** (necesitas [Node.js](https://nodejs.org) 18 o superior):

```bash
git clone https://github.com/carlosrodrih/dm-challenge
cd dm-challenge
HENRIK_API_KEY=tu_clave npm run probar     # muestra la tabla, no guarda nada
HENRIK_API_KEY=tu_clave npm run update     # genera data/ranking.json
npm run serve                              # abre la web en http://localhost:3000
```

En Windows (PowerShell), en lugar de `HENRIK_API_KEY=tu_clave npm run …` usa:

```powershell
$env:HENRIK_API_KEY="tu_clave"; npm run probar
```
