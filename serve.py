"""Servidor estático de desarrollo para Álbum Familiar.

Envía cabeceras `no-store` para que el navegador NUNCA sirva HTML/CSS/JS
cacheado (el caché nos hacía ver versiones viejas al recargar).

Uso:  python serve.py   →   http://127.0.0.1:8777
"""
import http.server
import os
import socketserver

PUERTO = 8777
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class SinCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


with socketserver.TCPServer(("127.0.0.1", PUERTO), SinCache) as httpd:
    print(f"Álbum Familiar servido en http://127.0.0.1:{PUERTO} (sin caché)")
    httpd.serve_forever()
