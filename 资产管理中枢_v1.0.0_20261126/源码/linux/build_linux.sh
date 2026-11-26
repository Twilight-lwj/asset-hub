#!/usr/bin/env bash
# 资产管理中枢 1.0.0 — Linux 免安装分发包构建（只发 AppImage）
# 本版壳零改动（VERSION 只随页面走）：端口、心跳、平板竖屏留白注入均不改。
# 流程：PyInstaller --onefile + 静态 runtime + mksquashfs。
#
# 做法（沿用既有 Linux 通用壳约定）：
#   · PyInstaller --onefile 把 ledger_app.py + 页面 + 图标打成一个可执行文件
#   · AppImage = 静态 runtime-x86_64 + mksquashfs(AppDir)，双击即用、无需安装/无需 libfuse2
#   · 中间目录一律 mktemp -d，不 rm -rf 目录树
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$(cd "$HERE/.." && pwd)"
ROOT="$(cd "$SRC/.." && pwd)"
VER=1.0.0
APP=amhub
NAME=资产管理中枢
# 解释器：优先用环境变量 PY；否则探测常见托管环境，最后落到 PATH 里的 python3
if [ -z "${PY:-}" ]; then
    for _c in "${HOME}/.workbuddy/binaries/python/envs/default/bin/python" \
              "${HOME}/.local/share/workbuddy/binaries/python/envs/default/bin/python"; do
        if [ -x "$_c" ]; then PY="$_c"; break; fi
    done
    [ -n "${PY:-}" ] || PY="$(command -v python3)"
fi
[ -n "${PY:-}" ] || { echo "找不到 python3：请用 PY=/path/to/python3 指定"; exit 1; }
DIST="${DIST:-$ROOT}"   # 成品与源码同目录，.gitignore 已排除 *.AppImage
PAGE="$SRC/资产管理中枢_浏览器版_v${VER}.html"

: "${HOME:?HOME 未设置，无法定位用户目录}"
export XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
mkdir -p "$DIST"

[ -s "$PAGE" ] || { echo "缺少成品页：$PAGE（先跑页面构建脚本）"; exit 1; }
[ -s "$HERE/ledger.png" ] || { echo "缺少图标 ledger.png（先跑 make_linux_icon.py）"; exit 1; }

echo "[1/3] PyInstaller 打单文件可执行 ..."
mkdir -p "$ROOT/build/.work"
WORK=$(mktemp -d "$ROOT/build/.work/XXXXXX")
export PYINSTALLER_CONFIG_DIR="$WORK/pyicfg"
# 页面/图标用 ASCII 名嵌入，避免中文文件名在打包链路上的编码差异
cp "$PAGE" "$WORK/index.html"
cp "$HERE/ledger.png" "$WORK/ledger.png"
cd "$HERE"
"$PY" -m PyInstaller \
  --onefile --noconfirm --strip \
  --name "$APP" \
  --distpath "$WORK/dist" --workpath "$WORK/build" --specpath "$WORK" \
  --add-data "$WORK/index.html:." \
  --add-data "$WORK/ledger.png:." \
  --exclude-module tkinter \
  --exclude-module unittest \
  --exclude-module pydoc \
  --exclude-module distutils \
  ledger_app.py > "$WORK/pyi.log" 2>&1 || { tail -40 "$WORK/pyi.log"; exit 1; }
[ -s "$WORK/dist/$APP" ] || { echo "PyInstaller 没有产出可执行文件"; exit 1; }
# 单文件可执行是中间物，留在临时目录，只有 AppImage 落盘
cp -f "$WORK/dist/$APP" "$WORK/$APP"
chmod +x "$WORK/$APP"
echo "      -> 单文件可执行 $(du -h "$WORK/$APP" | cut -f1)（中间物，不落盘）"

echo "[2/3] AppDir + mksquashfs ..."
AIT=$(mktemp -d)
APPDIR="$AIT/AppDir"
mkdir -p "$APPDIR/usr/bin"
cp "$WORK/$APP" "$APPDIR/usr/bin/$APP"
cp "$HERE/ledger.png" "$APPDIR/$APP.png"
cp "$HERE/ledger.png" "$APPDIR/.DirIcon"
cat > "$APPDIR/$APP.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=AmHub
Name[zh_CN]=资产管理中枢
GenericName=AmHub
Comment=Local-first expense ledger with optional WebDAV backup
Comment[zh_CN]=本地账目管理：流水 / 账户余额 / 分类统计，可选坚果云 WebDAV 备份
Exec=$APP
Icon=$APP
Terminal=false
Categories=Office;Finance;
Keywords=ledger;expense;bills;记账;账单;资产;
StartupWMClass=$APP
EOF
cat > "$APPDIR/AppRun" <<'EOF'
#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/bin/amhub" "$@"
EOF
chmod +x "$APPDIR/AppRun"

RT="$HERE/runtime-x86_64"
[ -s "$RT" ] || { echo "缺少 AppImage runtime：$RT"; exit 1; }
cp "$RT" "$AIT/runtime"
mksquashfs "$APPDIR" "$AIT/app.squashfs" -root-owned -noappend -mkfs-time 0 \
  -comp zstd -Xcompression-level 19 -b 262144 >/dev/null
cat "$AIT/runtime" "$AIT/app.squashfs" > "$AIT/out.AppImage"
# 先写临时名再 rename：挂着 fuse 时直接写会 Text file busy
mv -f "$AIT/out.AppImage" "$DIST/${NAME}_Linux免安装包_v${VER}.AppImage"
chmod +x "$DIST/${NAME}_Linux免安装包_v${VER}.AppImage"
echo "      -> $DIST/${NAME}_Linux免安装包_v${VER}.AppImage  $(du -h "$DIST/${NAME}_Linux免安装包_v${VER}.AppImage" | cut -f1)"

echo "[3/3] 校验 ..."
"$WORK/$APP" --version
APPIMAGE_EXTRACT_AND_RUN=1 "$DIST/${NAME}_Linux免安装包_v${VER}.AppImage" --version
ls -lh "$DIST" | grep -E "AppImage" | sed 's/^/  /'
echo "完成。"
