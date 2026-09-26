#!/usr/bin/env python3
"""
Lightweight local HTTP server for Mandelbrot 64 Fractal Explorer
Usage:
    python3 server.py [port]
"""

import http.server
import socketserver
import sys
import webbrowser
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8088
DIRECTORY = Path(__file__).parent.resolve()

class FractalHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIRECTORY), **kwargs)

    def end_headers(self):
        # Enable caching controls and cross-origin isolation if needed
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

def main():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), FractalHTTPRequestHandler) as httpd:
        url = f"http://127.0.0.1:{PORT}"
        print(f"\n=======================================================")
        print(f"✦ MANDELBROT 64 FRACTAL EXPLORER RUNNING ✦")
        print(f"  URL: {url}")
        print(f"  Press Ctrl+C to terminate.")
        print(f"=======================================================\n")
        
        # Optionally open in default web browser
        if "--no-browser" not in sys.argv:
            try:
                webbrowser.open(url)
            except Exception:
                pass

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer shutting down.")

if __name__ == '__main__':
    main()
