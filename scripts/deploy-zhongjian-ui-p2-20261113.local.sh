#!/usr/bin/env bash

set -eEuo pipefail
umask 077

repo=/var/www/zhongjian-zhitou
target=10b86f64e1a3fd703ca9654a24da22fc0c48e833
previous_source=d56efa56eec2554d182ed1a9a10d5569b8ccdc91
release_root=/var/www/zhongjian-releases
release="$release_root/$target"
backup=/var/backups/zhongjian-ui-p2/$(date +%Y%m%d-%H%M%S)
web_name=zhongjian-zhitou
deep_name=zhongjian-zhitou-deep-research
intel_name=zhongjian-zhitou-intelligence
old_release=
switched=0

overlay_files=(
  'public/brand/zhongjian-zhitou/svg/logo-horizontal-color.svg'
  'src/app/(auth)/layout.tsx'
  'src/components/auth/AuthBrand.tsx'
  'src/lib/brand.ts'
)

rollback_on_error() {
  code=$?
  failed_line=${1:-unknown}
  failed_command=${2:-unknown}
  trap - ERR
  set +e
  printf '\n发布失败，开始执行安全回退。\n'
  printf '失败位置：第 %s 行；命令：%s\n' "$failed_line" "$failed_command"

  if [ "$switched" = 1 ] && [ -n "$old_release" ] && [ -f "$old_release/.env.local" ]; then
    pm2 delete "$intel_name" >/dev/null 2>&1 || true
    pm2 delete "$deep_name" >/dev/null 2>&1 || true
    pm2 delete "$web_name" >/dev/null 2>&1 || true

    NODE_ENV=production \
    NEXT_PUBLIC_BRAND_PROFILE=zhongjian-zhitou \
    NEXT_PUBLIC_APP_URL=https://aivestor.com.cn \
      pm2 start npm \
        --name "$web_name" \
        --cwd "$old_release" \
        -- start >/dev/null

    NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=256 \
    NEXT_PUBLIC_BRAND_PROFILE=zhongjian-zhitou \
    NEXT_PUBLIC_APP_URL=https://aivestor.com.cn \
      pm2 start npm \
        --name "$deep_name" \
        --cwd "$old_release" \
        --max-memory-restart 384M \
        -- run deep-research:worker >/dev/null

    pm2 save >/dev/null
    printf '已恢复原 Web 与深度投研 Worker：%s\n' "$old_release"
    printf '051-053 为增量迁移，若已执行则保留，不自动回滚数据库。\n'
  else
    printf '尚未切换生产进程，当前线上版本未改变。\n'
  fi

  printf '请完整回传本次输出，不要重复执行。\n'
  exit "$code"
}
trap 'rollback_on_error "$LINENO" "$BASH_COMMAND"' ERR

printf '===== 1. 生产边界与目标版本门禁 =====\n'
cd "$repo"
test "$(git branch --show-current)" = main
test "$(git remote get-url origin | tr '[:upper:]' '[:lower:]')" = \
  'https://github.com/zhongzhir/aivestor.git'

web_pid=$(pm2 pid "$web_name" | tail -1)
deep_pid=$(pm2 pid "$deep_name" | tail -1)
printf '%s' "$web_pid" | grep -Eq '^[1-9][0-9]*$'
printf '%s' "$deep_pid" | grep -Eq '^[1-9][0-9]*$'
old_release=$(readlink -f "/proc/$web_pid/cwd")
test "$old_release" = "$(readlink -f "/proc/$deep_pid/cwd")"
test "$old_release" = "$release_root/$previous_source"
test -f "$old_release/.env.local"

brand=$(tr '\0' '\n' <"/proc/$web_pid/environ" |
  sed -n 's/^NEXT_PUBLIC_BRAND_PROFILE=//p' | tail -1)
public_origin=$(tr '\0' '\n' <"/proc/$web_pid/environ" |
  sed -n 's/^NEXT_PUBLIC_APP_URL=//p' | tail -1)
test "$brand" = zhongjian-zhitou
test "$public_origin" = https://aivestor.com.cn

test ! -e "$release"
intel_pid=$(pm2 pid "$intel_name" 2>/dev/null | tail -1 || true)
test -z "$intel_pid" || test "$intel_pid" = 0

printf '拉取并核验远端 main；如网络握手失败，本脚本将在生产切换前停止。\n'
git fetch --no-tags origin main
test "$(git rev-parse FETCH_HEAD)" = "$target"
test "$(git ls-remote origin refs/heads/main | awk '{print $1}')" = "$target"
git cat-file -e "$target^{commit}"

if ! git diff --quiet "$previous_source" "$target" -- "${overlay_files[@]}"; then
  printf '目标版本修改了中鉴白标专属文件，停止自动发布。\n'
  git diff --name-status "$previous_source" "$target" -- "${overlay_files[@]}"
  false
fi

printf '%s  %s\n' \
  '059ccc4a002270139323d576f418ecc490967dbfa5a1ae2c0d9e71aa34c1a200' \
  "$old_release/${overlay_files[0]}" \
  'd9ad185ff3ecb2f19dc63a1fbedfc3eb6849a69fa6cd9fc7f3c76e7a6dc5d1b5' \
  "$old_release/${overlay_files[1]}" \
  '6a50b0be3a6780f81f5da0fad71e03a44c50fa1fa1abb5f1cf59d73d00808586' \
  "$old_release/${overlay_files[2]}" \
  'c9124148c360831418ef5fd39904f354c562cd50f81c9f8786215cd875344709' \
  "$old_release/${overlay_files[3]}" |
  sha256sum -c -

app_db_user=$(
  cd "$old_release"
  node --env-file=.env.local -e \
    'process.stdout.write(decodeURIComponent(new URL(process.env.DATABASE_URL).username))'
)
test "$app_db_user" = aivestor

active_deep=$(
  runuser -u postgres -- psql -At --dbname=zhongjian_zhitou \
    -c "SELECT count(*) FROM deep_research_jobs WHERE status IN ('queued','running')"
)
test "$active_deep" = 0
printf 'PASS：中鉴白标、数据库账号、无活动投研任务及目标版本均已确认\n'

printf '\n===== 2. 数据与运行配置备份 =====\n'
install -d -m 0700 "$backup/overlay"
install -m 0600 "$old_release/.env.local" "$backup/env.local"
cp -a /root/.pm2/dump.pm2 "$backup/pm2-dump.pm2" 2>/dev/null || true

for file in "${overlay_files[@]}"; do
  install -d -m 0700 "$backup/overlay/$(dirname "$file")"
  cp -a "$old_release/$file" "$backup/overlay/$file"
done

runuser -u postgres -- pg_dump \
  --format=custom \
  --dbname=zhongjian_zhitou >"$backup/zhongjian_zhitou.dump"
test -s "$backup/zhongjian_zhitou.dump"
sha256sum "$backup/zhongjian_zhitou.dump" |
  tee "$backup/zhongjian_zhitou.dump.sha256"
printf '备份目录：%s\n' "$backup"

printf '\n===== 3. 创建独立 Release 并恢复中鉴白标 =====\n'
install -d -m 0755 "$release_root"
git worktree add --detach "$release" "$target"
install -m 0600 "$old_release/.env.local" "$release/.env.local"

for file in "${overlay_files[@]}"; do
  cp -a "$old_release/$file" "$release/$file"
done
printf '%s\n' "$target" >"$release/.deployed-source"

printf '%s  %s\n' \
  '059ccc4a002270139323d576f418ecc490967dbfa5a1ae2c0d9e71aa34c1a200' \
  "$release/${overlay_files[0]}" \
  'd9ad185ff3ecb2f19dc63a1fbedfc3eb6849a69fa6cd9fc7f3c76e7a6dc5d1b5' \
  "$release/${overlay_files[1]}" \
  '6a50b0be3a6780f81f5da0fad71e03a44c50fa1fa1abb5f1cf59d73d00808586' \
  "$release/${overlay_files[2]}" \
  'c9124148c360831418ef5fd39904f354c562cd50f81c9f8786215cd875344709' \
  "$release/${overlay_files[3]}" |
  sha256sum -c -

printf '\n===== 4. 安装、关键回归与白标构建 =====\n'
cd "$release"
npm ci --include=dev --no-audit --no-fund
npm run test:intelligence-navigation
npm run test:intelligence-workspace
npm run test:mainline-ux
npm run test:work-scenes
npm run test:project-management
npm run test:db-permissions
npm run test:deep-research

export NODE_ENV=production
export NEXT_PUBLIC_BRAND_PROFILE=zhongjian-zhitou
export NEXT_PUBLIC_APP_URL=https://aivestor.com.cn
npm run build

printf '\n===== 5. 增量迁移 051-053 与权限验收 =====\n'
for migration in \
  db/migrations/051_intelligence_workspace.sql \
  db/migrations/052_intelligence_external_generation_budget.sql \
  db/migrations/053_intelligence_pipeline_checkpoints.sql
do
  cat "$migration" |
    runuser -u postgres -- psql \
      --dbname=zhongjian_zhitou \
      --set=ON_ERROR_STOP=1
done

runuser -u postgres -- psql \
  --dbname=zhongjian_zhitou \
  --set=ON_ERROR_STOP=1 <<'SQL'
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  intelligence_runs,
  intelligence_run_external_attempts,
  intelligence_run_request_keys,
  intelligence_run_evidence,
  intelligence_scheduler_heartbeats,
  intelligence_quota_reservations,
  intelligence_run_checkpoints
TO aivestor;
SQL

node --env-file=.env.local <<'NODE'
const pg = require('pg');
const requiredTables = [
  'intelligence_runs',
  'intelligence_run_external_attempts',
  'intelligence_run_request_keys',
  'intelligence_run_evidence',
  'intelligence_scheduler_heartbeats',
  'intelligence_quota_reservations',
  'intelligence_run_checkpoints',
];
(async () => {
  const client = new pg.Client({connectionString: process.env.DATABASE_URL});
  await client.connect();
  const tableResult = await client.query(`
    SELECT table_name,
           has_table_privilege(current_user, format('public.%I', table_name),
             'SELECT,INSERT,UPDATE,DELETE') AS ok
      FROM information_schema.tables
     WHERE table_schema='public' AND table_name = ANY($1::text[])
  `, [requiredTables]);
  const actual = new Map(tableResult.rows.map((row) => [row.table_name, row.ok]));
  for (const name of requiredTables) {
    if (actual.get(name) !== true) throw new Error(`数据库表或权限缺失：${name}`);
  }
  const columnResult = await client.query(`
    SELECT
      EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='intelligence_tasks'
                 AND column_name='next_run_at') AS has_next_run_at,
      EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='intelligence_runs'
                 AND column_name='external_cost_authorization') AS has_cost_authorization,
      (SELECT count(*)::int FROM intelligence_runs
        WHERE status IN ('queued','running')) AS active_runs
  `);
  const row = columnResult.rows[0];
  if (!row.has_next_run_at || !row.has_cost_authorization || row.active_runs !== 0) {
    throw new Error(`迁移验收失败：${JSON.stringify(row)}`);
  }
  await client.end();
  console.log('PASS：051-053 结构、应用账号权限及零活动情报任务已确认');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
NODE

printf '\n===== 6. 切换 Web、深度投研与投资情报 Worker =====\n'
web_error=/root/.pm2/logs/zhongjian-zhitou-error.log
deep_error=/root/.pm2/logs/zhongjian-zhitou-deep-research-error.log
intel_error=/root/.pm2/logs/zhongjian-zhitou-intelligence-error.log
web_error_before=$(stat -c %s "$web_error" 2>/dev/null || printf 0)
deep_error_before=$(stat -c %s "$deep_error" 2>/dev/null || printf 0)
intel_error_before=$(stat -c %s "$intel_error" 2>/dev/null || printf 0)

switched=1
pm2 delete "$intel_name" >/dev/null 2>&1 || true
pm2 delete "$deep_name"
pm2 delete "$web_name"

NODE_ENV=production \
NEXT_PUBLIC_BRAND_PROFILE=zhongjian-zhitou \
NEXT_PUBLIC_APP_URL=https://aivestor.com.cn \
  pm2 start npm \
    --name "$web_name" \
    --cwd "$release" \
    -- start

NODE_ENV=production \
NODE_OPTIONS=--max-old-space-size=256 \
NEXT_PUBLIC_BRAND_PROFILE=zhongjian-zhitou \
NEXT_PUBLIC_APP_URL=https://aivestor.com.cn \
  pm2 start npm \
    --name "$deep_name" \
    --cwd "$release" \
    --max-memory-restart 384M \
    -- run deep-research:worker

NODE_ENV=production \
NODE_OPTIONS=--max-old-space-size=256 \
NEXT_PUBLIC_BRAND_PROFILE=zhongjian-zhitou \
NEXT_PUBLIC_APP_URL=https://aivestor.com.cn \
  pm2 start npm \
    --name "$intel_name" \
    --cwd "$release" \
    --max-memory-restart 384M \
    -- run intelligence:worker

ready=no
for attempt in $(seq 1 45); do
  if curl --fail --silent --max-time 5 \
    http://127.0.0.1:3000/api/health >/dev/null; then
    ready=yes
    break
  fi
  sleep 1
done
test "$ready" = yes

heartbeat=no
for attempt in $(seq 1 20); do
  recent_heartbeats=$(
    runuser -u postgres -- psql -At --dbname=zhongjian_zhitou \
      -c "SELECT count(*) FROM intelligence_scheduler_heartbeats WHERE last_heartbeat_at > now() - interval '2 minutes'"
  )
  if [ "$recent_heartbeats" -gt 0 ]; then
    heartbeat=yes
    break
  fi
  sleep 2
done
test "$heartbeat" = yes
sleep 3

for process in "$web_name" "$deep_name" "$intel_name"; do
  pid=$(pm2 pid "$process" | tail -1)
  printf '%s' "$pid" | grep -Eq '^[1-9][0-9]*$'
  test "$(readlink -f "/proc/$pid/cwd")" = "$release"
done

web_error_after=$(stat -c %s "$web_error" 2>/dev/null || printf 0)
deep_error_after=$(stat -c %s "$deep_error" 2>/dev/null || printf 0)
intel_error_after=$(stat -c %s "$intel_error" 2>/dev/null || printf 0)
if [ "$web_error_after" -ne "$web_error_before" ] ||
   [ "$deep_error_after" -ne "$deep_error_before" ] ||
   [ "$intel_error_after" -ne "$intel_error_before" ]; then
  printf '发现新错误日志，停止验收并触发回退。\n'
  tail -50 "$web_error" 2>/dev/null || true
  tail -50 "$deep_error" 2>/dev/null || true
  tail -50 "$intel_error" 2>/dev/null || true
  false
fi
printf 'PASS：三个生产进程均运行于目标 Release，情报 Worker 心跳正常\n'

printf '\n===== 7. 公网、鉴权与相邻服务验收 =====\n'
curl --fail --silent --show-error --max-time 15 \
  http://127.0.0.1:3000/api/health
printf '\n'
curl --fail --silent --show-error --max-time 15 \
  https://aivestor.com.cn/api/health
printf '\n'

login_code=$(curl --silent --output /dev/null --max-time 15 \
  --write-out '%{http_code}' https://aivestor.com.cn/login)
test "$login_code" = 200

for route in \
  /dashboard \
  /projects \
  /data-apps/intelligence-subscriptions
do
  code=$(curl --silent --output /dev/null --max-time 15 \
    --write-out '%{http_code}' "https://aivestor.com.cn$route")
  test "$code" = 307
  printf '匿名访问 %s：HTTP %s（正确跳转登录）\n' "$route" "$code"
done

failed_runs=$(
  runuser -u postgres -- psql -At --dbname=zhongjian_zhitou \
    -c "SELECT count(*) FROM intelligence_runs WHERE status='failed' AND created_at > now() - interval '10 minutes'"
)
test "$failed_runs" = 0

systemctl is-active nginx postgresql
pm2 save
pm2 list
df -h /
free -h

switched=0
trap - ERR

printf '\nZHONGJIAN_UI_P2_DEPLOYED_AND_ENGINEERING_ACCEPTED\n'
printf '公开源版本：%s\n' "$target"
printf '中鉴生产 Release：%s\n' "$release"
printf '原 Release（可回滚）：%s\n' "$old_release"
printf '数据库与配置备份：%s\n' "$backup"
printf '白标覆盖：保持中鉴现有 4 个专属文件不变\n'
printf '生产进程：%s、%s、%s\n' "$web_name" "$deep_name" "$intel_name"
