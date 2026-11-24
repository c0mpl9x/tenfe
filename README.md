# Tenfe

Qué trenes de Cercanías Madrid han salido **de verdad** y por dónde van. Web personal, no oficial.

Renfe publica hechos buenos (parado, en marcha, suprimido) y conclusiones malas (minutos de retraso, hora prevista).
Aquí solo se usan los hechos:

- Se ignora el estado `A` (aproximándose), que adelanta trenes a estaciones que aún no han alcanzado.
- La hora sale de la última estación confirmada más el tiempo de recorrido del horario.
- Un tren que no ha salido solo tiene un "como pronto". La cifra hueca significa eso.
- "Hace N min que no pasa ninguna C10" se calcula con trenes vistos pasar, no con avisos.

## Piezas

| Carpeta | Qué es |
|---|---|
| `web/` | La página (GitHub Pages). `core.js` decide los veredictos |
| `worker/` | Worker de Cloudflare: mira a Renfe cada 30 s y recuerda |
| `scripts/horario.py` | Reduce el horario abierto de Renfe a Madrid, cada madrugada |
| `test/` | Reproduce una tarde real grabada |

## En local

    npm test
    python scripts/horario.py web/data
    npx wrangler@4 dev -c worker/wrangler.toml
    python -m http.server 8000 -d web

## Desplegar el Worker

    npx wrangler@4 login
    npx wrangler@4 deploy -c worker/wrangler.toml

y poner en `web/config.js` la dirección que devuelve.

Datos: Renfe Operadora, CC BY 4.0.
