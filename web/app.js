import { trayecto, epochMadrid } from './core.js';
import { API } from './config.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...hijos) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...hijos.filter(h => h != null && h !== ''));
  return e;
};
const seg = () => Math.floor(Date.now() / 1000);
const reloj = t => new Date(t * 1000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
const dia = t => new Intl.DateTimeFormat('sv', { timeZone: 'Europe/Madrid' }).format(t * 1000);
const mins = s => Math.max(0, Math.round(s / 60));
const dura = s => (mins(s) < 60 ? `${mins(s)} min` : `${Math.floor(mins(s) / 60)} h ${mins(s) % 60} min`);

const COLORES = { C1: ['#75b6e0', '#000'], C2: ['#00943d', '#000'], C3: ['#952585', '#fff'], C4: ['#2c2a86', '#fff'], C5: ['#fecb00', '#000'], C7: ['#e5202a', '#fff'], C8: ['#868584', '#000'], C9: ['#915419', '#fff'], C10: ['#bccf00', '#000'] };
const color = l => COLORES[l] ?? COLORES[l.replace(/[ab]$/, '')] ?? ['#808080', '#000'];

let estaciones, horarios = [], estado, especiales = [], fallo = 0, clave = '';
const nombre = c => estaciones[c] ?? c;
const viaje = JSON.parse(localStorage.getItem('viaje') ?? '{}');

async function traer(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

async function cargarHorarios() {
  const hoy = dia(seg());
  if (horarios.hoy === hoy) return;
  // De madrugada aún circulan trenes del día de servicio anterior.
  const dias = new Date().getHours() < 4 ? [hoy, dia(seg() - 86400)] : [hoy];
  const r = await Promise.allSettled(dias.map(async f => ({ base: epochMadrid(`${f}T00:00:00`), viajes: await traer(`data/${f}.json`) })));
  horarios = r.filter(x => x.status === 'fulfilled').map(x => x.value);
  if (r[0].status === 'fulfilled') horarios.hoy = hoy;
}

async function cargarEspeciales() {
  const { o, d } = viaje, k = o + d;
  especiales = [];
  try {
    const base = epochMadrid(`${dia(seg())}T00:00:00`);
    const r = await traer(`${API}/horario?o=${o}&d=${d}`);
    if (k === viaje.o + viaje.d) especiales = r.map(([num, linea, h]) => ({ num, linea, sale: base + h.slice(0, 2) * 3600 + h.slice(3, 5) * 60 }));
  } catch (e) { console.warn(e); }
}

async function refrescar() {
  if (document.hidden || !viaje.o || !viaje.d || viaje.o === viaje.d) return;
  try {
    await cargarHorarios();
    estado = await traer(`${API}/estado`);
    fallo = 0;
  } catch (e) {
    console.warn(e);
    fallo ||= seg();
  }
  pintar();
}

function frase(v, t) {
  const en = v.u && nombre(v.paradas[v.u.i]);
  switch (v.estado) {
    case 'EN_ANDEN': return ['En tu andén'];
    case 'EN_MARCHA': return [v.u.k === 'M' ? `En marcha, entre ${en} y ${nombre(v.paradas[v.u.i + 1])}` : `Parado en ${en}`];
    case 'SIN_SALIR': return v.quieto > 60 ? [`Sin salir de ${en}, lleva ${dura(v.quieto)} de retraso`, true] : [`Esperando su hora en ${en}`];
    case 'SOSPECHOSO': return [v.u.k === 'M' ? `Salió de ${en} hace ${dura(t - v.u.t0)} y no llega a ${nombre(v.paradas[v.u.i + 1])}` : `Lleva ${dura(v.quieto)} quieto en ${en}`, true];
    case 'SIN_SENAL': return [v.u ? `Sin señal desde hace ${dura(t - v.visto)}, estaba en ${en}` : `Debió salir de ${nombre(v.paradas[0])} y no aparece`, true];
    case 'SIN_CONFIRMAR': return ['Renfe lo anuncia, aún sin posición fiable'];
    case 'PROGRAMADO': return v.echadoEnFalta ? ['Ya debería aparecer y Renfe no lo publica', true] : ['Solo horario, Renfe aún no lo publica'];
    case 'SUPRIMIDO': return ['Suprimido', true];
    case 'CORTADO': return [v.corto ? `Acaba en ${nombre(v.dest)}, no llega a tu parada` : `Acaba en ${nombre(v.dest)}, no llega hasta aquí`, true];
    case 'ESPECIAL': return [v.ultima ? `Refuerzo, visto en ${nombre(v.ultima[0])}` : 'Refuerzo, sin posición conocida'];
  }
}

const VISTO = ['EN_ANDEN', 'EN_MARCHA'];
const MINIMO = ['SIN_SALIR', 'SOSPECHOSO', 'SIN_CONFIRMAR'];

function hilo(v) {
  if (!v.u || v.u.i >= v.io) return '';
  const desde = Math.max(v.u.i, v.io - 8), h = el('div', { className: 'hilo', ariaHidden: 'true' });
  if (v.estado === 'SIN_SENAL' || v.estado === 'SOSPECHOSO') h.classList.add('roto');
  if (desde > v.u.i) h.append(el('i', { className: 'aqui' }), el('b', { className: 'lejos' }));
  for (let i = desde; i < v.io; i++) {
    const es = i === v.u.i;
    h.append(el('i', { className: es && v.u.k === 'E' ? 'aqui' : '' }), el('b', { className: es && v.u.k === 'M' ? 'aqui' : '' }));
  }
  h.append(el('i', { className: 'tu' }));
  return h;
}

function fila(v, t) {
  const [texto, malo] = frase(v, t), no = v.estado === 'SUPRIMIDO' || v.estado === 'CORTADO';
  const sinHora = no || v.estado === 'SIN_SENAL'; // no se puede calcular cuándo llega
  const falta = mins(v.eta - t), largo = sinHora || falta >= 60;
  const cifra = el('span', { className: 'cifra' }, largo ? reloj(sinHora ? v.sale : v.eta) : String(falta));
  if (largo) cifra.classList.add('corta');
  if (no) cifra.classList.add('tachada');
  else if (!VISTO.includes(v.estado)) cifra.classList.add('hueca');
  const minimo = MINIMO.includes(v.estado);
  const pie = sinHora ? 'previsto' : largo ? (minimo ? 'o después' : VISTO.includes(v.estado) ? '' : 'por horario') : minimo ? 'min o más' : 'min';
  const [c, tx] = color(v.linea);
  const li = el('li', { className: 'tren' },
    el('div', { className: 'cuando' }, cifra, el('small', {}, pie), largo ? '' : el('small', {}, `${reloj(v.eta)}${minimo ? ' o después' : ''}`)),
    el('div', {},
      el('div', { className: 'destino' }, el('span', { className: 'linea' }, v.linea), el('span', {}, nombre(v.dest))),
      el('p', { className: malo ? 'malo' : '' }, texto),
      el('p', { className: 'detalle' }, [`Horario ${reloj(v.sale)}`, v.via && !no ? `vía ${v.via}` : '', `tren ${v.num}`].filter(Boolean).join(', '))),
    hilo(v));
  li.style.setProperty('--color', c);
  li.style.setProperty('--texto', tx);
  return li;
}

function pintar() {
  const t = seg(), { o, d } = viaje;
  const alarma = [];
  $('trenes').replaceChildren();
  $('avisos').hidden = true;
  $('adif').hidden = !o;
  $('adif').href = `https://info.adif.es/?s=${o}`;
  $('edad').textContent = '';
  $('paso').textContent = '';
  if (!o || !d) { $('paso').textContent = 'Elige dónde subes y dónde bajas.'; return alarmar(alarma); }
  if (o === d) { $('paso').textContent = 'Subes y bajas en la misma estación. Cambia una de las dos.'; return alarmar(alarma); }
  if (fallo) alarma.push(`No se puede contactar con el observador desde las ${reloj(fallo)}. Lo que ves puede ser viejo.`);
  if (!estado || !horarios.length) { if (!fallo) $('paso').textContent = 'Buscando trenes…'; return alarmar(alarma); }
  if (!estado.fecha) { // sin ningún hecho aún, no se puede acusar a ningún tren
    $('paso').textContent = 'El observador acaba de arrancar. Los trenes aparecen en unos segundos.';
    setTimeout(refrescar, 4000);
    return alarmar(alarma);
  }
  if (!horarios.hoy) alarma.push('Falta el horario de hoy. Solo se ven trenes de ayer.');

  const r = trayecto(horarios, estado, o, d, t, especiales);
  const vivos = Object.values(estado.trenes).some(x => x.ult === estado.fecha);
  if (r.edad > 150) alarma.push(`Renfe no da datos nuevos desde hace ${dura(r.edad)}. No te fíes de esta pantalla.`);
  else if (vivos && r.quieto > 240) alarma.push(`Los datos de Renfe llevan ${dura(r.quieto)} congelados. No te fíes de esta pantalla.`);
  for (const h of r.huecos.filter(h => h.mal))
    alarma.push(h.ultimo
      ? `Hace ${dura(h.hueco)} que no pasa ninguna ${h.linea} hacia tu destino. Lo normal es una cada ${mins(h.normal)} min.`
      : `No ha pasado ninguna ${h.linea} hacia tu destino en los ${dura(h.hueco)} que llevo mirando. Lo normal es una cada ${mins(h.normal)} min.`);
  alarmar(alarma);

  const ult = r.huecos.filter(h => h.ultimo).sort((a, b) => b.ultimo - a.ultimo)[0];
  $('paso').textContent = ult ? `El último pasó ${t - ult.ultimo < 60 ? 'ahora mismo' : `hace ${dura(t - ult.ultimo)}`} (${ult.linea}).`
    : r.huecos.length ? `Mirando desde las ${reloj(estado.desde)}. Aún no he visto pasar ninguno.` : '';
  if (r.trenes.length) $('trenes').append(...r.trenes.slice(0, 12).map(v => fila(v, t)));
  else $('trenes').append(el('li', {}, horarios.some(h => Object.values(h.viajes).some(([p]) => p.indexOf(d, p.indexOf(o) + 1) > 0 && p.includes(o)))
    ? 'No hay trenes en las próximas dos horas.' : 'No hay tren directo entre estas estaciones. Prueba con la de transbordo.'));

  const lineas = new Set(r.huecos.map(h => h.linea.replace(/[ab]$/, '')));
  const av = estado.avisos.filter(a => a.lineas.some(l => lineas.has(l.replace(/[ab]$/, '')))).sort((a, b) => b.desde - a.desde);
  if (av.length) {
    $('avisos').hidden = false;
    $('avisos').querySelector('summary').textContent = av.length === 1 ? 'Un aviso de Renfe para tus líneas' : `${av.length} avisos de Renfe para tus líneas`;
    $('avisos').querySelector('ul').replaceChildren(...av.map(a => el('li', {},
      el('small', {}, `${a.lineas.join(', ')}, desde el ${new Date(a.desde * 1000).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Madrid' })}`), a.texto)));
  }
  $('edad').textContent = `Último dato de Renfe hace ${Math.max(0, r.edad)} s.`;
}

const alarmar = textos => {
  const clave2 = textos.join('|');
  if (clave2 === clave) return; // no repetir el mismo anuncio a un lector de pantalla
  clave = clave2;
  $('alarma').replaceChildren(...textos.map(x => el('p', {}, x)));
};

function elegir() {
  viaje.o = $('o').value;
  viaje.d = $('d').value;
  localStorage.setItem('viaje', JSON.stringify(viaje));
  pintar();
  if (viaje.o && viaje.d && viaje.o !== viaje.d) { refrescar(); cargarEspeciales().then(pintar); }
}

try {
  estaciones = await traer('data/estaciones.json');
  const op = Object.entries(estaciones).sort((a, b) => a[1].localeCompare(b[1], 'es'));
  for (const id of ['o', 'd']) {
    $(id).append(new Option('elige estación', ''), ...op.map(([c, n]) => new Option(n, c)));
    $(id).value = estaciones[viaje[id]] ? viaje[id] : '';
    $(id).onchange = elegir;
  }
  $('girar').onclick = () => { [$('o').value, $('d').value] = [$('d').value, $('o').value]; elegir(); };
  document.onvisibilitychange = refrescar;
  setInterval(refrescar, 20_000);
  setInterval(cargarEspecialesSiToca, 300_000);
  setInterval(() => estado && pintar(), 5_000);
  elegir();
} catch (e) {
  console.error(e);
  alarmar(['No se han podido cargar las estaciones. Recarga la página.']);
}

function cargarEspecialesSiToca() {
  if (!document.hidden && viaje.o && viaje.d && viaje.o !== viaje.d) cargarEspeciales();
}
