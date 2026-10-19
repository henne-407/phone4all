#!/usr/bin/env bash
# Baut die SIP-Engine für macOS und Windows nach build/engine:
#   baresip (statisch, Audio über PortAudio), pa-devices, Klangdateien, engine.json
#
# macOS:   brew install cmake ninja openssl@3 opus portaudio dylibbundler
# Windows: Git Bash mit MSVC-Umgebung (vcvars64), vcpkg mit
#          openssl opus portaudio getopt für x64-windows, VCPKG_ROOT gesetzt
#
# Unter Linux wird baresip aus der Distribution verwendet.
set -euo pipefail

VERSION="${BARESIP_VERSION:-v4.12.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$ROOT/build/engine-src"
OUT="$ROOT/build/engine"
MODULES="account;menu;ctrl_tcp;g711;libg722;opus;portaudio;auconv;auresamp;stun;turn;ice;srtp;dtls_srtp"
REQUIRED="account menu ctrl_tcp g711 opus portaudio"

case "$(uname -s)" in
  Darwin) OS=mac EXE=baresip ;;
  MINGW* | MSYS* | CYGWIN*) OS=win EXE=baresip.exe ;;
  *) echo "Nur für macOS und Windows – unter Linux baresip aus der Distribution nutzen" >&2; exit 1 ;;
esac

rm -rf "$OUT"
mkdir -p "$WORK" "$OUT/share"
cd "$WORK"
[ -d re ] || git clone --depth 1 -b "$VERSION" https://github.com/baresip/re.git
[ -d baresip ] || git clone --depth 1 -b "$VERSION" https://github.com/baresip/baresip.git
[ -d libg722 ] || git clone --depth 1 https://github.com/sippy/libg722.git

CMAKE=(-G Ninja -DCMAKE_BUILD_TYPE=Release)
if [ "$OS" = mac ]; then
  OPENSSL_ROOT_DIR="$(brew --prefix openssl@3)"
  PA="$(brew --prefix portaudio)"
  export OPENSSL_ROOT_DIR
  CMAKE+=(-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0)
else
  DEPS="$(cygpath -m "${VCPKG_ROOT:-$VCPKG_INSTALLATION_ROOT}/installed/x64-windows")"
  PA_LIB="$(ls "$DEPS"/lib/portaudio*.lib | head -1)"
  CMAKE+=(
    -DOPENSSL_ROOT_DIR="$DEPS"
    -DOPUS_INCLUDE_DIR="$DEPS/include" -DOPUS_LIBRARY="$DEPS/lib/opus.lib"
    -DPORTAUDIO_INCLUDE_DIR="$DEPS/include" -DPORTAUDIO_LIBRARY="$PA_LIB"
  )
fi

# G.722 ohne spandsp
cmake -S libg722 -B libg722/build "${CMAKE[@]}" -DBUILD_SHARED_LIBS=OFF -DCMAKE_INSTALL_PREFIX="$WORK/libg722-install"
cmake --build libg722/build
cmake --install libg722/build
# Nur die statische Bibliothek behalten, damit baresip sie fest einbindet
rm -f "$WORK"/libg722-install/lib/*.dylib "$WORK"/libg722-install/lib/*.so*
if [ "$OS" = win ] && [ -f "$WORK/libg722-install/lib/g722_static.lib" ]; then
  cp "$WORK/libg722-install/lib/g722_static.lib" "$WORK/libg722-install/lib/g722.lib"
fi

# libre: nur statisch, damit baresip keine eigene Bibliothek nachladen muss
cmake -S re -B re/build "${CMAKE[@]}" -DLIBRE_BUILD_SHARED=OFF
cmake --build re/build

BARESIP_EXTRA=()
if [ "$OS" = win ]; then
  # MSVC hat kein getopt.h – ohne HAVE_GETOPT ignoriert baresip alle
  # Startoptionen (auch -f) und liest immer %APPDATA%\.baresip
  BARESIP_EXTRA+=(
    -DCMAKE_REQUIRED_INCLUDES="$DEPS/include"
    -DCMAKE_C_FLAGS="-I$DEPS/include"
    -DCMAKE_EXE_LINKER_FLAGS="$DEPS/lib/getopt.lib"
  )
fi
cmake -S baresip -B baresip/build "${CMAKE[@]}" ${BARESIP_EXTRA[@]+"${BARESIP_EXTRA[@]}"} -DSTATIC=ON -DMODULES="$MODULES" \
  -DLIBG722_HINTS="$WORK/libg722-install" 2>&1 | tee cmake.log
if [ "$OS" = win ] && ! grep -q "getopt.h - found" cmake.log; then
  echo "getopt.h nicht gefunden – baresip würde -f ignorieren" >&2
  exit 1
fi
cmake --build baresip/build

DETECTED="$(grep -o 'MODULES_DETECTED=.*' cmake.log | tail -1 | cut -d= -f2)"
echo "Module: $DETECTED"
for m in $REQUIRED; do
  case ";$DETECTED;" in
    *";$m;"*) ;;
    *) echo "Pflichtmodul fehlt: $m" >&2; exit 1 ;;
  esac
done

cp "baresip/build/$EXE" "$OUT/"
cp baresip/share/*.wav "$OUT/share/"

if [ "$OS" = mac ]; then
  cc -O2 "$ROOT/native/pa-devices.c" -I"$PA/include" -L"$PA/lib" -lportaudio -o "$OUT/pa-devices"
  # Homebrew-Bibliotheken mitliefern und Verweise auf @executable_path/lib umstellen
  # (ohne Eingabe: dylibbundler fragt sonst bei unbekannten Pfaden interaktiv nach)
  dylibbundler -of -cd -b -x "$OUT/baresip" -x "$OUT/pa-devices" -d "$OUT/lib" -p @executable_path/lib/ \
    -s "$(brew --prefix)/lib" < /dev/null
  # Apple Silicon führt nur signierte Programme aus (ad hoc genügt)
  codesign --force --sign - "$OUT"/lib/*.dylib "$OUT/baresip" "$OUT/pa-devices"
else
  # Optionen mit "-" statt "/", damit Git Bash sie nicht als Pfade umschreibt
  # Im Arbeitsordner mit relativen Namen bauen; Git Bash darf an den
  # Optionen nichts umschreiben (MSYS2_ARG_CONV_EXCL)
  cp "$ROOT/native/pa-devices.c" "$WORK/"
  (cd "$WORK" && MSYS2_ARG_CONV_EXCL='*' cl -nologo -O2 pa-devices.c -I"$DEPS/include" "$PA_LIB" -Fepa-devices.exe)
  cp "$WORK/pa-devices.exe" "$OUT/"
  cp "$DEPS"/bin/*.dll "$OUT/"
  cp "$WORK"/libg722-install/bin/*.dll "$OUT/" 2>/dev/null || true
fi

MODULE_JSON="$(echo "$DETECTED" | tr ';' '\n' | sed '/^$/d; s/.*/"&"/' | paste -sd, -)"
cat > "$OUT/engine.json" <<EOF
{
  "binary": "$EXE",
  "modules": [$MODULE_JSON],
  "audio": "portaudio",
  "version": "$VERSION"
}
EOF

# Rauchtest: Startet die Engine mit einer minimalen Konfiguration?
TEST="$WORK/smoke"
mkdir -p "$TEST"
printf 'audio_player portaudio,\naudio_source portaudio,\nmodule g711.so\nmodule portaudio.so\nmodule_app account.so\nmodule_app menu.so\nmodule_app ctrl_tcp.so\nctrl_tcp_listen 127.0.0.1:45999\n' > "$TEST/config"
: > "$TEST/accounts"
: > "$TEST/contacts"
# Mit Zeitlimit starten (macOS hat kein "timeout")
with_timeout() {
  "$@" &
  local pid=$!
  ( sleep 20; kill "$pid" 2>/dev/null ) &
  local guard=$!
  wait "$pid" || true
  kill "$guard" 2>/dev/null || true
}
CONF_DIR="$TEST"
[ "$OS" = win ] && CONF_DIR="$(cygpath -w "$TEST")"   # so übergibt es auch die App
with_timeout "$OUT/$EXE" -f "$CONF_DIR" -t 2 -c > "$TEST/log" 2>&1
cat "$TEST/log"
grep -q "baresip is ready" "$TEST/log"
# Die eigene Konfiguration muss gelesen worden sein (keine Vorlage, PortAudio geladen)
if grep -q "creating config template" "$TEST/log"; then
  echo "baresip hat die Konfiguration in $CONF_DIR nicht gefunden" >&2
  exit 1
fi
grep -q "portaudio" "$TEST/log" || { echo "PortAudio-Modul nicht geladen" >&2; exit 1; }
with_timeout "$OUT/pa-devices"

echo "Fertig: $OUT"
ls -la "$OUT"
