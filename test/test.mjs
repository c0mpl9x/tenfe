// Reproduce la tarde del 24/11/2026 grabada de Renfe. Ejecutar: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { nuevoEstado, observar, cancelados, podar, avisos } from '../worker/src/observador.js';
import { trayecto, veredicto, epochMadrid } from '../web/core.js';

const G = JSON.parse(gunzipSync(readFileSync(new URL('./tarde_20261124.json.gz', import.meta.url))));
const base = epochMadrid('2026-11-24T00:00:00');
const hora = h => epochMadrid(`2026-11-24T${h}`);
const H = [{ base, viajes: G.viajes }];

function hasta(h) {
  const est = nuevoEstado();
  for (const f of G.flota) if (epochMadrid(f.fechaActualizacion) <= hora(h)) observar(est, f);
  for (const [t, ids] of G.cancel) if (t <= hora(h))
    cancelados(est, { entity: ids.map(tripId => ({ tripUpdate: { trip: { tripId, scheduleRelationship: 'CANCELED' } } })) }, t);
  return est;
}
const ver = (h, o, d, num) => trayecto(H, hasta(h), o, d, hora(h)).trenes.find(t => t.num === num);

test('hora de Madrid en invierno y en verano', () => {
  assert.equal(epochMadrid('2026-11-24T18:24:53'), Date.parse('2026-11-24T17:24:53Z') / 1000);
  assert.equal(epochMadrid('2026-07-24T18:24:53'), Date.parse('2026-07-24T16:24:53Z') / 1000);
});

test('ningún tren retrocede tras filtrar', () => {
  let n = 0;
  for (const [id, tr] of Object.entries(hasta('18:59:00').trenes)) {
    const p = G.viajes[id]?.[0];
    if (!p) continue;
    const ix = tr.obs.map(o => p.indexOf(o[0])).filter(i => i >= 0);
    for (let i = 1; i < ix.length; i++) { assert.ok(ix[i] >= ix[i - 1], id); n++; }
  }
  assert.ok(n > 100);
});

test('75350: suprimido aunque Renfe lo liste como normal', () =>
  assert.equal(ver('18:40:00', '10000', '10100', '75350').estado, 'SUPRIMIDO'));

test('75347: parado en Pinar, la hora es un mínimo', () => {
  const v = ver('18:40:00', '10000', '17000', '75347');
  assert.equal(v.estado, 'SIN_SALIR');
  assert.equal(v.eta, hora('18:40:00') + 24 * 60 - 100);
});

test('75152: el teletransporte de las 18:38 no mueve el tren', () => {
  const antes = ver('18:38:00', '10000', '17000', '75152'), durante = ver('18:39:30', '10000', '17000', '75152');
  assert.equal(antes.estado, 'EN_MARCHA');
  assert.equal(durante.u.i, antes.u.i);
  assert.ok(Math.abs(durante.eta - antes.eta) < 180);
});

test('76854: en andén hasta salir a las 18:42:50, nunca 18:50', () => {
  const v = ver('18:42:30', '10000', '18000', '76854');
  assert.equal(v.estado, 'EN_ANDEN');
  assert.equal(v.eta, hora('18:42:30'));
  const r = veredicto('1027M76854C7', G.viajes['1027M76854C7'][0], G.viajes['1027M76854C7'][1].map(m => base + m * 60), hasta('18:43:30'), 0, 5, hora('18:43:30'));
  assert.equal(r.estado, 'PASADO');
  assert.ok(Math.abs(r.paso - hora('18:42:50')) < 60);
});

test('hueco: salta si dejan de pasar trenes y no salta si pasan', () => {
  const est = hasta('18:40:00');
  assert.equal(trayecto(H, est, '10000', '10100', hora('18:40:00')).huecos.find(h => h.linea === 'C10').mal, false);
  const luego = hora('19:40:00');
  const h = trayecto(H, { ...est, fecha: luego, cambio: luego }, '10000', '10100', luego).huecos.find(x => x.linea === 'C10');
  assert.equal(h.mal, true);
});

test('tren que debía salir y no aparece; no se acusa si no estábamos mirando', () => {
  const id = '1027M75254C10', [p, m] = G.viajes[id], hs = m.map(x => base + x * 60), t = hs[0] + 600;
  const est = { ...nuevoEstado(), desde: hs[0] - 3600, fecha: t };
  assert.equal(veredicto(id, p, hs, est, 5, 8, t).estado, 'SIN_SENAL');
  assert.equal(veredicto(id, p, hs, { ...est, desde: t }, 5, 8, t).estado, 'DESCONOCIDO');
});

test('tren sin hechos que Renfe sitúa ya más allá de tu estación: no se ofrece', () => {
  const id = '1027M75254C10', [p, m] = G.viajes[id], hs = m.map(x => base + x * 60), t = hs[9] + 600;
  const est = e => ({ ...nuevoEstado(), desde: t - 30, fecha: t, trenes: { [id]: { obs: [], huella: `${e}|A|0`, ult: t, dest: p.at(-1), via: '', crudo: 'A' } } });
  assert.equal(veredicto(id, p, hs, est(p[7]), 5, 9, t).estado, 'DESCONOCIDO');
  assert.equal(veredicto(id, p, hs, est(p[3]), 5, 9, t).estado, 'SIN_CONFIRMAR');
});

test('tren acortado por Renfe', () => {
  const id = '1027M75254C10', [p, m] = G.viajes[id], hs = m.map(x => base + x * 60), t = hs[0];
  const est = { ...nuevoEstado(), desde: t - 60, fecha: t, trenes: { [id]: { obs: [[p[0], 'E', t - 60, t]], huella: '', ult: t, dest: p[3], via: '', crudo: 'E' } } };
  assert.equal(veredicto(id, p, hs, est, 1, 6, t).corto, true);
  assert.equal(veredicto(id, p, hs, est, 5, 8, t).estado, 'CORTADO');
});

test('fichero sin Madrid: se conserva lo último bueno; si persiste, se acepta', () => {
  const est = hasta('18:40:00'), f = est.fecha;
  for (let i = 1; i <= 6; i++) observar(est, { fechaActualizacion: `2026-11-24T18:4${i}:00`, trenes: [] });
  assert.equal(est.fecha, f);
  observar(est, { fechaActualizacion: '2026-11-24T18:49:00', trenes: [] });
  assert.ok(est.fecha > f);
});

test('foto más vieja que la anterior se ignora, y podar archiva lo acabado', () => {
  const est = hasta('18:40:00'), f = est.fecha;
  observar(est, { fechaActualizacion: '2026-11-24T18:00:00', trenes: [] });
  assert.equal(est.fecha, f);
  assert.equal(podar(est, f).length, 0);
  assert.ok(podar(est, f + 4 * 3600).length > 50);
  assert.equal(Object.keys(est.trenes).length, 0);
});

test('avisos: solo líneas de Madrid', () => {
  const est = nuevoEstado();
  const a = r => ({ alert: { activePeriod: [{ start: '5' }], informedEntity: [{ routeId: r }], descriptionText: { translation: [{ text: ' x ' }] } } });
  avisos(est, { header: { timestamp: '9' }, entity: [a('10T0005C2'), a('51T0005R2')] });
  assert.deepEqual(est.avisos, [{ desde: 5, lineas: ['C2'], texto: 'x' }]);
});
