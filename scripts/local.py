import http.server
import socketserver
import webbrowser
import threading
import os

PORT = 8000
FILE = "index.html"
MAINTENANCE_MODE = False
MAINTENANCE_FILE = "maintenance.html"

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if MAINTENANCE_MODE:
            # Em manutenção, qualquer rota retorna a página temporária.
            self.path = f"/{MAINTENANCE_FILE}"
        return super().do_GET()

    def log_message(self, format, *args):
        pass 

def open_browser(): 
    start_file = MAINTENANCE_FILE if MAINTENANCE_MODE else FILE
    webbrowser.open(f"http://localhost:{PORT}/{start_file}") 

if __name__ == "__main__":
    # Serve from the project root regardless of where this script lives.
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(project_root)

    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        threading.Timer(1.0, open_browser).start()
        page = MAINTENANCE_FILE if MAINTENANCE_MODE else FILE
        if MAINTENANCE_MODE:
            print("MODO TEMPORARIO ATIVO: exibindo aviso de finalizacao da escala.")
            print("Para voltar ao normal, altere MAINTENANCE_MODE para False em local.py.")
        print(f"Servidor rodando em http://localhost:{PORT}/{page}")
        httpd.serve_forever()
