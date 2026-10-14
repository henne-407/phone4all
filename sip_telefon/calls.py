"""Anrufzustand, wie er aus den baresip-Events abgeleitet wird."""

import time


class Call:
    def __init__(self, call_id, direction, number, name, company=""):
        self.id = call_id
        self.direction = direction  # "in" | "out"
        self.number = number
        self.name = name
        self.company = company
        self.state = "incoming" if direction == "in" else "calling"
        self.created = time.time()
        self.established = None
        self.muted = False
        self.held = False
        self.remote_held = False
        self.reason = ""

    @property
    def title(self):
        return self.name or self.number

    @property
    def duration(self):
        return time.time() - self.established if self.established else 0

    def status_text(self):
        if self.state == "incoming":
            return "Eingehender Anruf"
        if self.state == "calling":
            return "Verbinde …"
        if self.state == "ringing":
            return "Klingelt …"
        if self.state == "established":
            text = format_duration(self.duration)
            if self.held:
                text += " · gehalten"
            elif self.remote_held:
                text += " · Gegenseite hält"
            return text
        return ""


def format_duration(seconds):
    seconds = int(seconds)
    h, rest = divmod(seconds, 3600)
    m, s = divmod(rest, 60)
    return f"{h}:{m:02}:{s:02}" if h else f"{m:02}:{s:02}"
