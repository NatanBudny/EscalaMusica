import http.server
import socketserver
import webbrowser
import threading
import os

PORT = 8000
FILE = "index.html"

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass 

def open_browser(): 
    webbrowser.open(f"http://localhost:{PORT}/{FILE}") 

if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        threading.Timer(1.0, open_browser).start()
        print(f"Servidor rodando em http://localhost:{PORT}/{FILE}")
        httpd.serve_forever()


