"""Microsoft SQL Server als (nur lesende) Kontaktquelle, z. B. CRM oder Warenwirtschaft.

Die Kontakte werden wie Adressbücher regelmäßig komplett gelesen und lokal
zwischengespeichert, damit die Anrufererkennung ohne Datenbankabfrage auskommt.
"""

import re

from .calendars import CalendarError
from .contact_import import MOBILE_HINT, guess_columns, rows_to_contacts
from .contact_sync import AddressBook, _tag

try:
    import pymssql
except ImportError:
    pymssql = None

MAX_ROWS = 50000


class SqlError(CalendarError):
    pass


def quote_ident(name):
    """dbo.Kunden -> [dbo].[Kunden] (gegen SQL-Injection über Tabellen-/Spaltennamen)."""
    parts = [p.strip().strip("[]") for p in name.split(".") if p.strip()]
    if not parts:
        raise SqlError("Leerer Tabellen- oder Spaltenname")
    return ".".join("[" + p.replace("]", "]]") + "]" for p in parts)


def split_list(text):
    return [c.strip() for c in (text or "").split(",") if c.strip()]


def _error_message(e):
    args = getattr(e, "args", ())
    if len(args) == 1 and isinstance(args[0], tuple):  # Verbindungsfehler: ((code, text),)
        args = args[0]
    code = args[0] if args and isinstance(args[0], int) else None
    raw = args[1] if len(args) > 1 else (args[0] if args else e)
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    text = str(raw)
    # Zuerst den Text prüfen: pymssql liefert nach einem Fehler teils den alten Fehlercode mit
    if "Unable to connect" in text or "Adaptive Server is unavailable" in text or code in (20009, 20002) \
            and "Login failed" not in text:
        return "Server nicht erreichbar – Adresse, Port und Firewall prüfen"
    if "Login failed" in text:
        # SQL Server meldet auch eine unzugängliche Datenbank als Anmeldefehler
        return "Anmeldung fehlgeschlagen – Benutzer, Passwort oder Datenbankname falsch"
    if "Cannot open database" in text:
        return "Datenbank nicht gefunden oder keine Berechtigung"
    if "permission was denied" in text:
        return "Keine Leseberechtigung für diese Tabelle"
    if "Invalid object name" in text:
        return "Tabelle oder Sicht nicht gefunden"
    if "Invalid column name" in text:
        return "Spalte nicht gefunden: " + (re.findall(r"Invalid column name '([^']+)'", text) or ["?"])[0]
    first_line = re.split(r"DB-Lib error|\n", text)[0].strip(" .b'\"")
    return f"SQL-Fehler: {first_line}" if first_line else "SQL-Fehler"


class MsSqlSource:
    def __init__(self, conf, password):
        self.conf = conf
        self.password = password

    # -- Verbindung ------------------------------------------------------------

    def _connect(self):
        if pymssql is None:
            raise SqlError("Python-Modul pymssql fehlt (sudo dnf install python3-pymssql)")
        try:
            return pymssql.connect(
                server=self.conf["host"].strip(),
                port=str(int(self.conf.get("port") or 1433)),
                user=self.conf["user"].strip(),
                password=self.password,
                database=self.conf["database"].strip(),
                login_timeout=10,
                timeout=60,
                charset="UTF-8",
                appname="SIP-Telefon",
            )
        except pymssql.Error as e:
            message = _error_message(e)
            if message == "SQL-Fehler":  # Treiber liefert beim Verbindungsaufbau manchmal keinen Text
                message = "Verbindung fehlgeschlagen – Server, Datenbank und Zugangsdaten prüfen"
            raise SqlError(message) from e

    def _query(self, sql, params=None, limit=MAX_ROWS):
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute(sql, params)
            if cur.description is None:
                raise SqlError("Die Abfrage liefert keine Zeilen (nur SELECT-Abfragen verwenden)")
            headers = [d[0] or f"spalte{i}" for i, d in enumerate(cur.description)]
            rows = cur.fetchmany(limit)
            return headers, rows
        except pymssql.Error as e:
            raise SqlError(_error_message(e)) from e
        finally:
            conn.close()

    # -- Einrichtung -----------------------------------------------------------

    def tables(self):
        _h, rows = self._query(
            "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES "
            "ORDER BY TABLE_SCHEMA, TABLE_NAME")
        return [(f"{schema}.{name}", kind == "VIEW") for schema, name, kind in rows]

    def columns(self, table):
        parts = [p.strip("[]") for p in table.split(".")]
        schema, name = (parts[0], parts[-1]) if len(parts) > 1 else ("dbo", parts[0])
        _h, rows = self._query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s ORDER BY ORDINAL_POSITION", (schema, name))
        return [r[0] for r in rows]

    @staticmethod
    def suggest(columns):
        """Schlägt Name-, Firma- und Telefonspalten anhand der Spaltennamen vor."""
        g = guess_columns(columns)
        if g["name"]:
            name = [columns[g["name"][0]]]
        else:
            name = [columns[i] for key in ("first", "last") for i in g[key][:1]]
        return {
            "name_cols": ", ".join(name),
            "company_col": columns[g["company"][0]] if g["company"] else "",
            "phone_cols": ", ".join(columns[i] for i in g["phone"]),
        }

    def build_query(self):
        conf = self.conf
        if conf.get("mode") == "query":
            return conf.get("query", "").strip()
        if not conf.get("table", "").strip():
            raise SqlError("Bitte eine Tabelle oder Sicht auswählen")
        table = quote_ident(conf["table"])
        select = []
        name_cols = split_list(conf.get("name_cols"))
        if name_cols:
            parts = ", ' ', ".join(quote_ident(c) for c in name_cols)
            expr = f"CONCAT({parts}, '')" if len(name_cols) > 1 else f"CAST({quote_ident(name_cols[0])} AS nvarchar(400))"
            select.append(f"LTRIM(RTRIM({expr})) AS [name]")
        if conf.get("company_col", "").strip():
            select.append(f"{quote_ident(conf['company_col'])} AS [company]")
        phones = split_list(conf.get("phone_cols"))
        if not phones:
            raise SqlError("Bitte mindestens eine Spalte mit Telefonnummern angeben")
        for i, col in enumerate(phones):
            alias = "mobile" if MOBILE_HINT.search(col.lower()) else "phone"
            select.append(f"{quote_ident(col)} AS [{alias} {i + 1}]")
        return f"SELECT TOP {MAX_ROWS} " + ", ".join(select) + f" FROM {table}"

    # -- Abgleich --------------------------------------------------------------

    def fetch(self):
        query = self.build_query()
        if not query:
            raise SqlError("Keine SQL-Abfrage angegeben")
        headers, rows = self._query(query)
        return rows_to_contacts(headers, rows), len(rows)

    def list_books(self):
        name = self.conf.get("name") or f"{self.conf['database']} ({self.conf['host']})"
        return [AddressBook(f"sql:{self.conf['id']}", name, "SQL Server", self)]

    def contacts(self, book):
        contacts, _rows = self.fetch()
        return _tag(contacts, book)
