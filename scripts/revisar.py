"""
revisar.py — Sobe o servidor local e abre a tela de revisão da escala.

Uso:
    python scripts/revisar.py             # usa o mês atual
    python scripts/revisar.py 2026-09     # revisa um mês específico
    npm run revisar -- 2026-09            # via npm

Abre http://localhost:8000/revisao/index.html?mes=AAAA-MM no navegador.
Encerre com Ctrl+C.
"""

import http.server
import socketserver
import webbrowser
import threading
import os
import sys
import re
from datetime import date

PORT = 8000


def resolver_mes(argv):
    """Retorna o mês no formato AAAA-MM a partir do argumento ou usa o mês atual."""
    for arg in argv[1:]:
        arg = arg.strip()
        if re.fullmatch(r"\d{4}-\d{2}", arg):
            return arg
        if arg:
            print(f"AVISO: '{arg}' não está no formato AAAA-MM. Usando o mês atual.")
    hoje = date.today()
    return f"{hoje.year}-{hoje.month:02d}"


class Handler(http.server.SimpleHTTPRequestHandler):
    """Handler que desativa cache — sempre serve a versão mais recente do disco.

    Sem isto, o navegador/cliente pode manter em cache um rascunho.md antigo
    (via Last-Modified / 304 Not Modified) e não refletir edições feitas na
    escala. Como o rascunho muda com frequência durante a revisão, forçamos
    'no-store' e removemos os cabeçalhos que disparam validação de cache.
    """

    def log_message(self, format, *args):
        pass  # silencioso

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_header(self, keyword, value):
        # Suprime Last-Modified para evitar respostas 304 (conteúdo em cache).
        if keyword.lower() == "last-modified":
            return
        super().send_header(keyword, value)


def main():
    mes = resolver_mes(sys.argv)

    # Servir a partir da raiz do projeto, independente de onde o script está.
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(project_root)

    ano, mm = mes.split("-")
    rascunho = os.path.join("escalas", ano, mm, "rascunho.md")
    if not os.path.exists(rascunho):
        print(f"AVISO: rascunho não encontrado: {rascunho}")
        print("       A tela vai abrir, mas mostrará um aviso até o rascunho existir.")

    url = f"http://localhost:{PORT}/revisao/index.html?mes={mes}"

    def abrir_navegador():
        webbrowser.open(url)

    try:
        with socketserver.TCPServer(("", PORT), Handler) as httpd:
            threading.Timer(1.0, abrir_navegador).start()
            print("=" * 56)
            print(f"  Revisão da escala — {mes}")
            print("=" * 56)
            print(f"  Abrindo: {url}")
            print("  Servidor rodando. Encerre com Ctrl+C.")
            print("=" * 56)
            httpd.serve_forever()
    except OSError as err:
        if getattr(err, "errno", None) in (48, 98, 10048):  # porta em uso
            print(f"A porta {PORT} já está em uso. Provavelmente o servidor já está rodando.")
            print(f"Abra manualmente no navegador: {url}")
            abrir_navegador()
        else:
            raise
    except KeyboardInterrupt:
        print("\nServidor encerrado.")


if __name__ == "__main__":
    main()
