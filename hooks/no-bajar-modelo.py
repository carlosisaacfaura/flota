#!/usr/bin/env python3
"""PreToolUse (Agent|Task): impide BAJAR el modelo de un agente tipado de flota.

El `model` que se pasa en la llamada le gana al `model:` del frontmatter, así que un skill que pida
"especifica siempre el modelo" o "usa el más barato" anularía en silencio la política de modelos.
Subir está permitido. Excepción explícita: la description contiene "panel mixto" (jueces de
familias distintas a propósito). Revisa los agentes del plugin ("flota:<agente>") y los propios del
usuario en ~/.claude/agents/. Ante cualquier error deja pasar la llamada: nunca debe romper Agent.
"""
import json
import os
import re
import sys

TIER = {"haiku": 1, "sonnet": 2, "opus": 3, "fable": 4, "mythos": 4}
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLAUDE_DIR = os.path.expanduser(os.environ.get("CLAUDE_CONFIG_DIR") or "~/.claude")


def tier(modelo):
    m = (modelo or "").lower()
    for nombre, t in TIER.items():
        if nombre in m:
            return t, nombre
    return None, None


def ruta_agente(tipo):
    if tipo.startswith("flota:"):
        nombre = tipo.split(":", 1)[1]
        return os.path.join(RAIZ, "agents", f"{nombre}.md") if re.fullmatch(r"[\w-]+", nombre) else None
    if ":" in tipo or "/" in tipo or not re.fullmatch(r"[\w-]+", tipo):
        return None  # agentes de otros plugins o nombres raros: no son nuestros
    return os.path.join(CLAUDE_DIR, "agents", f"{tipo}.md")


def main():
    datos = json.load(sys.stdin)
    entrada = datos.get("tool_input") or {}
    pedido = entrada.get("model")
    tipo = entrada.get("subagent_type") or ""
    if not pedido or not tipo or "panel mixto" in (entrada.get("description") or "").lower():
        return
    ruta = ruta_agente(tipo)
    if not ruta or not os.path.isfile(ruta):
        return
    with open(ruta, encoding="utf-8") as fh:
        cabecera = fh.read(4000)
    fm = re.search(r"^model:\s*(\S+)", cabecera, re.MULTILINE)
    if not fm:
        return
    t_base, n_base = tier(fm.group(1))
    t_pedido, n_pedido = tier(pedido)
    if t_base is None or t_pedido is None or t_pedido >= t_base:
        return
    razon = (
        f"Política de modelos: el agente '{tipo}' corre en '{n_base}' por diseño y no se le baja el "
        f"modelo (pediste '{n_pedido}'). Repite la llamada SIN el parámetro model (o con uno igual o "
        f"superior). Esto prevalece sobre skills que pidan especificar siempre el modelo o usar el más barato."
    )
    if tipo.split(":")[-1] in ("revisor", "verificador", "revisor-critico"):
        razon += (" Si la tarea en realidad es mecánica o de búsqueda, usa el agente de ese rol "
                  "(flota:mecanico, flota:investigador, flota:explorador) en vez de abaratar este.")
    razon += " Tabla de roles y modelos: bloque 'Política de modelos (flota)' en ~/.claude/CLAUDE.md."
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": razon,
        }
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass  # ante cualquier error, no bloquear
