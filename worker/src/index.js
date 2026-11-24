import { DurableObject } from 'cloudflare:workers';
import { nuevoEstado, observar, cancelados, avisos, podar } from './observador.js';

const FLOTA = 'https://tiempo-real.renfe.com/renfe-visor/flota.json';
const TU = 'https://gtfsrt.renfe.com/trip_updates.json';
const ALERTAS = 'https://gtfsrt.renfe.com/alerts.json';
const HORARIOS = 'https://horarios.renfe.com/cer/HorariosServlet';
const RITMO = 30_000;

const CORS = { 'access-control-allow-origin': '*' };
const json = (x, max = 10) => Response.json(x, { headers: { ...CORS, 'cache-control': `public, max-age=${max}` } });
const pedir = async (url, init) => {
  const r = await fetch(url, { ...init, headers: { 'user-agent': 'Mozilla/5.0', ...init?.headers }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r;
};

export class Observador extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.especiales = new Map();
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS viajes (dia TEXT, id TEXT, datos TEXT, PRIMARY KEY (dia, id))');
      this.est = (await ctx.storage.get('estado')) ?? nuevoEstado();
    });
  }

  async despierta() {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now());
  }

  async alarm() {
    await this.ctx.storage.setAlarm(Date.now() + RITMO);
    const t = Math.round(Date.now() / 1000);
    // Cada fuente falla por separado: un error en una no debe tapar a las demás.
    const r = await Promise.allSettled([
      pedir(FLOTA).then(r => r.json()).then(j => observar(this.est, j)),
      pedir(TU).then(r => r.json()).then(j => cancelados(this.est, j, t)),
      t - (this.ultAvisos ?? 0) > 300 ? pedir(ALERTAS).then(r => r.json()).then(j => { avisos(this.est, j); this.ultAvisos = t; }) : null,
    ]);
    for (const x of r) if (x.status === 'rejected') console.error(String(x.reason));
    for (const [id, tr] of podar(this.est, t)) {
      const dia = new Date(tr.ult * 1000).toISOString().slice(0, 10);
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO viajes VALUES (?, ?, ?)', dia, id, JSON.stringify(tr.obs));
    }
    await this.ctx.storage.put('estado', this.est);
  }

  async estado() {
    await this.despierta();
    return this.est;
  }

  historico(dia) {
    return this.ctx.storage.sql.exec('SELECT id, datos FROM viajes WHERE dia = ?', dia).toArray().map(f => [f.id, JSON.parse(f.datos)]);
  }

  // Renfe mete trenes de refuerzo en su horario web que no salen en el horario abierto.
  async horarioWeb(o, d) {
    const k = o + d, g = this.especiales.get(k);
    if (g && Date.now() - g.t < 300_000) return g.v;
    // Un solo viaje a Renfe cada 2 s: este endpoint es público y no debe servir para martillearles.
    if (Date.now() - (this.ultHorario ?? 0) < 2000) return g?.v ?? [];
    this.ultHorario = Date.now();
    const fchaViaje = new Intl.DateTimeFormat('sv', { timeZone: 'Europe/Madrid' }).format().replaceAll('-', '');
    const r = await pedir(HORARIOS, {
      method: 'POST', headers: { 'content-type': 'application/json;charset=utf-8' },
      body: JSON.stringify({ nucleo: '10', origen: o, destino: d, fchaViaje, validaReglaNegocio: true, tiempoReal: true, servicioHorarios: 'VTI', horaViajeOrigen: '00', horaViajeLlegada: '26', accesibilidadTrenes: true }),
    });
    const v = ((await r.json()).horario ?? []).map(x => [String(x.cdgoTren).trim().padStart(5, '0'), x.linea, x.horaSalida]);
    if (this.especiales.size > 200) this.especiales.clear();
    this.especiales.set(k, { t: Date.now(), v });
    return v;
  }
}

const obs = env => env.OBSERVADOR.get(env.OBSERVADOR.idFromName('madrid'));

export default {
  async fetch(req, env) {
    const u = new URL(req.url), q = u.searchParams;
    if (req.method !== 'GET') return new Response('Método no permitido', { status: 405, headers: CORS });
    try {
      if (u.pathname === '/estado') return json(await obs(env).estado());
      if (u.pathname === '/horario') {
        const o = q.get('o') ?? '', d = q.get('d') ?? '';
        if (!/^\d{5}$/.test(o) || !/^\d{5}$/.test(d)) return new Response('Estación no válida', { status: 400, headers: CORS });
        return json(await obs(env).horarioWeb(o, d), 300);
      }
      if (u.pathname === '/historico') {
        const dia = q.get('dia') ?? '';
        if (!/^\d{4}-\d\d-\d\d$/.test(dia)) return new Response('Día no válido', { status: 400, headers: CORS });
        return json(await obs(env).historico(dia), 300);
      }
    } catch (e) {
      console.error(String(e));
      return new Response('Renfe no responde', { status: 502, headers: CORS });
    }
    return new Response('No existe', { status: 404, headers: CORS });
  },
  // Red de seguridad: si la alarma se perdiera, vuelve a arrancar.
  async scheduled(_c, env) {
    await obs(env).despierta();
  },
};
