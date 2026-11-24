"""Reduce el horario abierto de Renfe a Madrid: un JSON por día y otro de estaciones.
Uso: python scripts/horario.py <carpeta de salida> [zip ya descargado]"""
import collections, csv, datetime as dt, io, json, pathlib, sys, urllib.request, zipfile

URL = "https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip"
DIAS = 4
SEMANA = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def filas(z, nombre):
    # Renfe rellena con espacios tanto cabeceras como valores.
    r = csv.reader(io.TextIOWrapper(z.open(nombre), encoding="utf-8-sig"))
    cab = [c.strip() for c in next(r)]
    for f in r:
        yield dict(zip(cab, (c.strip() for c in f)))


def minutos(h):
    a = h.split(":")
    return int(a[0]) * 60 + int(a[1])


def main(salida, zip_local=None):
    datos = open(zip_local, "rb").read() if zip_local else urllib.request.urlopen(URL, timeout=120).read()
    z = zipfile.ZipFile(io.BytesIO(datos))
    hoy = dt.datetime.now(dt.timezone(dt.timedelta(hours=1))).date()
    dias = [hoy + dt.timedelta(d) for d in range(-1, DIAS)]
    servicios = collections.defaultdict(set)
    for c in filas(z, "calendar.txt"):
        for d in dias:
            s = d.strftime("%Y%m%d")
            if c["service_id"].startswith("10") and c["start_date"] <= s <= c["end_date"] and c[SEMANA[d.weekday()]] == "1":
                servicios[c["service_id"]].add(d)
    viajes = {t["trip_id"]: t["service_id"] for t in filas(z, "trips.txt") if t["service_id"] in servicios}
    paradas = collections.defaultdict(list)
    for s in filas(z, "stop_times.txt"):
        if s["trip_id"] in viajes:
            paradas[s["trip_id"]].append((int(s["stop_sequence"]), s["stop_id"], minutos(s["departure_time"] or s["arrival_time"])))
    porDia = collections.defaultdict(dict)
    usadas = set()
    for id, ps in paradas.items():
        ps.sort()
        usadas.update(p[1] for p in ps)
        for d in servicios[viajes[id]]:
            porDia[d][id] = [[p[1] for p in ps], [p[2] for p in ps]]
    if len(porDia[hoy]) < 300:
        sys.exit(f"Horario sospechoso: solo {len(porDia[hoy])} trenes hoy. No se publica.")
    salida = pathlib.Path(salida)
    salida.mkdir(parents=True, exist_ok=True)
    for d, v in porDia.items():
        (salida / f"{d}.json").write_text(json.dumps(v, separators=(",", ":")), encoding="utf-8")
    nombres = {s["stop_id"]: s["stop_name"] for s in filas(z, "stops.txt") if s["stop_id"] in usadas}
    if faltan := usadas - nombres.keys():
        sys.exit(f"Estaciones sin nombre: {faltan}")
    (salida / "estaciones.json").write_text(json.dumps(nombres, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print({str(d): len(v) for d, v in sorted(porDia.items())}, len(nombres), "estaciones")


main(*sys.argv[1:])
