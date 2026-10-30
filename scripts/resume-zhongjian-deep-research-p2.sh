#!/usr/bin/env bash

set -eEuo pipefail
umask 077

repo=/var/www/zhongjian-zhitou
target=d56efa56eec2554d182ed1a9a10d5569b8ccdc91
deploy_commit=8625befc4e67ffe2c7978bf4a46c3ec2c629b47f
release=/var/www/zhongjian-releases/$target
backup=/var/backups/zhongjian-deep-research/20261030-152220
production_tag=zhongjian-production-20261030-p2
old_cwd="$repo"
switched=0

rollback_on_error() {
  code=$?
  trap - ERR
  set +e

  if [ "$switched" = 1 ]; then
    printf '\nDeployment failed; restoring the previous Web release.\n'
    pm2 delete zhongjian-zhitou-deep-research >/dev/null 2>&1
    pm2 delete zhongjian-zhitou >/dev/null 2>&1

    NODE_ENV=production \
    NEXT_PUBLIC_BRAND_PROFILE=zhongjian-zhitou \
    NEXT_PUBLIC_APP_URL=https://aivestor.com.cn \
      pm2 start npm \
        --name zhongjian-zhitou \
        --cwd "$old_cwd" \
        -- start

    pm2 save
    printf 'Previous Web release restored.\n'
  else
    printf '\nProduction switch has not occurred; current application is unchanged.\n'
  fi

  exit "$code"
}
trap rollback_on_error ERR

printf '===== 1. Resume preflight =====\n'
test -d "$release"
test -s "$backup/zhongjian_zhitou.dump"
test -f "$release/.env.local"
test -f "$release/.next/BUILD_ID"
test "$(git -C "$release" rev-parse HEAD)" = "$deploy_commit"
test "$(cat "$release/.deployed-source")" = "$target"

web_pid=$(pm2 pid zhongjian-zhitou | tail -1)
printf '%s' "$web_pid" | grep -Eq '^[1-9][0-9]*$'
test "$(readlink -f "/proc/$web_pid/cwd")" = "$repo"

if pm2 pid zhongjian-zhitou-deep-research | grep -Eq '^[1-9][0-9]*$'; then
  printf 'Unexpected active deep research worker before cutover.\n'
  exit 1
fi
if git -C "$release" show-ref --verify --quiet "refs/tags/$production_tag"; then
  printf 'Production tag already exists: %s\n' "$production_tag"
  exit 1
fi

curl --fail --silent --show-error --max-time 15 \
  https://aivestor.com.cn/api/health
printf '\nPASS: release, backup, current Web and public health verified\n'

printf '\n===== 2. Database migrations 048-050 =====\n'
cd "$release"
cat \
  db/migrations/048_deep_research_reports.sql \
  db/migrations/049_deep_research_evidence.sql \
  db/migrations/050_deep_research_jobs.sql |
  runuser -u postgres -- psql \
    --dbname=zhongjian_zhitou \
    --set=ON_ERROR_STOP=1 \
    --single-transaction

runuser -u postgres -- psql \
  --dbname=zhongjian_zhitou \
  --set=ON_ERROR_STOP=1 <<'SQL'
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE deep_research_jobs, deep_research_tasks
TO aivestor;
SQL

node --env-file=.env.local <<'NODE'
const pg = require("pg");

(async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const result = await client.query(`
    SELECT
      (SELECT count(*)::int
       FROM deep_research_jobs
       WHERE status IN ('queued', 'running')) AS active_jobs,
      has_table_privilege(current_user, 'deep_research_jobs', 'SELECT') AND
      has_table_privilege(current_user, 'deep_research_jobs', 'INSERT') AND
      has_table_privilege(current_user, 'deep_research_jobs', 'UPDATE') AND
      has_table_privilege(current_user, 'deep_research_jobs', 'DELETE')
        AS jobs_permissions,
      has_table_privilege(current_user, 'deep_research_tasks', 'SELECT') AND
      has_table_privilege(current_user, 'deep_research_tasks', 'INSERT') AND
      has_table_privilege(current_user, 'deep_research_tasks', 'UPDATE') AND
      has_table_privilege(current_user, 'deep_research_tasks', 'DELETE')
        AS tasks_permissions,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='documents'
          AND column_name='source_map'
      ) AS has_source_map,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public'
          AND table_name='reports'
          AND column_name='research_metadata'
      ) AS has_research_metadata,
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname='reports_kind_check'
          AND pg_get_constraintdef(oid) LIKE '%deep_research%'
      ) AS allows_deep_research
  `);
  const row = result.rows[0];
  console.log(row);
  if (
    row.active_jobs !== 0 ||
    !row.jobs_permissions ||
    !row.tasks_permissions ||
    !row.has_source_map ||
    !row.has_research_metadata ||
    !row.allows_deep_research
  ) {
    throw new Error("Deep research database acceptance failed");
  }
  await client.end();
  console.log("PASS: application database access verified");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
NODE

printf '\n===== 3. Web and worker cutover =====\n'
web_error=/root/.pm2/logs/zhongjian-zhitou-error.log
worker_error=/root/.pm2/logs/zhongjian-zhitou-deep-research-error.log
web_error_before=$(stat -c %s "$web_error" 2>/dev/null || printf 0)
worker_error_before=$(stat -c %s "$worker_error" 2>/dev/null || printf 0)

switched=1
pm2 delete zhongjian-zhitou-deep-research >/dev/null 2>&1 || true
pm2 delete zhongjian-zhitou

NODE_ENV=production \
NEXT_PUBLIC_BRAND_PROFILE=zhongjian-zhitou \
NEXT_PUBLIC_APP_URL=https://aivestor.com.cn \
  pm2 start npm \
    --name zhongjian-zhitou \
    --cwd "$release" \
    -- start

NODE_ENV=production \
NODE_OPTIONS=--max-old-space-size=256 \
NEXT_PUBLIC_BRAND_PROFILE=zhongjian-zhitou \
NEXT_PUBLIC_APP_URL=https://aivestor.com.cn \
  pm2 start npm \
    --name zhongjian-zhitou-deep-research \
    --cwd "$release" \
    --max-memory-restart 384M \
    -- run deep-research:worker

ready=no
for attempt in $(seq 1 30); do
  if curl --fail --silent --max-time 5 \
    http://127.0.0.1:3000/api/health >/dev/null; then
    ready=yes
    break
  fi
  sleep 1
done
test "$ready" = yes
sleep 3

web_pid=$(pm2 pid zhongjian-zhitou | tail -1)
worker_pid=$(pm2 pid zhongjian-zhitou-deep-research | tail -1)
printf '%s' "$web_pid" | grep -Eq '^[1-9][0-9]*$'
printf '%s' "$worker_pid" | grep -Eq '^[1-9][0-9]*$'
test "$(readlink -f "/proc/$web_pid/cwd")" = "$release"
test "$(readlink -f "/proc/$worker_pid/cwd")" = "$release"

web_error_after=$(stat -c %s "$web_error" 2>/dev/null || printf 0)
worker_error_after=$(stat -c %s "$worker_error" 2>/dev/null || printf 0)
if [ "$web_error_after" -ne "$web_error_before" ] ||
   [ "$worker_error_after" -ne "$worker_error_before" ]; then
  printf 'New Web or worker error log entries detected.\n'
  tail -40 "$web_error" 2>/dev/null || true
  tail -40 "$worker_error" 2>/dev/null || true
  false
fi
printf 'PASS: Web and worker use the P2 release\n'

printf '\n===== 4. Public acceptance =====\n'
curl --fail --silent --show-error --max-time 15 \
  http://127.0.0.1:3000/api/health
printf '\n'
curl --fail --silent --show-error --max-time 15 \
  https://aivestor.com.cn/api/health
printf '\n'

project_code=$(
  curl --silent --output /dev/null --max-time 15 \
    --write-out '%{http_code}' \
    https://aivestor.com.cn/projects
)
test "$project_code" = 307
printf 'Anonymous projects HTTP %s\n' "$project_code"

pm2 save
git -C "$release" \
  -c user.name='Zhongjian Deploy' \
  -c user.email='deploy@aivestor.com.cn' \
  tag -a \
  "$production_tag" \
  -m 'Zhongjian production deep research P2' \
  "$deploy_commit"

pm2 list
systemctl is-active nginx postgresql
df -h /
free -h

switched=0
trap - ERR

printf '\nZHONGJIAN_DEEP_RESEARCH_P2_DEPLOYED_AND_ENGINEERING_ACCEPTED\n'
printf 'Public source: %s\n' "$target"
printf 'White-label deployment commit: %s\n' "$deploy_commit"
printf 'Production release: %s\n' "$release"
printf 'Rollback directory: %s\n' "$old_cwd"
printf 'Backup: %s\n' "$backup"
printf 'Certificate renewal: /etc/cron.d/zhongjian-certbot-renew\n'
