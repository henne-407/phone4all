#!/usr/bin/env bash
# Baut die SIP-Engine für macOS und Windows nach build/engine:
#   baresip (statisch, Audio über PortAudio), pa-devices, Klangdateien, engine.json
#
# macOS:   brew install cmake ninja openssl@3 opus portaudio dylibbundler
# Windows: Git Bash mit MSVC-Umgebung (vcvars64), vcpkg mit
#          openssl opus portaudio für x64-windows, VCPKG_ROOT gesetzt
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

# libre: nur statisch, damit baresip keine eigene Bibliothek nachladen muss
cmake -S re -B re/build "${CMAKE[@]}" -DLIBRE_BUILD_SHARED=OFF
cmake --build re/build

cmake -S baresip -B baresip/build "${CMAKE[@]}" -DSTATIC=ON -DMODULES="$MODULES" \
  -DLIBG722_HINTS="$WORK/libg722-install" | tee cmake.log
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
  dylibbundler -of -cd -b -x "$OUT/baresip" -x "$OUT/pa-devices" -d "$OUT/lib" -p @executable_path/lib/
  # Apple Silicon führt nur signierte Programme aus (ad hoc genügt)
  codesign --force --sign - "$OUT"/lib/*.dylib "$OUT/baresip" "$OUT/pa-devices"
else
  cl //nologo //O2 "$(cygpath -w "$ROOT/native/pa-devices.c")" //I"$DEPS/include" "$PA_LIB" \
    //Fe"$(cygpath -w "$OUT/pa-devices.exe")" //Fo"$(cygpath -w "$WORK/pa-devices.obj")"
  cp "$DEPS"/bin/*.dll "$OUT/"
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
printf 'audio_player portaudio,\naudio_source portaudio,\nmodule g711.so\nmodule_app account.so\nmodule_app menu.so\nmodule_app ctrl_tcp.so\nctrl_tcp_listen 127.0.0.1:45999\n' > "$TEST/config"
: > "$TEST/accounts"
: > "$TEST/contacts"
"$OUT/$EXE" -f "$TEST" -t 2 -c | tee "$TEST/log"
grep -q "baresip is ready" "$TEST/log"
"$OUT/pa-devices" || true

echo "Fertig: $OUT"
ls -la "$OUT"
