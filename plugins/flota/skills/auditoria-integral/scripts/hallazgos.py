#!/usr/bin/env python3
"""Consolida los hallazgos de una auditoría integral: IDs estables, dedupe, prioridad, delta y cobertura.

Subcomandos:
  consolidar --entrada crudo.json --proyecto <ruta> --fecha AAAA-MM-DD --sha <sha> [--alcance alcance.json]
             [--antiguedad antiguedad.json]
      Lee la salida del workflow ({hallazgos: [...], cobertura: [...]}), escribe
      <proyecto>/docs/auditorias/hallazgos.jsonl (estado acumulado entre auditorías) y
      <proyecto>/docs/auditorias/AAAA-MM-DD-tablas.md (AHORA / PRÓXIMO / DESPUÉS / delta / cobertura),
      listas para pegar en el informe.
  marcar --proyecto <ruta> --id <id> --estado descartado|resuelto|abierto --motivo "texto"
      Registra la decisión del usuario sobre un hallazgo (la próxima auditoría no lo re-reporta).
  previos --proyecto <ruta>
      Imprime en JSON lo que los agentes NO deben re-reportar (descartados por el usuario) y las
      decisiones registradas, para inyectarlo en los prompts.

ID estable = sha1(archivo|símbolo|tipo), sin número de línea (las líneas se mueven). Si una
auditoría nueva no produce el mismo ID, se intenta emparejar por (archivo, tipo) y título parecido.
"Resuelto" nunca se infiere de que un hallazgo no reaparezca: si el archivo cambió queda
"posiblemente_resuelto"; si no cambió queda "no_reobservado" (sigue abierto).
"""
import hashlib, json, os, re, sys
from collections import defaultdict

SEV = {"alta": 3, "media": 2, "baja": 1}
ESF = {"S": 1, "M": 2, "L": 3}
TOPE_AHORA, TOPE_PROXIMO, TOPE_DESPUES_LINEAS = 7, 10, 40
STOP = set("el la los las de del en un una y o a al que por para con sin se es no su sus lo como si the of to in and".split())


def arg(k, defecto=None):
    return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else defecto


def norm(s):
    return re.sub(r"\s+", " ", re.sub(r"[()\[\]{}`'\"]", "", (s or "").strip().lower()))


def id_estable(h):
    base = f"{norm(h['archivo'])}|{norm(h.get('simbolo') or '(archivo)')}|{norm(h.get('tipo') or 'otro')}"
    return hashlib.sha1(base.encode()).hexdigest()[:10]


def palabras(t):
    return {w for w in re.findall(r"[a-záéíóúñ0-9_]+", (t or "").lower()) if w not in STOP and len(w) > 2}


def parecido(a, b):
    pa, pb = palabras(a), palabras(b)
    return len(pa & pb) / len(pa | pb) if pa and pb else 0.0


def hash_archivo(proyecto, rel):
    p = os.path.join(proyecto, rel)
    if not os.path.isfile(p):
        return None
    return hashlib.sha1(open(p, "rb").read()).hexdigest()[:12]


def cargar_jsonl(ruta):
    if not os.path.exists(ruta):
        return {}
    return {d["id"]: d for d in (json.loads(l) for l in open(ruta) if l.strip())}


def guardar_jsonl(ruta, datos):
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    with open(ruta, "w") as f:
        for d in sorted(datos.values(), key=lambda d: d["id"]):
            f.write(json.dumps(d, ensure_ascii=False) + "\n")


def prioridad(h):
    # La severidad manda siempre (un alto nunca queda detrás de un medio); dentro de la misma
    # severidad: zona crítica, menor esfuerzo y evidencia más fuerte primero.
    p = SEV.get(h["severidad"], 1) * 100
    p += 20 if h.get("zona_critica") else 0
    p += (4 - ESF.get(h.get("esfuerzo", "M"), 2)) * 5
    p += {"REPRODUCIDO": 5, "CONFIRMADO": 5}.get(h.get("estado_verificacion"), 0)
    return p


def bucket(h):
    s, e, zc = h["severidad"], h.get("esfuerzo", "M"), h.get("zona_critica")
    if (s == "alta" and e in ("S", "M")) or (s == "media" and e == "S" and zc):
        return "AHORA"
    if s == "alta" or (s == "media" and e in ("S", "M")):
        return "PRÓXIMO"
    return "DESPUÉS"


def corto(t, n=95):
    t = re.sub(r"\s+", " ", t or "").strip().replace("|", "/")
    return t if len(t) <= n else t[: n - 1] + "…"


def fila(h):
    ruta = f"{h['archivo']}:{h['linea_vista']}" if h.get("linea_vista") else h["archivo"]
    return (f"| {h['id']} | {h['severidad']} | {h.get('esfuerzo', '?')} | {corto(h['titulo'])} | `{ruta}` | "
            f"{h.get('estado_verificacion', '?')} | {corto(h.get('arreglo', ''), 80)} |")


def consolidar():
    proyecto = os.path.abspath(arg("--proyecto"))
    fecha, sha = arg("--fecha"), arg("--sha", "sin-git")
    carpeta = os.path.join(proyecto, "docs", "auditorias")
    crudo_txt = open(arg("--entrada"), encoding="utf-8").read()
    crudo = json.loads(crudo_txt)
    corrida = hashlib.sha1(f"{fecha}|{crudo_txt}".encode()).hexdigest()[:10]
    previos = {}
    # Re-consolidar la MISMA corrida (mismo crudo, misma fecha) es idempotente: cada registro que tocó
    # esa corrida guarda cómo estaba antes ("_antes") y se restaura; los que nacieron en ella se
    # descartan. Otra corrida del mismo día (otra auditoría) cuenta como previa normal.
    for k, v in cargar_jsonl(os.path.join(carpeta, "hallazgos.jsonl")).items():
        if v.get("_corrida") == corrida:
            decision = {c: v.get(c) for c in ("decision_usuario", "motivo_usuario") if v.get(c)}
            if v.get("_antes") is None:
                if not decision:
                    continue
            else:
                v = dict(v["_antes"])
            v.update(decision)
        previos[k] = v
    antig = json.load(open(arg("--antiguedad"))).get("archivos", {}) if arg("--antiguedad") else {}

    # 1) normalizar e ID; los REFUTADOS por el verificador no entran a los buckets
    nuevos, refutados = {}, []
    for h in crudo.get("hallazgos", []):
        h = dict(h)
        h["severidad"] = h.get("severidad", "media").lower()
        h["esfuerzo"] = (h.get("esfuerzo") or "M").upper()[:1]
        h["linea_vista"] = h.pop("linea", h.get("linea_vista"))
        if h.get("estado_verificacion") == "REFUTADO":
            refutados.append(h)
            continue
        h["id"] = id_estable(h)
        # emparejar con un hallazgo previo del mismo archivo y tipo con título parecido
        if h["id"] not in previos:
            for pid, p in previos.items():
                if p["archivo"] == h["archivo"] and p.get("tipo") == h.get("tipo") and parecido(p["titulo"], h["titulo"]) >= 0.5:
                    h["id"] = pid
                    break
        # dedupe dentro de esta auditoría: mismo ID, o mismo archivo con título muy parecido
        dup = h["id"] if h["id"] in nuevos else next(
            (k for k, o in nuevos.items() if o["archivo"] == h["archivo"] and parecido(o["titulo"], h["titulo"]) >= 0.6), None)
        if dup:
            o = nuevos[dup]
            o["dimensiones"] = sorted(set(o["dimensiones"]) | {h.get("dimension", "?")})
            sev_previa = o["severidad"]
            if SEV[h["severidad"]] > SEV[o["severidad"]] or h.get("estado_verificacion") in ("REPRODUCIDO", "CONFIRMADO"):
                for k in ("severidad", "estado_verificacion", "escenario", "arreglo", "linea_vista"):
                    o[k] = h.get(k, o.get(k))
            # un duplicado verificado de menor severidad no puede bajar la del grupo (29-09: un alto
            # REPRODUCIDO quedó en medio porque una variante CONFIRMADO de otra dimensión lo pisó)
            if SEV[sev_previa] > SEV[o["severidad"]]:
                o["severidad"] = sev_previa
            o["zona_critica"] = o.get("zona_critica") or h.get("zona_critica")
            continue
        h["dimensiones"] = [h.get("dimension", "?")]
        if h["archivo"] in antig:
            mods = antig[h["archivo"]]["modelos"]
            h["modelo_predominante"] = max(mods, key=mods.get)
        nuevos[h["id"]] = h

    # 2) ciclo de vida contra la auditoría previa
    estado = {}
    vistos = set()  # hallazgos observados en ESTA corrida
    delta = defaultdict(list)
    for hid, h in nuevos.items():
        p = previos.get(hid)
        if p and p.get("decision_usuario") == "descartado":
            antes = {c: x for c, x in p.items() if not c.startswith("_")}
            p.update(last_seen=fecha, sha_auditado=sha, _corrida=corrida, _antes=antes)
            estado[hid] = p
            delta["descartado_reaparece"].append(p)
            continue
        registro = {k: h.get(k) for k in ("id", "dimensiones", "tipo", "severidad", "esfuerzo", "archivo", "simbolo",
                                          "linea_vista", "titulo", "escenario", "arreglo", "estado_verificacion",
                                          "zona_critica", "modelo_predominante", "agente")}
        registro.update(first_seen=p["first_seen"] if p else fecha, last_seen=fecha, sha_auditado=sha,
                        _corrida=corrida, _antes={c: x for c, x in p.items() if not c.startswith("_")} if p else None,
                        hash_archivo=hash_archivo(proyecto, h["archivo"]),
                        estado_ciclo="persistente" if p else "nuevo",
                        decision_usuario=p.get("decision_usuario") if p else None,
                        apariciones=(p.get("apariciones", 1) + 1) if p else 1)
        estado[hid] = registro
        vistos.add(hid)
        delta["persistente" if p else "nuevo"].append(registro)
    for pid, p in previos.items():
        if pid in estado:
            continue
        if p.get("decision_usuario") in ("descartado", "resuelto") or p.get("estado_ciclo") == "resuelto":
            estado[pid] = p
            continue
        actual = hash_archivo(proyecto, p["archivo"])
        antes = {c: x for c, x in p.items() if not c.startswith("_")}
        p["estado_ciclo"] = "posiblemente_resuelto" if actual != p.get("hash_archivo") else "no_reobservado"
        p.update(_corrida=corrida, _antes=antes)
        estado[pid] = p
        delta[p["estado_ciclo"]].append(p)
    guardar_jsonl(os.path.join(carpeta, "hallazgos.jsonl"), estado)

    # 3) buckets con topes duros (el excedente baja un nivel)
    abiertos = [estado[i] for i in vistos] + list(delta["no_reobservado"])
    for h in abiertos:
        h["_prio"] = prioridad(h)
    grupos = {"AHORA": [], "PRÓXIMO": [], "DESPUÉS": []}
    for h in sorted(abiertos, key=lambda h: -h["_prio"]):
        grupos[bucket(h)].append(h)
    grupos["PRÓXIMO"] = grupos["AHORA"][TOPE_AHORA:] + grupos["PRÓXIMO"]
    grupos["AHORA"] = grupos["AHORA"][:TOPE_AHORA]
    grupos["DESPUÉS"] = grupos["PRÓXIMO"][TOPE_PROXIMO:] + grupos["DESPUÉS"]
    grupos["PRÓXIMO"] = grupos["PRÓXIMO"][:TOPE_PROXIMO]

    # 4) cobertura: archivos de código del alcance que ningún agente declaró revisar
    sin_cubrir = []
    if arg("--alcance"):
        al = json.load(open(arg("--alcance")))
        revisados = {a for c in crudo.get("cobertura", []) for a in c.get("archivos_revisados", [])}
        sin_cubrir = [a for a in al.get("loc_por_archivo", {}) if a not in revisados]

    # 5) salida en markdown para el informe
    enc = "| id | sev | esf | hallazgo | ruta | estado | arreglo |\n|---|---|---|---|---|---|---|"
    out = [f"<!-- generado por hallazgos.py · {fecha} · {sha} -->"]
    for nombre in ("AHORA", "PRÓXIMO"):
        out += [f"\n## {nombre} ({len(grupos[nombre])})\n", enc] + [fila(h) for h in grupos[nombre]]
        if not grupos[nombre]:
            out.append("| – | – | – | (sin hallazgos en este nivel) | – | – | – |")
    desp = grupos["DESPUÉS"]
    out.append(f"\n## DESPUÉS ({len(desp)})\n\n<details><summary>Ver {len(desp)} hallazgos menores, por dimensión</summary>\n")
    por_dim = defaultdict(list)
    for h in desp:
        por_dim[(h.get("dimensiones") or ["?"])[0]].append(h)
    n = 0
    for dim in sorted(por_dim):
        out.append(f"\n**{dim}**")
        for h in por_dim[dim]:
            if n >= TOPE_DESPUES_LINEAS:
                break
            out.append(f"- `{h['id']}` {h['severidad']}/{h.get('esfuerzo', '?')} · {corto(h['titulo'], 110)} · `{h['archivo']}`")
            n += 1
    if len(desp) > n:
        out.append(f"\n…y {len(desp) - n} más en `hallazgos.jsonl`.")
    out.append("\n</details>")
    if previos:
        out.append("\n## Delta vs auditoría anterior\n")
        for k, etiqueta in (("nuevo", "Nuevos"), ("persistente", "Persistentes"), ("posiblemente_resuelto", "Posiblemente resueltos (el archivo cambió)"),
                            ("no_reobservado", "No reobservados (archivo sin cambios: siguen abiertos)"), ("descartado_reaparece", "Descartados por el usuario que reaparecen")):
            ids = ", ".join(f"`{h['id']}`" for h in delta[k][:15]) + (" …" if len(delta[k]) > 15 else "")
            out.append(f"- {etiqueta}: {len(delta[k])}" + (f" ({ids})" if delta[k] else ""))
    if refutados:
        out.append(f"\nRefutados por el verificador (no entran al informe): {len(refutados)}.")
    if arg("--alcance"):
        out.append(f"\nArchivos de código sin revisión declarada: {len(sin_cubrir)}" +
                   (" · " + ", ".join(f"`{a}`" for a in sin_cubrir[:12]) + (" …" if len(sin_cubrir) > 12 else "") if sin_cubrir else ""))
    ruta_md = os.path.join(carpeta, f"{fecha}-tablas.md")
    open(ruta_md, "w").write("\n".join(out) + "\n")
    print("\n".join(out))
    print(f"\n[hallazgos.jsonl: {len(estado)} registros · tablas: {ruta_md}]")
    resumen = {k: len(v) for k, v in grupos.items()}
    resumen.update(alta_abiertas=sum(1 for h in abiertos if h["severidad"] == "alta"), refutados=len(refutados),
                   sin_cubrir=len(sin_cubrir), delta={k: len(v) for k, v in delta.items()})
    print("RESUMEN " + json.dumps(resumen, ensure_ascii=False))


def marcar():
    carpeta = os.path.join(os.path.abspath(arg("--proyecto")), "docs", "auditorias")
    datos = cargar_jsonl(os.path.join(carpeta, "hallazgos.jsonl"))
    hid, est = arg("--id"), arg("--estado")
    if hid not in datos or est not in ("descartado", "resuelto", "abierto"):
        sys.exit(f"ID desconocido o estado inválido: {hid} {est}")
    datos[hid]["decision_usuario"] = None if est == "abierto" else est
    datos[hid]["motivo_usuario"] = arg("--motivo", "")
    if est == "resuelto":
        datos[hid]["estado_ciclo"] = "resuelto"
    guardar_jsonl(os.path.join(carpeta, "hallazgos.jsonl"), datos)
    print(f"{hid} → {est}: {datos[hid]['titulo']}")


def previos():
    carpeta = os.path.join(os.path.abspath(arg("--proyecto")), "docs", "auditorias")
    datos = cargar_jsonl(os.path.join(carpeta, "hallazgos.jsonl"))
    print(json.dumps({"no_reportar": [{k: d.get(k) for k in ("id", "archivo", "simbolo", "tipo", "titulo", "motivo_usuario")}
                                      for d in datos.values() if d.get("decision_usuario") == "descartado"],
                      "abiertos_previos": len([d for d in datos.values() if d.get("estado_ciclo") in ("nuevo", "persistente", "no_reobservado") and not d.get("decision_usuario")])},
                     ensure_ascii=False, indent=1))


if __name__ == "__main__":
    {"consolidar": consolidar, "marcar": marcar, "previos": previos}[sys.argv[1]]()
