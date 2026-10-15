#!/usr/bin/env python3
"""One-time converter: hand-written country panels (monitor-8-countries.html) -> data files.

Reads the bundled 8-country monitor, and for each country writes
  public/monitor/data/<code>.json   (same shape the daily updater maintains)
so the page can render from data instead of hand-written HTML.
Run:  python3 scripts/tools/extract_panels.py <monitor-8-countries.html> <out-data-dir>
"""
import html, json, re, sys
from html.parser import HTMLParser

VOID = {"br", "img", "input", "hr", "meta", "link"}


class Node:
    def __init__(self, tag, attrs, parent):
        self.tag, self.attrs, self.parent, self.kids = tag, dict(attrs), parent, []

    @property
    def cls(self):
        return self.attrs.get("class", "").split()

    def has(self, c):
        return c in self.cls

    def walk(self):
        for k in self.kids:
            if isinstance(k, Node):
                yield k
                yield from k.walk()

    def find(self, tag=None, cls=None, id=None):
        return next(iter(self.findall(tag, cls, id)), None)

    def findall(self, tag=None, cls=None, id=None):
        return [n for n in self.walk()
                if (tag is None or n.tag == tag) and (cls is None or n.has(cls)) and (id is None or n.attrs.get("id") == id)]

    def children(self, tag=None, cls=None):
        return [k for k in self.kids if isinstance(k, Node) and (tag is None or k.tag == tag) and (cls is None or k.has(cls))]

    def text(self):
        out = []
        for k in self.kids:
            out.append(k if isinstance(k, str) else (" " if k.tag == "br" else k.text()))
        return re.sub(r"\s+", " ", html.unescape("".join(out))).strip()

    def inner(self, keep=("strong", "em", "a", "br", "b", "i")):
        """Inline HTML (entities kept as written), only whitelisted tags."""
        out = []
        for k in self.kids:
            if isinstance(k, str):
                out.append(k)
            elif k.tag in keep:
                if k.tag == "a":
                    out.append('<a href="%s">%s</a>' % (k.attrs.get("href", ""), k.inner(keep)))
                elif k.tag == "br":
                    out.append("<br>")
                else:
                    out.append("<%s>%s</%s>" % (k.tag, k.inner(keep), k.tag))
            else:
                out.append(k.inner(keep))
        return re.sub(r"\s+", " ", "".join(out)).strip()


class Builder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.root = Node("root", [], None)
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        n = Node(tag, [(k, v or "") for k, v in attrs], self.cur)
        self.cur.kids.append(n)
        if tag not in VOID:
            self.cur = n

    def handle_startendtag(self, tag, attrs):
        self.cur.kids.append(Node(tag, [(k, v or "") for k, v in attrs], self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not None and n.tag != tag:
            n = n.parent
        if n is not None and n.parent is not None:
            self.cur = n.parent

    def handle_data(self, d):
        self.cur.kids.append(d)

    def handle_entityref(self, name):
        self.cur.kids.append("&%s;" % name)

    def handle_charref(self, name):
        self.cur.kids.append("&#%s;" % name)


def parse(s):
    b = Builder()
    b.feed(s)
    return b.root


def plain_html(node, keep=("strong", "em", "a", "br")):
    return node.inner(keep)


def para_html(parent):
    """Paragraphs/lists of a step -> html string, blocks separated by a blank line."""
    blocks = []
    for k in parent.kids:
        if not isinstance(k, Node):
            continue
        if k.tag == "p":
            blocks.append(k.inner())
        elif k.tag in ("ul", "ol"):
            blocks.append("<ul>%s</ul>" % "".join("<li>%s</li>" % li.inner() for li in k.children("li")))
    return "\n\n".join(blocks)


def kind_of(li):
    for c in ("up", "down", "now"):
        if li.has(c):
            return c
    return "neutral"


def extract_panel(code, panel):
    P = lambda sid: panel.find(id=f"{code}-{sid}")
    d = {"code": code}
    # ---- header
    kick = panel.find(cls="panel-kicker")
    d["bank_line"] = kick.find("span").text() if kick else ""
    intro = panel.find(cls="intro")
    eyebrow = intro.find(cls="eyebrow").text()
    title = intro.find(cls="country-title").text()
    lede = intro.find(cls="intro-lede").text()
    stats = [(s.find("span").text(), s.find("b").text()) for s in intro.find(cls="intro-stats").children("div")]
    cn = intro.find(cls="currency-note")
    d["country"] = {"currency_note": cn.inner() if cn else "", "eyebrow": eyebrow, "title": title, "lede": lede, "rate_label": stats[2][0] if len(stats) > 2 else "Current rate",
                    "kicker": d["bank_line"]}
    # ---- KPIs (kept as written; the updater recomputes values from indicators when it can)
    d["kpis_seed"] = []
    for k in panel.findall(cls="kpi"):
        note = k.find(cls="k-note")
        d["kpis_seed"].append({"label": k.find(cls="k-label").text(), "value": k.find(cls="k-val").text(), "note_html": note.inner()})
    # ---- verdict
    v = P("verdict")
    meeting = {}
    for dl in v.find(cls="meeting").findall("dl"):
        kids = [x for x in dl.kids if isinstance(x, Node)]
        for i in range(0, len(kids) - 1, 2):
            meeting[kids[i].text()] = kids[i + 1].inner()
    cal = v.find(cls="meeting").find("p", cls="small")
    cal_a = cal.find("a") if cal else None
    bars = []
    for li in v.find(cls="bars").findall("li"):
        sp = li.find(cls="bar-label").findall("span")
        bars.append((sp[0].text(), sp[1].text()))
    kind = lambda s: "hold" if re.search(r"hold", s, re.I) else "raise" if re.search(r"raise|rise|hike|up", s, re.I) else "cut"
    probs = {kind(b[0]): int(re.search(r"(\d+)", b[1]).group(1)) for b in bars}
    assert sorted(probs) == ["cut", "hold", "raise"], (code, bars)
    conf_p = [p for p in v.find(cls="vgrid").findall("p") if p.find(cls="conf")][0]
    conf_note = conf_p.parent.children("p", "small")
    most = max(probs, key=probs.get)
    ver = {
        "most_likely": most,
        "headline": v.find(cls="big").text(),
        "sub": v.find(cls="big-sub").inner(),
        "probabilities": probs,
        "labels": {kind(b[0]): b[0] for b in bars},
        "confidence": v.find(cls="conf").text(),
        "confidence_note": conf_note[0].inner() if conf_note else "",
        "short_version": v.find(cls="plain").find("p").inner(),
        "bars_aria": v.find(cls="bars").attrs.get("aria-label", ""),
    }
    d["meeting_text"] = {"who": meeting.get("Who decides", ""), "meeting": meeting.get("Meeting", ""), "decision": meeting.get("Decision", ""),
                         "after": meeting.get("Meeting after", ""), "calendar_label": cal_a.text() if cal_a else "Official meeting calendar",
                         "calendar_url": cal_a.attrs.get("href", "") if cal_a else "", "other": {k: v_ for k, v_ in meeting.items() if k not in ("Who decides", "Meeting", "Decision", "Meeting after")}}
    # ---- why steps (one step may hold a for/against scale)
    steps = []
    for li in v.find("ol", cls="steps").children("li"):
        st = {"title": li.find("h4").text()}
        sc = li.find(cls="scale")
        if sc:
            f, a = sc.find(cls="for"), sc.find(cls="against")
            st["scale"] = {"left_title": f.find("h5").text(), "left": [x.inner() for x in f.findall("li")],
                           "right_title": a.find("h5").text(), "right": [x.inner() for x in a.findall("li")]}
            after = [k for k in li.kids if isinstance(k, Node) and k.tag == "p"]
            st["html"] = "\n\n".join(p.inner() for p in after)
        else:
            st["html"] = para_html(li)
        steps.append(st)
    d["why_steps"] = steps
    d["verdict"] = ver
    d["titles"] = {sid: P(sid).find(cls="sec-head").find("h2").text() for sid in ("verdict", "story", "choices", "change", "report", "numbers", "live", "gaps")}
    n = v.find("p", cls="note")
    d["verdict_note"] = n.inner() if n else ""
    d["why_title"] = v.findall("div", cls="card")[0].parent.findall("h3")[-1].text() if False else [h for h in v.findall("h3") if "step" in h.text().lower()][0].text()
    d["rough_title"] = [h for h in v.find(cls="vgrid").findall("h3")][0].text()
    # ---- timeline
    s = P("story")
    d["story_intro"] = s.find(cls="sec-intro").inner()
    tl = []
    for li in s.find("ol", cls="timeline").children("li"):
        box = li.find(cls="tbox")
        item = {"date_label": box.find(cls="tdate").text(), "title": box.find(cls="ttitle").text(), "kind": kind_of(li)}
        keys = {"What happened": "what", "Why": "why", "What it meant for people": "people"}
        for cell in box.find(cls="tgrid").children("div"):
            h = cell.find("h5").text()
            p = cell.find("p")
            if h in keys:
                item[keys[h]] = p.inner()
            else:
                item["sources"] = [{"label": a.text(), "url": a.attrs.get("href", "")} for a in p.findall("a")]
        b = box.find(cls="because")
        if b:
            item["because"] = b.inner().replace("<strong>Because of this →</strong>", "").replace("<b>Because of this →</b>", "").strip()
            item["because"] = re.sub(r"^<b>Because of this →</b>\s*", "", item["because"])
        tl.append(item)
    d["timeline"] = tl
    # ---- choices
    c = P("choices")
    d["choices_intro"] = c.find(cls="sec-intro").inner()
    choices = []
    for art in c.findall("article", cls="choice"):
        title = art.find("h3").text()
        opt = "hold" if re.search(r"\bhold\b", title, re.I) else "raise" if re.search(r"\b(raise|hike|rise)\b", title, re.I) else "cut"
        body = art.find(cls="choice-body")
        meaning = [p for p in body.children("p")][0].inner()
        meaning = re.sub(r"^<strong>What it means:</strong>\s*", "", meaning)
        life = art.find(cls="life").inner()
        life = re.sub(r"^<b>In everyday life:</b>\s*", "", life)
        choices.append({"option": opt, "rank_label": art.find(cls="rank").text(), "title": re.sub(r"^\d+\.\s*", "", title), "meaning": meaning,
                        "for": [x.inner() for x in art.find(cls="yes").findall("li")], "against": [x.inner() for x in art.find(cls="no").findall("li")], "everyday": life})
    d["choices"] = choices
    # ---- what could change
    ch = P("change")
    card = ch.find(cls="card")
    pl = card.find(cls="plain")
    change = {"lead": card.find(cls="sec-intro").inner() if card.find(cls="sec-intro") else "", "intro_title": pl.find(cls="pl").text(), "intro": pl.find("p").inner()}
    rows = []
    change["head"] = [th.text() for th in card.find("thead").findall("th")]
    for tr in card.find("tbody").findall("tr"):
        td = tr.children("td")
        when = td[0]
        parts = when.inner().split("<br>")
        a = td[1].find("a")
        pill = td[2].text()
        if pill == "Decision":
            change["decision_row"] = {"name": a.text() if a else td[1].text(), "publisher": td[1].text().split("·")[-1].strip(), "what": td[3].inner(), "url": a.attrs.get("href", "") if a else ""}
        rows.append({"when": parts[0].strip(), "time": parts[1].strip() if len(parts) > 1 else "", "name": a.text() if a else td[1].text(),
                     "url": a.attrs.get("href", "") if a else "", "publisher": td[1].text().split("·")[-1].strip() if "·" in td[1].text() else "",
                     "timing": pill, "what": td[3].inner(), "why": td[4].inner(), "trigger": td[5].inner()})
    change["table"] = rows
    change["caption"] = card.find("caption").text() if card.find("caption") else ""
    oth = [h for h in card.findall("h3")]
    change["other_title"] = oth[-1].text() if oth else "Other things that could move our view"
    change["other"] = [x.inner() for x in card.find("ul", cls="clean").findall("li")]
    d["change"] = change
    # ---- report card
    r = P("report")
    d["report_intro"] = r.find(cls="sec-intro").inner()
    rc = []
    for art in r.findall("article", cls="grade"):
        g = "red" if art.has("g-red") else "amber" if art.has("g-amber") else "green"
        dl = art.find("dl")
        kids = [x for x in dl.kids if isinstance(x, Node)]
        vals = [kids[i + 1].inner() for i in range(0, len(kids) - 1, 2)]
        labels = [kids[i].text() for i in range(0, len(kids) - 1, 2)]
        rc.append({"area": art.find("h3").text(), "grade": g, "one": art.find(cls="one").inner(), "look": vals[0], "why": vals[1], "change": vals[2], "matters": vals[3],
                   "change_label": labels[2]})
    d["report_card"] = rc
    # ---- gaps
    gp = P("gaps")
    d["gaps_intro"] = gp.find("p").inner()
    d["gaps"] = [li.inner() for li in gp.find("ul", cls="gaps").findall("li")]
    # ---- numbers/live intro texts
    d["numbers_intro"] = P("numbers").find(cls="sec-intro").inner()
    live = P("live")
    cardl = live.find(cls="card")
    form = cardl.find("form")
    before, after, seen_form = [], [], False
    for k in cardl.kids:
        if not isinstance(k, Node):
            continue
        if k is form:
            seen_form = True
        elif k.tag == "p":
            (after if seen_form else before).append({"cls": " ".join(k.cls), "html": k.inner(), "style": k.attrs.get("style", "")})
    d["live_before"], d["live_after"] = before, after
    d["live_kind"] = cardl.find(cls="kind").text()
    d["live_paras"] = []
    d["live_caption"] = live.find("caption").text()
    d["live_snapshot_col"] = live.find("thead").findall("th")[-1].text()
    return d


def main(src, outdir):
    t = open(src, encoding="utf8").read()
    root = parse(t)
    # DATA object (numbers tables + live series)
    m = re.search(r"var DATA = (\{.*?\});\n", t, re.S)
    DATA = json.loads(m.group(1))
    overview = {}
    for card in root.findall("article", cls="cb-card"):
        a = card.find(cls="cb-open")
        code = a.attrs.get("data-country")
        top = card.find(cls="cb-top")
        rate = card.find(cls="cb-rate")
        call = card.find(cls="cb-call")
        overview[code] = {
            "short": top.find(cls="cb-code").text(), "country": top.find("b").text(), "bank": top.find("small").text(),
            "rate": rate.find("b").text(), "last_move": rate.find("small").text(), "card_why": card.find(cls="cb-why").inner(),
            "mini": {x.find("dt").text().lower(): [x.find("dd").text(), x.find("small").text()] for x in card.find(cls="cb-mini").children("div")},
            "confidence_card": card.find(cls="conf").text(),
            "abbrev": re.sub(r"^Open the full (\S+) monitor.*$", r"\1", a.text()),
        }
    ovp = root.find(id="overview")
    ov_intro = ovp.find(cls="sec-intro")
    overview_para = re.sub(r"\s*Forecast · our judgement\s*$", "", ov_intro.text()).strip()
    for k in list(overview.values()):
        pass
    panels = {}
    for p in root.findall("div", cls="cpanel"):
        panels[p.attrs["data-country"]] = p
    import os
    os.makedirs(outdir, exist_ok=True)
    for code, panel in panels.items():
        d = extract_panel(code, panel)
        d["overview"] = overview[code]
        d["overview_paragraph"] = overview_para
        d["data"] = DATA[code]
        json.dump(d, open(os.path.join(outdir, f"{code}.extract.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
        print(code, "steps", len(d["why_steps"]), "timeline", len(d["timeline"]), "choices", len(d["choices"]), "rows", len(d["change"]["table"]),
              "grades", len(d["report_card"]), "gaps", len(d["gaps"]), "groups", len(d["data"]["G"]))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
