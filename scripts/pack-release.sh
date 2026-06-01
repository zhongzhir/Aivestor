#!/bin/bash
# 打包面向用户的部署发布包（不含源代码 / 开发文件）
# 产物：release/aivestor-<version>.tar.gz
#
# 上传到阿里云 OSS（人工执行）：
#   ossutil cp release/aivestor-latest.tar.gz oss://aivestor-releases/aivestor-latest.tar.gz

set -e

VERSION="${1:-latest}"
OUT_DIR="release"
STAGE="$OUT_DIR/aivestor"

rm -rf "$STAGE"
mkdir -p "$STAGE/docker"

# 仅包含运行所需文件
cp docker-compose.yml          "$STAGE/"
cp .env.docker.example         "$STAGE/"
cp setup.sh                    "$STAGE/"
cp setup.bat                   "$STAGE/"
cp INSTALL.md                  "$STAGE/"
cp DEPLOY.md                   "$STAGE/" 2>/dev/null || true
cp docker/init.sql             "$STAGE/docker/"
cp docker/nginx.conf           "$STAGE/docker/"
mkdir -p "$STAGE/docker/ssl"
touch "$STAGE/docker/ssl/.gitkeep"

# 注意：发布包不含 Dockerfile 和 src/。
# 用户改为从 Docker Hub 拉预构建镜像。docker-compose.yml 中的 build 段
# 在发布包模式下需替换为 image 段。这里生成发布版的 compose 文件。
sed -E \
  -e 's|^    build:.*$|    image: zhongzhir/aivestor:'$VERSION'|' \
  -e '/^      context:/d' \
  -e '/^      dockerfile:/d' \
  docker-compose.yml > "$STAGE/docker-compose.yml"

(cd "$OUT_DIR" && tar czf "aivestor-$VERSION.tar.gz" aivestor && rm -rf aivestor)

echo ""
echo "✅ 发布包已生成: $OUT_DIR/aivestor-$VERSION.tar.gz"
echo ""
echo "下一步（人工）："
echo "  1) docker build -t zhongzhir/aivestor:$VERSION ."
echo "  2) docker push zhongzhir/aivestor:$VERSION"
echo "  3) ossutil cp $OUT_DIR/aivestor-$VERSION.tar.gz \\"
echo "       oss://aivestor-releases/aivestor-$VERSION.tar.gz"
echo "  4) 同步 README.md / INSTALL.md 中的链接"
