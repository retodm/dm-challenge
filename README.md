# Podio Reto Deathmatch V26:A6

Web estática (GitHub Pages) con el ranking del reto: victorias de **Deathmatch + Team Deathmatch** del acto, leídas de tracker.gg.

## Cómo funciona

```
trackers.json ──► GitHub Actions (cada 30 min) ──► data/ranking.json ──► GitHub Pages (index.html)
```

- Los datos se piden **una sola vez cada 30 min desde GitHub**, no desde cada visitante. La web solo lee `data/ranking.json`, así que da igual cuánta gente la abra: tracker.gg recibe las mismas peticiones.
- Por jugador: primero la API JSON interna de tracker.gg (3 peticiones, con 2,5–5,5 s de pausa entre ellas). Si Cloudflare la bloquea, se abre la página con Chrome real y se leen las Wins y el avatar (`.user-avatar__image`).
- Si un jugador falla, se conserva su último dato y aparece un ⚠ junto a su nombre.

## Añadir participantes

Edita `trackers.json` (desde la web de GitHub sirve: icono del lápiz → *Commit changes*). Cada línea es la URL de un tracker:

```json
[
  "https://tracker.gg/valorant/profile/riot/Zumito%23CHUPO/overview?platform=pc&playlist=deathmatch&season=d816f426-48ea-f052-117f-9697a155b319",
  { "url": "https://tracker.gg/valorant/profile/riot/Deuve%23aot/overview", "nombre": "Nombre opcional a mostrar" }
]
```

Al guardar se lanza la actualización automáticamente (tarda 1–3 min). Si la URL no lleva `season=`, se usa `seasonId` de `config.json`.

## Configuración (`config.json`)

| Campo | Para qué |
|---|---|
| `seasonId` | ID del acto en tracker.gg (V26:A6 = `d816f426-…`) |
| `finActo` | Fecha de fin, p. ej. `"2026-12-10T12:00:00+01:00"`. Activa la cuenta atrás. Vacío = sin cuenta atrás |
| `retador.tracker` | Tu tracker. Se muestra como "Marca a batir" y no entra en el podio |
| `redes.*` | Enlaces a Discord y redes sociales. Las vacías no se muestran |

## Publicar en GitHub Pages (una vez)

1. Crea un repositorio **público** en GitHub y sube esta carpeta.
2. *Settings → Pages → Build and deployment → Source:* **GitHub Actions**.
3. *Settings → Actions → General → Workflow permissions:* **Read and write permissions**.
4. Pestaña *Actions → "Actualizar ranking y publicar" → Run workflow*.
5. La web queda en `https://carlosrodrih.github.io/dm-challenge/`.

Si el repo es público, los minutos de Actions son gratis e ilimitados.

## Probar en local

```bash
npm install
CHROME_PATH=/ruta/a/chrome node scripts/update.mjs   # CHROME_PATH solo hace falta si no tienes Google Chrome
npx serve .
```
