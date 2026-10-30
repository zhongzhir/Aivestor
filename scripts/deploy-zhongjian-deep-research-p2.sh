#!/usr/bin/env bash

set -eEuo pipefail
umask 077

repo=/var/www/zhongjian-zhitou
target=d56efa56eec2554d182ed1a9a10d5569b8ccdc91
release_root=/var/www/zhongjian-releases
release="$release_root/$target"
deploy_branch=deploy/zhongjian-p2-20261030
production_tag=zhongjian-production-20261030-p2
backup=/var/backups/zhongjian-deep-research/$(date +%Y%m%d-%H%M%S)
old_cwd="$repo"
switched=0

rollback_on_error() {
  code=$?
  trap - ERR
  set +e
  systemctl start nginx >/dev/null 2>&1

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

printf '===== 1. Preflight =====\n'
cd "$repo"

test "$(git rev-parse "$target")" = "$target"
test "$(git remote get-url origin | tr '[:upper:]' '[:lower:]')" = \
  'https://github.com/zhongzhir/aivestor.git'
test "$(git branch --show-current)" = main
test -f "$repo/.env.local"
test -s "$(command -v certbot)"

web_pid=$(pm2 pid zhongjian-zhitou | tail -1)
printf '%s' "$web_pid" | grep -Eq '^[1-9][0-9]*$'
test "$(readlink -f "/proc/$web_pid/cwd")" = "$repo"

brand=$(tr '\0' '\n' <"/proc/$web_pid/environ" |
  sed -n 's/^NEXT_PUBLIC_BRAND_PROFILE=//p' | tail -1)
public_origin=$(tr '\0' '\n' <"/proc/$web_pid/environ" |
  sed -n 's/^NEXT_PUBLIC_APP_URL=//p' | tail -1)
test "$brand" = zhongjian-zhitou
test "$public_origin" = https://aivestor.com.cn

overlay_changes=$(
  git diff --name-only \
    56836f6a223ba6200dd16e27859017e877f5bdf2 \
    "$target" \
    -- \
    public/brand/zhongjian-zhitou/svg/logo-horizontal-color.svg \
    'src/app/(auth)/layout.tsx' \
    src/components/auth/AuthBrand.tsx \
    src/lib/brand.ts
)
test -z "$overlay_changes"

if [ -e "$release" ]; then
  printf 'Release already exists: %s\n' "$release"
  exit 1
fi
if git show-ref --verify --quiet "refs/heads/$deploy_branch"; then
  printf 'Deployment branch already exists: %s\n' "$deploy_branch"
  exit 1
fi
if git show-ref --verify --quiet "refs/tags/$production_tag"; then
  printf 'Production tag already exists: %s\n' "$production_tag"
  exit 1
fi
printf 'PASS: repository, PM2, brand and target commit verified\n'

printf '\n===== 2. Certificate renewal scheduler =====\n'
hook=/etc/letsencrypt/renewal-hooks/deploy/zhongjian-reload-nginx
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat >"$hook" <<'HOOK'
#!/bin/sh
set -eu
/usr/sbin/nginx -t >/dev/null 2>&1
/bin/systemctl reload nginx
HOOK
chmod 0755 "$hook"

certbot_bin=$(command -v certbot)
printf '17 3,15 * * * root %s renew --quiet\n' "$certbot_bin" \
  >/etc/cron.d/zhongjian-certbot-renew
chmod 0644 /etc/cron.d/zhongjian-certbot-renew

if grep -Fq 'authenticator = manual' \
  /etc/letsencrypt/renewal/aivestor.com.cn.conf; then
  printf 'Certificate renewal configuration is still manual.\n'
  exit 1
fi

certbot renew \
  --cert-name aivestor.com.cn \
  --dry-run \
  --non-interactive
nginx -t
systemctl reload nginx

echo | openssl s_client \
  -connect 127.0.0.1:443 \
  -servername aivestor.com.cn 2>/dev/null |
  openssl x509 -noout -checkend 2592000
curl --fail --silent --show-error --max-time 15 \
  https://aivestor.com.cn/api/health
printf '\nPASS: certificate and automated renewal verified\n'

printf '\n===== 3. Backup =====\n'
install -d -m 0700 "$backup"
cp -a "$repo/.env.local" "$backup/env.local"
cp -a /root/.pm2/dump.pm2 "$backup/pm2-dump.pm2" 2>/dev/null || true
cp -a /etc/letsencrypt/renewal/aivestor.com.cn.conf \
  "$backup/aivestor.com.cn-renewal.conf"

for file in \
  public/brand/zhongjian-zhitou/svg/logo-horizontal-color.svg \
  'src/app/(auth)/layout.tsx' \
  src/components/auth/AuthBrand.tsx \
  src/lib/brand.ts
do
  install -d -m 0700 "$backup/overlay/$(dirname "$file")"
  cp -a "$repo/$file" "$backup/overlay/$file"
done

runuser -u postgres -- pg_dump \
  --format=custom \
  --dbname=zhongjian_zhitou >"$backup/zhongjian_zhitou.dump"
test -s "$backup/zhongjian_zhitou.dump"
sha256sum "$backup/zhongjian_zhitou.dump" |
  tee "$backup/zhongjian_zhitou.dump.sha256"
printf 'Backup: %s\n' "$backup"

printf '\n===== 4. Immutable Git worktree release =====\n'
install -d -m 0755 "$release_root"
git worktree add --detach "$release" "$target"
install -m 0600 "$repo/.env.local" "$release/.env.local"

for file in \
  public/brand/zhongjian-zhitou/svg/logo-horizontal-color.svg \
  'src/app/(auth)/layout.tsx' \
  src/components/auth/AuthBrand.tsx \
  src/lib/brand.ts
do
  cp -a "$repo/$file" "$release/$file"
done

printf '%s\n' "$target" >"$release/.deployed-source"
git -C "$release" switch -c "$deploy_branch"
git -C "$release" add \
  .deployed-source \
  public/brand/zhongjian-zhitou/svg/logo-horizontal-color.svg \
  'src/app/(auth)/layout.tsx' \
  src/components/auth/AuthBrand.tsx \
  src/lib/brand.ts
git -C "$release" \
  -c user.name='Zhongjian Deploy' \
  -c user.email='deploy@aivestor.com.cn' \
  commit -m 'deploy: apply zhongjian brand overlay to deep research P2'

deploy_commit=$(git -C "$release" rev-parse HEAD)
printf 'Public source: %s\n' "$target"
printf 'White-label deployment commit: %s\n' "$deploy_commit"

printf '\n===== 5. Install, tests and build =====\n'
cd "$release"
npm ci --include=dev --no-audit --no-fund
npm run test:deep-research

export NODE_ENV=production
export NEXT_PUBLIC_BRAND_PROFILE=zhongjian-zhitou
export NEXT_PUBLIC_APP_URL=https://aivestor.com.cn
npm run build

node --env-file=.env.local \
  -r ts-node/register/transpile-only \
  -r tsconfig-paths/register <<'NODE'
const jobs = require("./src/lib/deepResearchJobs");
if (
  typeof jobs.claimNextDeepResearchJob !== "function" ||
  typeof jobs.processNextDeepResearchJob !== "function"
) {
  throw new Error("Worker module exports are incomplete");
}
console.log("PASS: deep research worker module loaded");
NODE

printf '\n===== 6. Database migrations 048-050 =====\n'
runuser -u postgres -- psql \
  --dbname=zhongjian_zhitou \
  --set=ON_ERROR_STOP=1 \
  --single-transaction \
  --file=db/migrations/048_deep_research_reports.sql \
  --file=db/migrations/049_deep_research_evidence.sql \
  --file=db/migrations/050_deep_research_jobs.sql

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

printf '\n===== 7. Web and worker cutover =====\n'
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

printf '\n===== 8. Public acceptance =====\n'
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
