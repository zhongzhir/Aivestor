@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

cls
echo.
echo ╔══════════════════════════════════════════════════╗
echo ║        Aivestor  本地化部署  快速配置            ║
echo ╚══════════════════════════════════════════════════╝
echo.
echo 本脚本将帮你完成部署前的配置工作。
echo 全程只需回答 2-3 个问题，约 2 分钟完成。
echo.
echo ━━━ 关于数据安全的说明 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo   本脚本在你的电脑本地运行，所有信息仅写入
echo   当前文件夹下的 .env.docker 文件，不会上传到任何服务器。
echo   生成的密钥只存在你的机器上，我们无法也不会获取。
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.

:: 检查 .env.docker 是否已存在
if exist ".env.docker" (
  echo 检测到 .env.docker 已存在。
  set /p overwrite="是否覆盖重新配置？(y/N) "
  if /i not "!overwrite!"=="y" (
    echo 已取消，保留原有配置。
    pause
    exit /b 0
  )
  echo.
)

:: 检查 Node.js
where node >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org/
  echo 安装完成后重新运行本脚本。
  pause
  exit /b 1
)

:: ── 第1步：访问地址 ──────────────────────────────────────────
echo 【第 1 步】设置访问地址
echo   在哪台设备上访问 Aivestor？
echo.
echo   1) 本机浏览器访问（http://localhost）  ← 推荐新手选这个
echo   2) 局域网内其他设备访问（如 http://192.168.x.x）
echo   3) 公网服务器（如 http://1.2.3.4 或 https://yourdomain.com）
echo.
set /p addr_choice="请输入选项 (默认 1): "
if "!addr_choice!"=="" set addr_choice=1

if "!addr_choice!"=="2" (
  echo.
  echo   请输入本机的局域网 IP（如 192.168.1.100）
  echo   查看方式：打开 CMD，输入 ipconfig，找到"IPv4 地址"
  set /p LAN_IP="  局域网 IP: "
  set NEXTAUTH_URL=http://!LAN_IP!
) else if "!addr_choice!"=="3" (
  echo.
  set /p NEXTAUTH_URL="  请输入完整访问地址（含 http:// 或 https://）: "
) else (
  set NEXTAUTH_URL=http://localhost
)
echo   ✓ 访问地址：!NEXTAUTH_URL!
echo.

:: ── 第2步：百炼 API Key（可选）────────────────────────────────
echo 【第 2 步】知识库语义搜索（可选）
echo   Aivestor 知识库支持两种搜索方式：
echo   · 关键词搜索：直接可用，无需任何配置
echo   · 语义搜索：理解含义，搜索更智能，需要填写阿里云百炼 API Key
echo.
echo   申请地址：https://bailian.console.aliyun.com/
echo   （注册后免费领取额度，个人用量几乎不产生费用）
echo.
set /p fill_bailian="  是否现在填写百炼 API Key？直接回车可跳过 (y/N): "
set BAILIAN_API_KEY=
if /i "!fill_bailian!"=="y" (
  set /p BAILIAN_API_KEY="  请粘贴 API Key: "
  echo   ✓ 已填写
) else (
  echo   已跳过，将使用关键词搜索。如需升级，补填 .env.docker 中的 BAILIAN_API_KEY 后重启即可。
)
echo.

:: ── 自动生成密钥 ─────────────────────────────────────────────
echo 正在自动生成安全密钥...

for /f %%i in ('node -e "console.log(require('crypto').randomBytes(20).toString('hex').slice(0,20))"') do set DB_PASSWORD=%%i
for /f %%i in ('node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"') do set NEXTAUTH_SECRET=%%i
for /f %%i in ('node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"') do set ENCRYPTION_KEY=%%i

echo   ✓ 数据库密码已生成
echo   ✓ JWT 签名密钥已生成
echo   ✓ 数据加密密钥已生成
echo.

:: ── 写入配置文件 ─────────────────────────────────────────────
(
echo # Aivestor 本地化部署配置
echo # 由 setup.bat 自动生成
echo # ⚠️  请妥善保管此文件，不要分享给他人或上传到代码仓库
echo.
echo # ── 访问地址 ─────────────────────────────────────────────────
echo NEXTAUTH_URL=!NEXTAUTH_URL!
echo.
echo # ── 自动生成的安全密钥（请勿手动修改）──────────────────────────
echo DB_PASSWORD=!DB_PASSWORD!
echo NEXTAUTH_SECRET=!NEXTAUTH_SECRET!
echo ENCRYPTION_KEY=!ENCRYPTION_KEY!
echo.
echo # ── AI 能力 ──────────────────────────────────────────────────
echo # 知识库语义搜索 Key（留空则使用关键词搜索，功能不受影响）
echo # 申请地址：https://bailian.console.aliyun.com/
echo BAILIAN_API_KEY=!BAILIAN_API_KEY!
echo.
echo # 系统代付 DeepSeek Key（可选，填写后新用户有免费 AI 额度）
echo SYSTEM_DEEPSEEK_API_KEY=
echo.
echo # ── 文件存储（可选）──────────────────────────────────────────
echo # 留空则文件自动存储在本机，无需任何云服务。
echo OSS_REGION=
echo OSS_ACCESS_KEY_ID=
echo OSS_ACCESS_KEY_SECRET=
echo OSS_BUCKET=
echo.
echo # ── 邮件服务（可选）──────────────────────────────────────────
echo # 用于「忘记密码」邮件，不填则该功能不可用
echo ALIYUN_ACCESS_KEY_ID=
echo ALIYUN_ACCESS_KEY_SECRET=
echo ALIYUN_EMAIL_FROM=
echo.
echo # ── 短信服务（可选）──────────────────────────────────────────
echo # 用于手机号验证码登录，不填则只能用邮箱登录
echo ALIYUN_SMS_SIGN=
echo ALIYUN_SMS_TEMPLATE=
) > .env.docker

echo ╔══════════════════════════════════════════════════╗
echo ║           配置完成！                             ║
echo ╚══════════════════════════════════════════════════╝
echo.
echo   配置已写入 .env.docker 文件。
echo.
echo 下一步：启动 Aivestor
echo.
echo   在当前文件夹打开终端，运行以下命令：
echo.
echo   docker compose --env-file .env.docker up -d --build
echo.
echo   首次启动约需 3-5 分钟（下载和构建镜像）。
echo   完成后打开浏览器访问：!NEXTAUTH_URL!
echo.
echo 提示：如需修改配置，用记事本打开 .env.docker 即可，
echo 修改后运行 docker compose --env-file .env.docker up -d 重启生效。
echo.
pause
