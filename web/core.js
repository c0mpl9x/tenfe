// De hechos observados a veredictos para un trayecto. Todo en segundos epoch.
// horarios: [{ base: medianoche del día de servicio, viajes: { tripId: [[paradas], [minutos]] } }]

const MARGEN_PARADO = 300; // a partir de aquí un tren quieto deja de ser normal
// El horario cuenta de salida a salida; lo que importa es cuándo llega, y pasa parado este tiempo.
// shortcut: mediana de 154 paradas del 24/11/2026, sustituir por tiempos por tramo cuando haya 1-2 semanas de histórico.
const PARADA = 100;
const CADUCA = 180;        // sin aparecer en el feed este tiempo, ya no se sabe nada de él

// Renfe da la hora de Madrid sin zona.
export function epochMadrid(local) {
  const utc = Date.parse(local + 'Z');
  const nombre = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Madrid', timeZoneName: 'longOffset' })
    .formatToParts(utc).find(p => p.type === 'timeZoneName').value;
  const m = /GMT([+-])(\d\d):(\d\d)/.exec(nombre);
  const desfase = m ? (m[1] === '-' ? -1 : 1) * (m[2] * 60 + +m[3]) : 0;
  return Math.round(utc / 1000) - desfase * 60;
}

export const linea = id => /C\w+$/.exec(id)?.[0] ?? '';
const numero = id => /(\d{5})C\w+$/.exec(id)?.[1] ?? id;
const mediana = a => [...a].sort((x, y) => x - y)[a.length >> 1];

// Deja solo las observaciones que avanzan por el recorrido.
function avance(obs, paradas) {
  const r = [];
  for (const [e, k, t0, t1] of obs) {
    const i = paradas.indexOf(e), u = r.at(-1);
    if (i < 0 || (u && (i < u.i || (i === u.i && u.k === 'M' && k === 'E')))) continue;
    r.push({ i, k, t0, t1 });
  }
  return r;
}

export function veredicto(id, paradas, horas, est, io, id_, ahora) {
  const tr = est.trenes[id];
  const run = (a, b) => horas[b] - horas[a];
  const v = { id, num: numero(id), linea: linea(id), paradas, io, sale: horas[io], llega: horas[id_], dest: paradas.at(-1), via: tr?.via ?? '', visto: tr?.ult };
  const fin = (estado, eta, extra) => ({ ...v, estado, eta, ...extra });

  const c = est.cancel[id];
  if (c && !(tr && tr.ult > c[1] + 120)) return fin('SUPRIMIDO', horas[io]);

  const obs = tr ? avance(tr.obs, paradas) : [];
  const paso = obs.find(x => x.i > io || (x.i === io && x.k === 'M'));
  if (paso) return fin('PASADO', paso.t0, { paso: paso.t0 });

  // Renfe acorta trenes sin anunciarlo: el destino del feed no es el del horario.
  const corte = tr ? paradas.indexOf(tr.dest) : -1;
  if (corte >= 0 && corte < id_) {
    v.dest = paradas[corte];
    return corte <= io ? fin('CORTADO', horas[io]) : fin('CORTADO', horas[io], { corto: true });
  }

  const u = obs.at(-1);
  if (!tr) {
    // Solo se puede echar en falta un tren si ya estábamos mirando cuando debía salir.
    if (ahora > horas[0] + CADUCA) return fin(est.desde < horas[0] ? 'SIN_SENAL' : 'DESCONOCIDO', horas[io]);
    return fin('PROGRAMADO', horas[io], { echadoEnFalta: horas[0] - ahora < 1200 && est.desde < horas[0] - 1800 });
  }
  if (tr.ult < est.fecha - CADUCA) return fin('SIN_SENAL', u ? tr.ult + run(u.i, io) : horas[io], { u });
  // Sin hechos todavía y Renfe ya lo sitúa más allá de ti: pasó antes de empezar a mirar.
  if (!u && paradas.indexOf(tr.huella.split('|')[0]) > io) return fin('DESCONOCIDO', horas[io]);
  if (!u) return fin('SIN_CONFIRMAR', Math.max(ahora + run(0, io), horas[io]) - PARADA);
  if (u.i === io) return fin('EN_ANDEN', Math.max(ahora, horas[io]), { u });

  if (u.k === 'M') {
    const eta = Math.max(u.t0 + run(u.i, io) - PARADA, ahora + run(u.i + 1, io));
    return fin(ahora - u.t0 > run(u.i, u.i + 1) + MARGEN_PARADO ? 'SOSPECHOSO' : 'EN_MARCHA', eta, { u });
  }
  const eta = Math.max(ahora, u.t0 + PARADA, horas[u.i]) + run(u.i, io) - PARADA;
  const quieto = ahora - Math.max(u.t0, horas[u.i]);
  if (u.i === 0) return fin('SIN_SALIR', eta, { u, quieto });
  return fin(quieto > MARGEN_PARADO && tr.crudo !== 'A' ? 'SOSPECHOSO' : 'EN_MARCHA', eta, { u, quieto });
}

export function trayecto(horarios, est, o, d, ahora, especiales = []) {
  const todos = [], numeros = new Set();
  for (const { base, viajes } of horarios)
    for (const [id, [paradas, min]] of Object.entries(viajes)) {
      const io = paradas.indexOf(o), id_ = paradas.indexOf(d, io + 1);
      if (io < 0 || id_ < 0) continue;
      numeros.add(numero(id));
      const horas = min.map(m => base + m * 60);
      if (horas[io] < ahora - 3 * 3600 || horas[io] > ahora + 3 * 3600) continue;
      todos.push(veredicto(id, paradas, horas, est, io, id_, ahora));
    }

  const trenes = todos.filter(v =>
    v.estado !== 'PASADO' && v.estado !== 'DESCONOCIDO' && v.eta < ahora + 2 * 3600 &&
    (['SUPRIMIDO', 'CORTADO', 'SIN_SENAL', 'PROGRAMADO'].includes(v.estado) ? v.sale > ahora - 1800 : true));

  for (const e of especiales) {
    if (numeros.has(e.num) || e.sale < ahora - 1800 || e.sale > ahora + 2 * 3600) continue;
    const tr = Object.entries(est.trenes).find(([id]) => numero(id) === e.num)?.[1];
    trenes.push({ ...e, id: e.num, estado: 'ESPECIAL', eta: e.sale, dest: d, ultima: tr?.obs.at(-1), visto: tr?.ult });
  }
  trenes.sort((a, b) => a.eta - b.eta);

  // Huecos: no dependen de que nadie anuncie nada, solo de trenes vistos pasar.
  const huecos = [...new Set(todos.map(v => v.linea))].map(l => {
    const suyos = todos.filter(v => v.linea === l);
    const pasos = suyos.filter(v => v.paso).map(v => v.paso).sort((a, b) => b - a);
    const cerca = suyos.map(v => v.sale).filter(s => Math.abs(s - ahora) < 5400).sort((a, b) => a - b);
    const saltos = cerca.slice(1).map((s, i) => s - cerca[i]);
    const normal = saltos.length ? mediana(saltos) : 0;
    const ref = pasos[0] ?? est.desde;
    const debidos = suyos.filter(v => v.sale > ref + 60 && v.sale < ahora).length;
    return { linea: l, ultimo: pasos[0], normal, hueco: ahora - ref, mal: debidos > 0 && normal > 0 && ahora - ref > Math.max(2 * normal, normal + 480) };
  }).filter(h => h.normal);

  return { trenes, huecos, edad: ahora - est.fecha, quieto: ahora - est.cambio };
}
