#!/bin/bash
# Aivestor 一键配置脚本（Mac / Linux）
# 自动生成所有密钥，引导填写最少必要信息，最终写出 .env.docker

set -e

# ── 颜色 ────────────────────────────────────────────────────
BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
YELLOW="\033[0;33m"
GRAY="\033[0;90m"
RESET="\033[0m"

clear

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║        Aivestor  本地化部署  快速配置            ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "${CYAN}本脚本将帮你完成部署前的配置工作。${RESET}"
echo -e "${CYAN}全程只需回答 2-3 个问题，约 2 分钟完成。${RESET}"
echo ""
echo -e "${YELLOW}━━━ 关于数据安全的说明 ━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "  本脚本在你的电脑本地运行，所有信息仅写入"
echo -e "  当前文件夹下的 .env.docker 文件，${BOLD}不会上传到任何服务器${RESET}。"
echo -e "  生成的密钥只存在你的机器上，我们无法也不会获取。"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

# 检查 .env.docker 是否已存在
if [ -f ".env.docker" ]; then
  echo -e "${YELLOW}检测到 .env.docker 已存在。${RESET}"
  read -p "是否覆盖重新配置？(y/N) " overwrite
  if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
    echo "已取消，保留原有配置。"
    exit 0
  fi
  echo ""
fi

# ── 第1步：访问地址 ──────────────────────────────────────────
echo -e "${BOLD}【第 1 步】设置访问地址${RESET}"
echo -e "${GRAY}  在哪台设备上访问 Aivestor？${RESET}"
echo -e "  ${CYAN}1${RESET}) 本机浏览器访问（http://localhost）${GRAY} ← 推荐新手选这个${RESET}"
echo -e "  ${CYAN}2${RESET}) 局域网内其他设备访问（如 http://192.168.x.x）"
echo -e "  ${CYAN}3${RESET}) 公网服务器（如 http://1.2.3.4 或 https://yourdomain.com）"
echo ""
read -p "请输入选项 (默认 1): " addr_choice
addr_choice=${addr_choice:-1}

case $addr_choice in
  2)
    echo ""
    echo -e "${GRAY}  请输入本机的局域网 IP（如 192.168.1.100）${RESET}"
    echo -e "${GRAY}  查看方式：Mac 打开「终端」输入 ifconfig | grep 'inet '；Windows 打开 CMD 输入 ipconfig${RESET}"
    read -p "  局域网 IP: " LAN_IP
    NEXTAUTH_URL="http://${LAN_IP}"
    ;;
  3)
    echo ""
    read -p "  请输入完整访问地址（含 http:// 或 https://）: " NEXTAUTH_URL
    ;;
  *)
    NEXTAUTH_URL="http://localhost"
    ;;
esac
echo -e "  ${GREEN}✓ 访问地址：${NEXTAUTH_URL}${RESET}"
echo ""

# ── 第2步：百炼 API Key（可选）────────────────────────────────
echo -e "${BOLD}【第 2 步】知识库语义搜索（可选）${RESET}"
echo -e "${GRAY}  Aivestor 知识库支持两种搜索方式：${RESET}"
echo -e "  • ${CYAN}关键词搜索${RESET}：直接可用，无需任何配置"
echo -e "  • ${CYAN}语义搜索${RESET}：理解含义，搜索更智能，需要填写阿里云百炼 API Key"
echo ""
echo -e "  申请地址：${CYAN}https://bailian.console.aliyun.com/${RESET}"
echo -e "  （注册后免费领取额度，个人用量几乎不产生费用）"
echo ""
read -p "  是否现在填写百炼 API Key？直接回车可跳过，之后在 .env.docker 里补填 (y/N): " fill_bailian
BAILIAN_API_KEY=""
if [[ "$fill_bailian" =~ ^[Yy]$ ]]; then
  read -p "  请粘贴 API Key: " BAILIAN_API_KEY
  echo -e "  ${GREEN}✓ 已填写${RESET}"
else
  echo -e "  ${GRAY}已跳过，将使用关键词搜索。如需升级，补填 .env.docker 中的 BAILIAN_API_KEY 后重启即可。${RESET}"
fi
echo ""

# ── 自动生成密钥 ─────────────────────────────────────────────
echo -e "${BOLD}正在自动生成安全密钥...${RESET}"

# 生成数据库密码（20位随机字母数字）
DB_PASSWORD=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20)

# 生成 NEXTAUTH_SECRET
if command -v openssl &>/dev/null; then
  NEXTAUTH_SECRET=$(openssl rand -base64 32)
elif command -v node &>/dev/null; then
  NEXTAUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
else
  NEXTAUTH_SECRET=$(LC_ALL=C tr -dc 'A-Za-z0-9+/=' </dev/urandom | head -c 44)
fi

# 生成 ENCRYPTION_KEY
if command -v node &>/dev/null; then
  ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
else
  ENCRYPTION_KEY=$(LC_ALL=C tr -dc '0-9a-f' </dev/urandom | head -c 64)
fi

echo -e "  ${GREEN}✓ 数据库密码已生成${RESET}"
echo -e "  ${GREEN}✓ JWT 签名密钥已生成${RESET}"
echo -e "  ${GREEN}✓ 数据加密密钥已生成${RESET}"
echo ""

# ── 写入配置文件 ─────────────────────────────────────────────
cat > .env.docker <<EOF
# Aivestor 本地化部署配置
# 由 setup.sh 自动生成于 $(date '+%Y-%m-%d %H:%M:%S')
# ⚠️  请妥善保管此文件，不要分享给他人或上传到代码仓库

# ── 访问地址 ─────────────────────────────────────────────────
NEXTAUTH_URL=${NEXTAUTH_URL}

# ── 自动生成的安全密钥（请勿手动修改）──────────────────────────
DB_PASSWORD=${DB_PASSWORD}
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# ── AI 能力 ──────────────────────────────────────────────────
# 知识库语义搜索 Key（留空则使用关键词搜索，功能不受影响）
# 申请地址：https://bailian.console.aliyun.com/
BAILIAN_API_KEY=${BAILIAN_API_KEY}

# 系统代付 DeepSeek Key（可选，填写后新用户有免费 AI 额度）
SYSTEM_DEEPSEEK_API_KEY=

# ── 文件存储（可选）──────────────────────────────────────────
# 留空则文件自动存储在本机，无需任何云服务。
# 如需多机共享或云端备份，可配置阿里云 OSS。
OSS_REGION=
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
OSS_BUCKET=

# ── 邮件服务（可选）──────────────────────────────────────────
# 用于「忘记密码」邮件，不填则该功能不可用（可通过管理员重置密码）
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_EMAIL_FROM=

# ── 短信服务（可选）──────────────────────────────────────────
# 用于手机号验证码登录，不填则只能用邮箱登录
ALIYUN_SMS_SIGN=
ALIYUN_SMS_TEMPLATE=
EOF

echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║           配置完成！                             ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  配置已写入 ${BOLD}.env.docker${RESET} 文件。"
echo ""
echo -e "${BOLD}下一步：启动 Aivestor${RESET}"
echo ""
echo -e "  在当前文件夹运行以下命令："
echo ""
echo -e "  ${CYAN}docker compose --env-file .env.docker up -d --build${RESET}"
echo ""
echo -e "  ${GRAY}首次启动约需 3-5 分钟（下载和构建镜像）。${RESET}"
echo -e "  ${GRAY}完成后打开浏览器访问：${NEXTAUTH_URL}${RESET}"
echo ""
echo -e "${YELLOW}提示：如需修改配置，用文本编辑器打开 .env.docker 即可，${RESET}"
echo -e "${YELLOW}修改后运行 docker compose --env-file .env.docker up -d 重启生效。${RESET}"
echo ""
