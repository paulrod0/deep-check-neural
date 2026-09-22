#!/usr/bin/env python3
"""Servidor del Pueblo de Pablo.

Sirve la página estática y expone /api/estado con la actividad EN DIRECTO
de los proyectos y agentes de Claude (leyendo ~/.claude/projects).
Solo biblioteca estándar. Escucha únicamente en 127.0.0.1.
"""
import json
import os
import re
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
PROYECTOS = Path.home() / ".claude" / "projects"
PUERTO = 8642
VENTANA_ACTIVO = 90      # segundos sin escribir en el jsonl para dejar de estar "en directo"
COLA_BYTES = 786432      # cuánto leer del final del transcript (los resultados con imágenes ocupan cientos de KB)


def _detalle_herramienta(item):
    entrada = item.get("input") or {}
    nombre = item.get("name", "")
    if nombre == "Bash":
        d = (entrada.get("command") or "")[:48]
    elif nombre in ("Edit", "Write", "Read", "NotebookEdit"):
        d = os.path.basename(entrada.get("file_path") or "")
    elif nombre == "Grep":
        d = (entrada.get("pattern") or "")[:30]
    elif nombre == "Agent":
        d = (entrada.get("description") or "")[:40]
    else:
        d = ""
    return re.sub(r"\s+", " ", d).strip()


def _interpreta(obj):
    """Convierte una línea del transcript en un resumen de actividad, o None."""
    tipo = obj.get("type")
    if tipo == "assistant":
        contenido = (obj.get("message") or {}).get("content") or []
        if isinstance(contenido, list):
            for item in reversed(contenido):
                if not isinstance(item, dict):
                    continue
                if item.get("type") == "tool_use":
                    return {
                        "accion": "herramienta",
                        "herramienta": item.get("name", ""),
                        "detalle": _detalle_herramienta(item),
                    }
                if item.get("type") == "text" and item.get("text", "").strip():
                    return {"accion": "escribiendo", "herramienta": "", "detalle": ""}
            for item in reversed(contenido):
                if isinstance(item, dict) and item.get("type") == "thinking":
                    return {"accion": "pensando", "herramienta": "", "detalle": ""}
        return {"accion": "pensando", "herramienta": "", "detalle": ""}
    if tipo == "user":
        contenido = (obj.get("message") or {}).get("content")
        if isinstance(contenido, list) and any(
            isinstance(i, dict) and i.get("type") == "tool_result" for i in contenido
        ):
            return {"accion": "resultados", "herramienta": "", "detalle": ""}
        return {"accion": "ordenes", "herramienta": "", "detalle": ""}
    return None


def resumen_ultimo_evento(jsonl):
    """Lee la cola del transcript y devuelve la última actividad interpretable."""
    try:
        tamano = jsonl.stat().st_size
        with open(jsonl, "rb") as f:
            f.seek(max(0, tamano - COLA_BYTES))
            datos = f.read().decode("utf-8", "ignore")
        for linea in reversed(datos.splitlines()):
            linea = linea.strip()
            if not linea:
                continue
            try:
                obj = json.loads(linea)
            except ValueError:
                continue
            resumen = _interpreta(obj)
            if resumen:
                return resumen
    except OSError:
        pass
    return {"accion": "trabajando", "herramienta": "", "detalle": ""}


def estado_proyectos():
    ahora = time.time()
    salida = []
    if not PROYECTOS.is_dir():
        return {"ahora": int(ahora), "ventana": VENTANA_ACTIVO, "proyectos": salida}
    for carpeta in sorted(PROYECTOS.iterdir()):
        if not carpeta.is_dir():
            continue
        try:
            transcripts = list(carpeta.glob("*.jsonl"))
        except OSError:
            continue
        # las sesiones son los transcripts principales; los agent-*.jsonl son subagentes
        sesiones = sum(1 for t in transcripts if not t.name.startswith("agent-"))
        ultima_mod = 0
        reciente = None
        for t in transcripts:
            try:
                m = t.stat().st_mtime
            except OSError:
                continue
            if m > ultima_mod:
                ultima_mod = m
                reciente = t
        activo = bool(reciente) and (ahora - ultima_mod) < VENTANA_ACTIVO
        salida.append({
            "carpeta": carpeta.name,
            "sesiones": sesiones,
            "ultimaMod": int(ultima_mod),
            "activo": activo,
            "resumen": resumen_ultimo_evento(reciente) if activo else None,
        })
    return {"ahora": int(ahora), "ventana": VENTANA_ACTIVO, "proyectos": salida}


class Manejador(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(RAIZ), **kwargs)

    def do_GET(self):
        if self.path.split("?")[0] in ("/api/estado", "/api/estado/"):
            cuerpo = json.dumps(estado_proyectos()).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(cuerpo)))
            self.end_headers()
            self.wfile.write(cuerpo)
            return
        super().do_GET()

    def log_message(self, formato, *args):
        pass  # silencio: el sondeo cada 3 s ensuciaría los logs


if __name__ == "__main__":
    servidor = ThreadingHTTPServer(("127.0.0.1", PUERTO), Manejador)
    print(f"El Pueblo de Pablo en directo: http://localhost:{PUERTO}")
    servidor.serve_forever()
