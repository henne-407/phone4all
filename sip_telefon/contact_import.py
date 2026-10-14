"""Kontakte aus vCard- und CSV-Dateien lesen und mit dem Telefonbuch zusammenführen."""

import csv
import io
import quopri
import re
import uuid

from .store import contact_numbers, numbers_match

# -- vCard ------------------------------------------------------------------------


def _unfold(text):
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Quoted-Printable-Soft-Umbrüche (vCard 2.1) und gefaltete Zeilen zusammenführen
    text = re.sub(r"=\n", "", text)
    return re.sub(r"\n[ \t]", "", text)


def _unescape(value):
    return re.sub(r"\\(.)", lambda m: "\n" if m.group(1) in "nN" else m.group(1), value)


def _split(value, sep=";"):
    """Trennt an `sep`, aber nicht an maskierten Zeichen."""
    return [_unescape(p) for p in re.split(r"(?<!\\)" + re.escape(sep), value)]


def _decode(value, params):
    encoding = params.get("ENCODING", "").upper()
    charset = params.get("CHARSET", "utf-8")
    if encoding in ("QUOTED-PRINTABLE", "QP"):
        try:
            return quopri.decodestring(value.encode("latin-1", "replace")).decode(charset, "replace")
        except LookupError:
            return quopri.decodestring(value.encode("latin-1", "replace")).decode("utf-8", "replace")
    return value


def _params(raw):
    params, types = {}, set()
    for p in raw:
        key, eq, val = p.partition("=")
        if not eq:  # vCard 2.1: TEL;CELL;VOICE:…
            types.add(key.upper())
            continue
        key = key.upper()
        if key == "TYPE":
            types.update(t.strip('"').upper() for t in val.split(","))
        else:
            params[key] = val.strip('"')
    return params, types


def parse_vcards(text):
    contacts, cur = [], None
    for line in _unfold(text).split("\n"):
        if not line.strip():
            continue
        head, sep, value = line.partition(":")
        if not sep:
            continue
        prop, *raw_params = head.split(";")
        prop = prop.rsplit(".", 1)[-1].upper()  # "item1.TEL" -> "TEL"
        if prop == "BEGIN" and value.strip().upper() == "VCARD":
            cur = {"fn": "", "n": "", "org": "", "tels": []}
            continue
        if cur is None:
            continue
        if prop == "END" and value.strip().upper() == "VCARD":
            contact = _finish_vcard(cur)
            if contact:
                contacts.append(contact)
            cur = None
            continue
        params, types = _params(raw_params)
        value = _decode(value, params)
        if prop == "FN":
            cur["fn"] = _unescape(value).strip()
        elif prop == "N":
            parts = _split(value) + [""] * 5
            family, given, middle, prefix = parts[0], parts[1], parts[2], parts[3]
            cur["n"] = " ".join(p for p in (prefix, given, middle, family) if p.strip()).strip()
        elif prop == "ORG":
            cur["org"] = _split(value)[0].strip()
        elif prop == "TEL":
            number = re.sub(r"^tel:", "", _unescape(value).strip(), flags=re.I)
            if number and "FAX" not in types:
                cur["tels"].append((types, number))
    return contacts


def _finish_vcard(cur):
    mobile = [n for t, n in cur["tels"] if t & {"CELL", "MOBILE", "IPHONE"}]
    other = [n for t, n in cur["tels"] if not t & {"CELL", "MOBILE", "IPHONE"}]
    # Bevorzugte Nummer zuerst
    other.sort(key=lambda n: 0 if any("PREF" in t for t, num in cur["tels"] if num == n) else 1)
    return _contact(cur["fn"] or cur["n"], cur["org"], other, mobile)


def _contact(name, company, phones, mobiles):
    phones = _dedupe(phones)
    mobiles = _dedupe(mobiles)
    if not phones and not mobiles:
        return None
    phone = phones.pop(0) if phones else ""
    mobile = mobiles.pop(0) if mobiles else ""
    name = (name or company or phone or mobile).strip()
    return {"name": name, "phone": phone, "mobile": mobile, "company": (company or "").strip(),
            "other": phones + mobiles}


def _dedupe(numbers):
    result = []
    for n in numbers:
        n = n.strip()
        if n and not any(numbers_match(n, r) for r in result):
            result.append(n)
    return result


# -- CSV --------------------------------------------------------------------------

NAME_COLS = re.compile(r"^(name|name1|display ?name|anzeigename|full ?name|vollständiger name|kontakt|"
                       r"kontaktname|ansprechpartner|kurzname|bezeichnung)$")
FIRST_COLS = re.compile(r"^(first ?name|given ?name|vorname)$")
MIDDLE_COLS = re.compile(r"^(middle ?name|additional ?name|weitere vornamen|zweiter vorname)$")
LAST_COLS = re.compile(r"^(last ?name|family ?name|surname|nachname)$")
COMPANY_COLS = re.compile(r"^(company|firma|firmenname|organi[sz]ation( 1)?( - )?( ?name)?|unternehmen|"
                          r"kunde|kundenname|name2)$")
PHONE_COLS = re.compile(r"phone|telefon|(^|[^a-z])tel($|[^a-z]|nr)|rufnummer|durchwahl|handy|mobil|mobile|cell")
MOBILE_HINT = re.compile(r"mobil|mobile|handy|cell")


def _read_text(data):
    for enc in ("utf-8-sig", "utf-16", "cp1252"):
        try:
            text = data.decode(enc)
            if "\x00" not in text:
                return text
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def parse_csv(text):
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    rows = [r for r in reader if any(cell.strip() for cell in r)]
    if len(rows) < 2:
        return [], 0
    return rows_to_contacts(rows[0], rows[1:]), len(rows) - 1


def guess_columns(headers):
    """Ordnet Spaltennamen den Kontaktfeldern zu (für CSV und Datenbanktabellen)."""
    headers = [str(h).strip().lower() for h in headers]

    def cols(pattern):
        return [i for i, h in enumerate(headers) if pattern.search(h)]

    company_c = cols(COMPANY_COLS)
    type_cols, phone_c = {}, []
    for i, h in enumerate(headers):
        # Google: "Phone 1 - Type"/"Phone 1 - Label" + "Phone 1 - Value"
        m = re.match(r"(.*?)\s*-\s*(type|label|typ|bezeichnung)$", h)
        if m:
            type_cols[m.group(1)] = i
        elif PHONE_COLS.search(h) and "fax" not in h and i not in company_c:
            phone_c.append(i)
    return {
        "headers": headers,
        "name": cols(NAME_COLS),
        "first": cols(FIRST_COLS),
        "middle": cols(MIDDLE_COLS),
        "last": cols(LAST_COLS),
        "company": company_c,
        "phone": phone_c,
        "types": type_cols,
    }


def rows_to_contacts(headers, rows):
    """Tabellenzeilen (Listen von Werten) mit Kopfzeile -> Kontakte."""
    g = guess_columns(headers)
    contacts = []
    for row in rows:
        row = ["" if v is None else str(v) for v in row]
        row += [""] * (len(g["headers"]) - len(row))

        def first(indices):
            return next((row[i].strip() for i in indices if row[i].strip()), "")

        name = first(g["name"]) or " ".join(
            p for p in (first(g["first"]), first(g["middle"]), first(g["last"])) if p)
        phones, mobiles = [], []
        for i in g["phone"]:
            header = g["headers"][i]
            base = re.sub(r"\s*-\s*(value|wert)$", "", header)
            kind = header
            if base in g["types"]:
                kind = row[g["types"][base]].lower()
                if "fax" in kind:
                    continue
            for number in re.split(r"\s*:::\s*", row[i]):
                if number.strip():
                    (mobiles if MOBILE_HINT.search(kind) else phones).append(number.strip())
        contact = _contact(name, first(g["company"]), phones, mobiles)
        if contact:
            contacts.append(contact)
    return contacts


def parse_file(path):
    """Liest eine .vcf- oder .csv-Datei. Gibt (Kontakte, Anzahl ohne Nummer) zurück."""
    with open(path, "rb") as f:
        data = f.read()
    text = _read_text(data)
    if "BEGIN:VCARD" in text.upper():
        total = len(re.findall(r"^BEGIN:VCARD", text, re.M | re.I))
        contacts = parse_vcards(text)
    else:
        contacts, total = parse_csv(text)
    return contacts, max(0, total - len(contacts))


# -- Zusammenführen ---------------------------------------------------------------


def merge_into(contacts, imported):
    """Führt `imported` in die Liste `contacts` ein (in place).

    Dubletten (gleiche Nummer oder gleicher Name) werden ergänzt, nie überschrieben.
    Gibt (neu, ergänzt, unverändert) zurück.
    """
    added = merged = unchanged = 0
    for new in imported:
        numbers = contact_numbers(new)
        existing = next((c for c in contacts
                         if any(numbers_match(a, b) for a in contact_numbers(c) for b in numbers)), None)
        if existing is None:
            name = new["name"].casefold()
            existing = next((c for c in contacts if c["name"].casefold() == name), None)
        if existing is None:
            contacts.append({**new, "id": uuid.uuid4().hex})
            added += 1
            continue

        changed = False
        if not existing.get("company") and new.get("company"):
            existing["company"] = new["company"]
            changed = True
        for number in numbers:
            if any(numbers_match(number, n) for n in contact_numbers(existing)):
                continue
            is_mobile = number == new.get("mobile")
            if is_mobile and not existing.get("mobile"):
                existing["mobile"] = number
            elif not is_mobile and not existing.get("phone"):
                existing["phone"] = number
            else:
                existing.setdefault("other", []).append(number)
            changed = True
        if changed:
            merged += 1
        else:
            unchanged += 1
    return added, merged, unchanged
