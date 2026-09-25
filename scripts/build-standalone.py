"""Build a dependency-free HTML file using only Python's standard library."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
html = (root / 'index.html').read_text(encoding='utf-8')
html = re.sub(r'<link rel="stylesheet" href="styles\.css(?:\?[^\"]*)?">',
              lambda _: '<style>' + (root / 'styles.css').read_text(encoding='utf-8') + '</style>', html)
for name in ('engine.js', 'game.js'):
    pattern = r'<script src="' + re.escape(name) + r'(?:\?[^\"]*)?"></script>'
    html = re.sub(pattern, lambda _, n=name: '<script>' + (root / n).read_text(encoding='utf-8') + '</script>', html)
output = root / 'dist' / 'dodge-again.html'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(html, encoding='utf-8')
print('Built dist/dodge-again.html')
