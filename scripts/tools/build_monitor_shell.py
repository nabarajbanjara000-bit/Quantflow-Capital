#!/usr/bin/env python3
"""One-time: builds public/monitor/index.html (the page shell) from the bundled 8-country monitor.
Keeps its head, CSS, header, country tabs and footer; replaces the hand-written panels with empty containers
that public/monitor/monitor.js fills from public/monitor/data/*.json."""
import base64, hashlib, re, sys
src, out = sys.argv[1], sys.argv[2]
t = open(src, encoding='utf8').read()
CODES = ["us", "japan", "germany", "canada", "newzealand", "australia", "switzerland", "uk"]

# images -> files
ext = {'jpeg': 'jpg', 'png': 'png', 'avif': 'avif', 'svg+xml': 'svg', 'webp': 'webp'}
def img(m):
    raw = base64.b64decode(m.group(2)); h = hashlib.sha1(raw).hexdigest()[:10]
    name = f"assets/img/{h}.{ext[m.group(1)]}"
    open('public/' + name, 'wb').write(raw)
    return '/' + name
t = re.sub(r'data:image/([a-z+]+);base64,([A-Za-z0-9+/=]+)', img, t)

a = t.index('<div class="opanel" id="panel-overview">')
b = t.index('</main>')
containers = '<div class="opanel" id="panel-overview" hidden><p class="loading">Loading the latest data…</p></div>\n' + \
    ''.join(f'<div class="cpanel" id="panel-{c}" data-country="{c}" hidden></div>\n' for c in CODES)
t = t[:a] + containers + t[b:]
# script: replaced by monitor.js
s = t.index('<script>', t.index('</footer>'))
e = t.index('</script>', s) + len('</script>')
t = t[:s] + '<script src="monitor.js"></script>' + t[e:]
# footer: say plainly how the text is written
old = "The chances shown are our judgement and can be wrong.</p>"
assert old in t
t = t.replace(old, "The chances shown are our judgement and can be wrong.</p>\n      <p><strong>How this page is updated:</strong> every day, a program collects the latest official numbers (from each central bank, statistics office and treasury, and from FRED, which republishes U.S. data) and reads new central-bank statements, minutes and speeches. An AI model then rewrites the explanations, report cards and chances following Quant Flow Capital's written rules. Automatic checks block invented quotations, impossible chances and links to unofficial sites. The text is <strong>written by an AI model and published without review by a person</strong>. Numbers that are not yet refreshed automatically are marked as hand-checked snapshots.</p>", 1)
t = t.replace("<title>", "<title>", 1)
# TOC: add "What changed"
toc_old = '<li><a href="#us-verdict" data-sec="verdict"><span>01</span>Verdict</a></li>'
assert toc_old in t
t = t.replace(toc_old, '<li><a href="#us-changed" data-sec="changed"><span>00</span>What changed</a></li>' + toc_old, 1)
# extra styles for the "What changed" box and notes
css = '''
/* ---------- Added for the self-updating version ---------- */
.changed{background:var(--surface);border:1px solid var(--line);border-top:4px solid var(--gold);border-radius:var(--radius);padding:22px 26px;margin:18px 0 0}
.changed .ch-top{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}
.changed h2{font-family:var(--serif);font-size:24px;font-weight:500;margin:0}
.changed .ch-date{font-size:13px;color:var(--muted);font-weight:600}
.changed .ch-head{font-weight:600;margin:10px 0 8px}
.changed ul.ch-items{margin:0 0 6px;padding-left:1.2em}.changed ul.ch-items li{margin-bottom:8px}
.changed details{margin-top:10px;border-top:1px solid var(--line);padding-top:8px}
.changed summary{cursor:pointer;font-weight:600;color:var(--accent)}
.changed .tscroll{margin-top:10px}
.ch-old{margin:10px 0 0;padding:0;list-style:none}.ch-old>li{border-left:3px solid var(--line);padding:4px 0 4px 12px;margin-bottom:10px}
.stale{background:#f7f1e6;border-left:4px solid var(--gold);border-radius:0 6px 6px 0;padding:12px 16px;margin:16px 0 0;font-size:14px}
.loading{padding:60px 0;text-align:center;color:var(--muted)}
.updated-line{margin:34px 0 0;font-size:12.5px;color:var(--muted)}
.steps ul{margin:0 0 .8em;padding-left:1.2em}.steps li li{margin-bottom:4px}
'''
t = t.replace('</style>', css + '</style>', 1) if t.count('</style>') == 1 else t[:t.rindex('</style>')] + css + t[t.rindex('</style>'):]
open(out, 'w', encoding='utf8').write(t)
print(len(t), 'bytes')
