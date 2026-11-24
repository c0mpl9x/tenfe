// Convierte las fotos de Renfe en hechos: qué tren se vio, dónde y desde cuándo.
// No usa ni el retraso ni la hora prevista de Renfe.
import { epochMadrid } from '../../web/core.js';

export const nuevoEstado = () => ({ desde: 0, fecha: 0, cambio: 0, saltos: 0, trenes: {}, cancel: {}, avisos: [], avisosFecha: 0 });

// 'A' (aproximándose) adelanta el tren a una estación que aún no ha alcanzado: no es un hecho.
const clase = a => (a === 'E' ? 'E' : a && a !== 'A' ? 'M' : null);

export function observar(est, flota) {
  const t = epochMadrid(flota.fechaActualizacion);
  if (!(t > est.fecha)) return est;
  const madrid = flota.trenes.filter(x => x.nucleo === '10');
  const antes = Object.values(est.trenes).filter(x => x.ult === est.fecha).length;
  // A veces Renfe publica un fichero sin Madrid o a medias: se ignora salvo que persista.
  if (antes > 10 && madrid.length < antes / 2 && est.saltos < 6) {
    est.saltos++;
    return est;
  }
  est.saltos = 0;
  if (!est.desde) est.desde = t;
  for (const x of madrid) {
    const tr = (est.trenes[x.tripId] ??= { obs: [], huella: '' });
    const huella = `${x.codEstAct}|${x.porAvanc}|${x.latitud}`;
    if (huella !== tr.huella) est.cambio = t;
    Object.assign(tr, { huella, ult: t, dest: x.codEstDest, via: x.nextVia || '', crudo: x.porAvanc ?? '' });
    const k = clase(x.porAvanc);
    if (!k) continue;
    const u = tr.obs.at(-1);
    if (u && u[0] === x.codEstAct && u[1] === k) u[3] = t;
    else tr.obs.push([x.codEstAct, k, t, t]);
  }
  est.fecha = t;
  return est;
}

export function cancelados(est, tu, t) {
  for (const e of tu.entity ?? []) {
    const v = e.tripUpdate?.trip;
    if (v?.scheduleRelationship !== 'CANCELED' || !/^(10\d\d|SPECIAL_10_)/.test(v.tripId)) continue;
    (est.cancel[v.tripId] ??= [t, t])[1] = t;
  }
}

export function avisos(est, al) {
  est.avisosFecha = Number(al.header.timestamp);
  est.avisos = (al.entity ?? []).flatMap(e => {
    const a = e.alert;
    const lineas = [...new Set((a?.informedEntity ?? []).map(i => /^10T\d+(C\w+)$/.exec(i.routeId ?? '')?.[1]).filter(Boolean))];
    const texto = a?.descriptionText?.translation?.[0]?.text?.trim();
    return lineas.length && texto ? [{ desde: Number(a.activePeriod?.[0]?.start ?? 0), lineas, texto }] : [];
  });
}

// Saca del estado los trenes acabados y los devuelve para archivarlos.
export function podar(est, t) {
  const fuera = [];
  for (const [id, tr] of Object.entries(est.trenes)) if (tr.ult < t - 3 * 3600) { fuera.push([id, tr]); delete est.trenes[id]; }
  for (const [id, c] of Object.entries(est.cancel)) if (c[1] < t - 6 * 3600) delete est.cancel[id];
  return fuera;
}
