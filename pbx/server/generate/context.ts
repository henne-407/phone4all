/** Umgebung, für die die Asterisk-Konfiguration erzeugt wird. */

export interface GenContext {
  /** Basis der internen HTTP-Schnittstelle, z. B. http://127.0.0.1:8080/internal */
  apiUrl: string
  dirs: {
    etc: string
    data: string // Daten der Anlage (/data)
    spool: string // Voicemail
    log: string
    lib: string
    run: string
    sounds: string // eigene Ansagen
    moh: string // eigene Wartemusik
    recordings: string
    db: string
    modules: string
    asteriskData: string // mitgelieferte Klänge (/usr/share/asterisk)
  }
  ami: { port: number; secret: string }
  /** Port des HTTP-Servers von Asterisk (WebSocket für die Mobil-App) */
  httpPort: number
  tls: { cert: string; key: string } | null
  banned: string[]
  /** Benutzer, unter dem Asterisk läuft (leer = aktueller Benutzer) */
  runUser: string
  /** Pfad zu msmtp für Voicemail-E-Mails (leer = keine E-Mails) */
  mailer: string
}
