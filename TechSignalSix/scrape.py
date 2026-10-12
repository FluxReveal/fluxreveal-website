#!/usr/bin/env python3
"""
Scrape TechSignalSix weekly radar and generate ready-to-publish X posts.
Outputs posts.json for the static publisher page.
"""

import json
import re
import urllib.request
from html.parser import HTMLParser
from xml.etree import ElementTree as ET
from datetime import datetime, timezone

RSS_URL = "https://techsignalsix.com/feed.xml"
HOME_URL = "https://techsignalsix.com/"


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.skip = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip = True

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip = False

    def handle_data(self, data):
        if not self.skip:
            text = data.strip()
            if text:
                self.parts.append(text)


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "TechSignalSix-Publisher/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_rss(xml_text: str) -> list[dict]:
    root = ET.fromstring(xml_text)
    items = []
    for item in root.findall(".//item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        desc_raw = item.findtext("description") or ""
        # Strip CDATA wrappers if present
        desc = re.sub(r"<!\[CDATA\[|\]\]>", "", desc_raw)
        # Simple HTML strip for description
        parser = TextExtractor()
        parser.feed(desc)
        plain = " ".join(parser.parts)
        # Clean up common prefixes
        plain = re.sub(r"^Open protocols like MCP.+?Traction Score:\s*\d+\s*\([^)]+\)\s*", "", plain)
        plain = re.sub(r"Traction Score:\s*\d+\s*\([^)]+\)\s*", "", plain)
        plain = re.sub(r"Changed this week:\s*", "", plain)
        plain = " ".join(plain.split())[:280]
        # Extract score and status from title or description
        score_match = re.search(r"Traction\s+(\d+)", title + " " + plain)
        score = int(score_match.group(1)) if score_match else None
        status = None
        for s in ("Growing", "Stable", "Declining", "Accelerating"):
            if s in plain or s in title:
                status = s
                break
        items.append({
            "title": title,
            "link": link,
            "description": plain[:500],
            "score": score,
            "status": status,
        })
    return items


def extract_weekly_signal(html: str) -> str:
    """Pull the 'This week’s signal' editorial paragraph."""
    parser = TextExtractor()
    parser.feed(html)
    text = "\n".join(parser.parts)

    # Look for the known editorial paragraph start
    m = re.search(
        r"(Measurement has caught up.+?Attention and adoption are not the same measurement\.?)",
        text,
        re.DOTALL | re.IGNORECASE,
    )
    if m:
        return " ".join(m.group(1).split())

    # Broader fallback
    m = re.search(
        r"This week[’']s signal\s*(.+?)(?:Tech Signal Six editorial|Trending technologies)",
        text,
        re.DOTALL | re.IGNORECASE,
    )
    if m:
        return " ".join(m.group(1).split())[:500]

    return "Weekly radar updated. Follow technology, not the noise."


def generate_posts(themes: list[dict], signal: str, week_label: str) -> list[dict]:
    """Generate 7 posts: Monday main + 6 daily drips."""
    posts = []

    # --- Monday: Main weekly publication ---
    top = themes[:4]
    lines = [f"Weekly Radar · {week_label}", ""]
    for t in top:
        name = t["title"].split("—")[0].strip()
        score = t.get("score") or "?"
        status = t.get("status") or ""
        lines.append(f"{name}: {score} ({status})")
    lines.append("")
    # Shorten signal for post (keep under ~280 chars for the insight part)
    signal_clean = " ".join(signal.split())
    if len(signal_clean) > 260:
        signal_clean = signal_clean[:257].rsplit(" ", 1)[0] + "…"
    lines.append(signal_clean)
    lines.append("")
    lines.append("Full evidence → https://techsignalsix.com")
    monday_text = "\n".join(lines)

    posts.append({
        "day": "Monday",
        "label": "Hovedpublisering",
        "text": monday_text,
        "url": "https://techsignalsix.com",
    })

    # --- Tuesday to Sunday: individual theme drips ---
    day_names = ["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    for i, day in enumerate(day_names):
        theme = themes[i % len(themes)] if themes else {}
        name = theme.get("title", "Theme").split("—")[0].strip()
        score = theme.get("score") or "?"
        status = theme.get("status") or ""
        link = theme.get("link") or "https://techsignalsix.com"
        desc = theme.get("description", "")[:180]

        text = f"{name} — Traction {score} ({status})\n\n{desc}\n\nEvidence → {link}"
        posts.append({
            "day": day,
            "label": "Daglig drypp",
            "text": text,
            "url": link,
        })

    return posts


def main():
    print("Fetching RSS…")
    rss_xml = fetch(RSS_URL)
    themes = parse_rss(rss_xml)
    print(f"Found {len(themes)} themes")

    print("Fetching homepage for weekly signal…")
    home_html = fetch(HOME_URL)
    signal = extract_weekly_signal(home_html)

    # Week label from RSS title or date
    week_label = "2026-W41"
    m = re.search(r"2026-W\d+", home_html)
    if m:
        week_label = m.group(0)

    posts = generate_posts(themes, signal, week_label)

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "week": week_label,
        "source": "https://techsignalsix.com",
        "posts": posts,
    }

    with open("posts.json", "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"Wrote posts.json with {len(posts)} posts")
    print("Monday preview:")
    print(posts[0]["text"][:400])
    print("…")


if __name__ == "__main__":
    main()
