#!/usr/bin/env python3
"""Instala, actualiza o quita la política de flota en la configuración del usuario.

Uso: aplicar.py --revisar | --aplicar [--forzar] | --desinstalar

Un plugin no puede tocar settings.json ni cargar un CLAUDE.md. Este script lo hace, con respaldo:
  - CLAUDE.md: agrega o reemplaza el bloque entre <!-- flota:politica:inicio vX --> y
    <!-- flota:politica:fin -->. Lo de fuera no se toca. Si los marcadores están rotos (uno sin el
    otro, duplicados o al revés), no toca nada y pide arreglarlo a mano.
  - settings.json: env.CLAUDE_CODE_SUBAGENT_MODEL, modelSettings y fallbackModel (de ajustes.json).
    Un valor distinto que puso el usuario es un conflicto: no se pisa sin --forzar. Un valor que
    puso flota en una versión anterior se actualiza solo.
--revisar nunca escribe. --aplicar respalda en <config>/flota/respaldos/ y registra en
<config>/flota/instalado.json qué agregó y qué valor había antes, para que --desinstalar quite solo
eso y restaure lo previo. Todas las escrituras son atómicas (archivo temporal + rename).
Respeta CLAUDE_CONFIG_DIR, igual que Claude Code.
"""
import datetime, difflib, json, os, re, shutil, sys, tempfile

AQUI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLAUDE_DIR = os.path.expanduser(os.environ.get("CLAUDE_CONFIG_DIR") or "~/.claude")
MD = os.path.join(CLAUDE_DIR, "CLAUDE.md")
SETTINGS = os.path.join(CLAUDE_DIR, "settings.json")
FLOTA = os.path.join(CLAUDE_DIR, "flota")
REGISTRO = os.path.join(FLOTA, "instalado.json")
INICIO = re.compile(r"<!-- flota:politica:inicio v([\d.]+) -->")
FIN = "<!-- flota:politica:fin -->"
AUSENTE = "__ausente__"


def salir(msg):
    print(msg)
    sys.exit(1)


def leer(ruta, defecto=""):
    return open(ruta, encoding="utf-8-sig").read() if os.path.exists(ruta) else defecto


def escribir_atomico(ruta, texto):
    os.makedirs(os.path.dirname(ruta), exist_ok=True)
    real = os.path.realpath(ruta)  # si es symlink, se escribe el destino y el link sigue vivo
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(real), prefix=".flota-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(texto)
        if os.path.exists(real):
            shutil.copymode(real, tmp)
        os.replace(tmp, real)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def respaldar(ruta, sello):
    if not os.path.exists(ruta):
        return None
    os.makedirs(os.path.join(FLOTA, "respaldos"), exist_ok=True)
    dst = os.path.join(FLOTA, "respaldos", f"{os.path.basename(ruta)}.{sello}")
    n = 1
    while os.path.exists(dst):  # dos corridas en el mismo segundo no se pisan el respaldo
        dst = os.path.join(FLOTA, "respaldos", f"{os.path.basename(ruta)}.{sello}-{n}")
        n += 1
    shutil.copy2(ruta, dst)
    return dst


def cargar_settings():
    texto = leer(SETTINGS, "")
    if not texto.strip():
        return {}
    try:
        s = json.loads(texto)
    except json.JSONDecodeError as e:
        salir(f"settings.json no es JSON válido ({e}). Arréglalo a mano antes de continuar. No se tocó nada.")
    if not isinstance(s, dict):
        salir("settings.json no es un objeto JSON ({...}). Arréglalo a mano antes de continuar. No se tocó nada.")
    return s


def obtener(s, ruta):
    d = s
    for k in ruta:
        if not isinstance(d, dict) or k not in d:
            return AUSENTE
        d = d[k]
    return d


def contenedores_validos(s, ruta):
    """Cada nivel intermedio debe ser un dict o no existir; si no, no se puede escribir la clave."""
    d = s
    for k in ruta[:-1]:
        if k not in d:
            return True
        d = d[k]
        if not isinstance(d, dict):
            return False
    return True


def poner(s, ruta, valor):
    d = s
    for k in ruta[:-1]:
        d = d.setdefault(k, {})
    d[ruta[-1]] = valor


def quitar(s, ruta):
    padres = [s]
    for k in ruta[:-1]:
        siguiente = padres[-1].get(k)
        if not isinstance(siguiente, dict):
            return
        padres.append(siguiente)
    padres[-1].pop(ruta[-1], None)
    for i in range(len(ruta) - 1, 0, -1):  # limpia diccionarios que quedaron vacíos
        if not padres[i]:
            padres[i - 1].pop(ruta[i - 1], None)


def bloque_actual(md):
    """(inicio, fin, version) del bloque, None si no hay, o sale con error si está roto."""
    inicios = list(INICIO.finditer(md))
    fines = [m.start() for m in re.finditer(re.escape(FIN), md)]
    if not inicios and not fines:
        return None
    if len(inicios) != 1 or len(fines) != 1 or fines[0] < inicios[0].start():
        salir(f"El bloque de flota en {MD} está roto: hay {len(inicios)} marcador(es) de inicio y {len(fines)} "
              "de fin, o están al revés. Déjalo con un solo par ordenado, o sin ninguno, y vuelve a correr esto. "
              "No se tocó nada.")
    fin = fines[0] + len(FIN)
    if md[fin:fin + 1] == "\n":
        fin += 1
    return inicios[0].start(), fin, inicios[0].group(1)


def plan_settings(s, ajustes, registro, forzar):
    deseado = [(("env", "CLAUDE_CODE_SUBAGENT_MODEL"), (ajustes.get("env") or {}).get("CLAUDE_CODE_SUBAGENT_MODEL"))]
    for modelo, conf in (ajustes.get("modelSettings") or {}).items():
        for k, v in conf.items():
            deseado.append((("modelSettings", modelo, k), v))
    if ajustes.get("fallbackModel"):
        deseado.append((("fallbackModel",), ajustes["fallbackModel"]))
    puesto_por_flota = {tuple(e["ruta"]): e["valor"] for e in registro.get("agregado", [])}
    plan = []
    for ruta, valor in deseado:
        if valor is None:
            continue
        if not contenedores_validos(s, ruta):
            plan.append((ruta, valor, "bloqueado"))
            continue
        actual = obtener(s, ruta)
        if actual == AUSENTE:
            plan.append((ruta, valor, "agregar"))
        elif actual == valor:
            plan.append((ruta, valor, "igual"))
        elif ruta in puesto_por_flota and puesto_por_flota[ruta] == actual:
            plan.append((ruta, valor, "actualizar"))  # lo puso flota antes y el usuario no lo tocó
        else:
            plan.append((ruta, valor, "pisar" if forzar else "conflicto"))
    return plan


def main():
    modo = next((a for a in ("--revisar", "--aplicar", "--desinstalar") if a in sys.argv), None)
    if not modo:
        salir(__doc__)
    forzar = "--forzar" in sys.argv
    ajustes = json.load(open(os.path.join(AQUI, "ajustes.json"), encoding="utf-8"))
    bloque = leer(os.path.join(AQUI, "politica.md"))
    md = leer(MD)
    actual = bloque_actual(md)  # sale si los marcadores están rotos, en cualquier modo
    s = cargar_settings()
    try:
        registro = json.loads(leer(REGISTRO, "{}") or "{}")
    except json.JSONDecodeError:
        registro = {}
    sello = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

    if modo == "--desinstalar":
        md2 = (md[:actual[0]] + md[actual[1]:]) if actual else md
        md2 = md2.rstrip("\n") + "\n" if md2.strip() else ""
        cambios_s, restauradas, quitadas, dejadas = False, [], [], []
        for e in registro.get("agregado", []):
            ruta = tuple(e["ruta"])
            if not contenedores_validos(s, ruta):
                continue
            if obtener(s, ruta) != e["valor"]:
                dejadas.append(".".join(ruta))  # el usuario lo cambió después: es suyo
                continue
            if e.get("previo", AUSENTE) == AUSENTE:
                quitar(s, ruta)
                quitadas.append(".".join(ruta))
            else:
                poner(s, ruta, e["previo"])
                restauradas.append(".".join(ruta))
            cambios_s = True
        if not actual and not cambios_s:
            print("Flota no estaba instalada en esta configuración: no hay nada que quitar.")
            return
        r1 = respaldar(MD, sello) if actual else None
        r2 = respaldar(SETTINGS, sello) if cambios_s else None
        if actual:
            escribir_atomico(MD, md2)
        if cambios_s:
            escribir_atomico(SETTINGS, json.dumps(s, ensure_ascii=False, indent=2) + "\n")
        if os.path.exists(REGISTRO):
            os.remove(REGISTRO)
        print(f"Desinstalado. Bloque de la política: {'quitado' if actual else 'no estaba'} · ajustes quitados: "
              f"{', '.join(quitadas) or '-'} · restaurados a tu valor previo: {', '.join(restauradas) or '-'}"
              + (f" · dejados porque los cambiaste tú: {', '.join(dejadas)}" if dejadas else "")
              + f". Respaldos: {r1 or '-'} · {r2 or '-'}. Falta quitar el plugin: desde la app, Customize → Plugins → flota → Remove; "
              "desde la terminal, claude plugin uninstall flota@flota")
        return

    plan = plan_settings(s, ajustes, registro, forzar)
    md2 = (md[:actual[0]] + bloque + md[actual[1]:]) if actual else \
        ((md.rstrip("\n") + "\n\n" if md.strip() else "") + bloque)
    v_nueva = INICIO.search(bloque).group(1)
    afuera = (md[:actual[0]] + md[actual[1]:]) if actual else md
    otras_reglas = [p for p in ("CLAUDE_CODE_SUBAGENT_MODEL", "Política de modelos", "model: opus")
                    if p.lower() in afuera.lower()]
    effort_global = (s.get("env") or {}).get("CLAUDE_CODE_EFFORT_LEVEL") if isinstance(s.get("env"), dict) else None

    if modo == "--revisar":
        if md2 == md:
            print("CLAUDE.md: sin cambios")
        elif actual:
            print(f"CLAUDE.md: actualizar el bloque de la política v{actual[2]} → v{v_nueva}")
            diff = [l for l in difflib.unified_diff(md[actual[0]:actual[1]].splitlines(), bloque.splitlines(), lineterm="", n=0)
                    if not l.startswith(("---", "+++", "@@"))]
            print("  líneas que cambian:\n    " + "\n    ".join(diff[:60]) + ("\n    …" if len(diff) > 60 else ""))
        else:
            print(f"CLAUDE.md: agregar el bloque de la política v{v_nueva} al final ({len(bloque.splitlines())} líneas)")
        if otras_reglas:
            print(f"  AVISO: tu CLAUDE.md ya menciona {', '.join(otras_reglas)} fuera del bloque de flota: revisa que no se contradigan.")
        print("settings.json:")
        for ruta, valor, estado in plan:
            print(f"  {estado:<10} {'.'.join(ruta)} = {json.dumps(valor, ensure_ascii=False)}")
        if any(e == "conflicto" for _, _, e in plan):
            print("  Hay conflictos: tu valor actual es distinto. Solo se pisan con --forzar (con OK del usuario); "
                  "al desinstalar se restaura tu valor.")
        if any(e == "bloqueado" for _, _, e in plan):
            print("  Hay claves bloqueadas: en tu settings.json un contenedor (env o modelSettings) no es un objeto. "
                  "Arréglalo a mano para aplicarlas.")
        if effort_global:
            print(f"  AVISO: tienes env.CLAUDE_CODE_EFFORT_LEVEL={effort_global}. Le gana al esfuerzo de TODOS los "
                  "agentes (anula el xhigh de cada uno). Flota recomienda quitarla; no se quita sola.")
        return

    # --aplicar: todo validado arriba; recién ahora se escribe
    cambios = [(r, v) for r, v, e in plan if e in ("agregar", "actualizar", "pisar")]
    previos = {tuple(e["ruta"]): e for e in registro.get("agregado", [])}
    for ruta, valor in cambios:
        anterior = previos.get(ruta)
        if anterior is not None and anterior["valor"] == obtener(s, ruta):
            previo = anterior.get("previo", AUSENTE)  # sigue valiendo el valor que había antes de flota
        else:
            previo = obtener(s, ruta)
        previos[ruta] = {"ruta": list(ruta), "valor": valor, "previo": previo}
    r1 = respaldar(MD, sello) if md2 != md else None
    r2 = respaldar(SETTINGS, sello) if cambios else None
    for ruta, valor in cambios:
        poner(s, ruta, valor)
    if cambios:
        escribir_atomico(SETTINGS, json.dumps(s, ensure_ascii=False, indent=2) + "\n")
    if md2 != md:
        escribir_atomico(MD, md2)
    escribir_atomico(REGISTRO, json.dumps({"version": ajustes.get("version"), "agregado": list(previos.values())},
                                          ensure_ascii=False, indent=2) + "\n")
    pendientes = [".".join(r) for r, _, e in plan if e in ("conflicto", "bloqueado")]
    print(f"Listo. CLAUDE.md: {'actualizado' if md2 != md else 'sin cambios'} · settings.json: {len(cambios)} ajustes"
          + (f" · sin tocar (conflicto o bloqueado): {', '.join(pendientes)}" if pendientes else "")
          + f". Respaldos: {r1 or '-'} · {r2 or '-'}. Abre una sesión nueva para que tome efecto.")


if __name__ == "__main__":
    main()
