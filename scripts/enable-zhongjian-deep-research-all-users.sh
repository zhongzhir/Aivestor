#!/usr/bin/env bash

set -eEuo pipefail
umask 077

repo=/var/www/zhongjian-zhitou
target=d56efa56eec2554d182ed1a9a10d5569b8ccdc91
release=/var/www/zhongjian-releases/$target
expected_deploy_commit=8625befc4e67ffe2c7978bf4a46c3ec2c629b47f
backup=/var/backups/zhongjian-deep-research-access/$(date +%Y%m%d-%H%M%S)
repo_env="$repo/.env.local"
release_env="$release/.env.local"
changed=0

restore_on_error() {
  code=$?
  trap - ERR
  set +e

  if [ "$changed" = 1 ]; then
    cp -a "$backup/repo.env.local" "$repo_env"
    cp -a "$backup/release.env.local" "$release_env"
    pm2 restart zhongjian-zhitou --update-env >/dev/null 2>&1
    pm2 restart zhongjian-zhitou-deep-research --update-env >/dev/null 2>&1
    pm2 save >/dev/null 2>&1
    printf 'Configuration restored after failed acceptance.\n'
  fi

  exit "$code"
}
trap restore_on_error ERR

printf '===== 1. Access rollout preflight =====\n'
test -f "$repo_env"
test -f "$release_env"
test "$(git -C "$release" rev-parse HEAD)" = "$expected_deploy_commit"
test "$(cat "$release/.deployed-source")" = "$target"

node --env-file="$release_env" <<'NODE'
const pg = require("pg");
(async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const result = await client.query(
    "SELECT count(*)::int AS count FROM deep_research_jobs WHERE status IN ('queued','running')"
  );
  await client.end();
  if (result.rows[0].count !== 0) {
    throw new Error(`Active deep research jobs: ${result.rows[0].count}`);
  }
  console.log("PASS: no active deep research jobs");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
NODE

install -d -m 0700 "$backup"
cp -a "$repo_env" "$backup/repo.env.local"
cp -a "$release_env" "$backup/release.env.local"
printf 'Environment backup: %s\n' "$backup"

update_access() {
  file=$1
  if grep -q '^DEEP_RESEARCH_BETA_USER_IDS=' "$file"; then
    sed -i 's/^DEEP_RESEARCH_BETA_USER_IDS=.*/DEEP_RESEARCH_BETA_USER_IDS="*"/' "$file"
  else
    printf '\nDEEP_RESEARCH_BETA_USER_IDS="*"\n' >>"$file"
  fi
  chmod 0600 "$file"
}

update_access "$repo_env"
update_access "$release_env"
changed=1

printf '\n===== 2. Restart Web and worker =====\n'
pm2 restart zhongjian-zhitou --update-env
pm2 restart zhongjian-zhitou-deep-research --update-env

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
sleep 2

printf '\n===== 3. Access and service acceptance =====\n'
cd "$release"
node --env-file=.env.local \
  -r ts-node/register/transpile-only \
  -r tsconfig-paths/register <<'NODE'
const { isDeepResearchBetaWhitelisted } = require("./src/lib/deepResearchAccess");
if (process.env.DEEP_RESEARCH_BETA_USER_IDS !== "*") {
  throw new Error("White-label access flag is not enabled");
}
if (!isDeepResearchBetaWhitelisted("any-registered-user")) {
  throw new Error("Registered-user access gate did not open");
}
console.log("PASS: all authenticated Zhongjian users are allowed");
NODE

web_pid=$(pm2 pid zhongjian-zhitou | tail -1)
worker_pid=$(pm2 pid zhongjian-zhitou-deep-research | tail -1)
printf '%s' "$web_pid" | grep -Eq '^[1-9][0-9]*$'
printf '%s' "$worker_pid" | grep -Eq '^[1-9][0-9]*$'
test "$(readlink -f "/proc/$web_pid/cwd")" = "$release"
test "$(readlink -f "/proc/$worker_pid/cwd")" = "$release"

curl --fail --silent --show-error --max-time 15 \
  https://aivestor.com.cn/api/health
printf '\n'

pm2 save
pm2 list

changed=0
trap - ERR

printf '\nZHONGJIAN_DEEP_RESEARCH_ALL_REGISTERED_USERS_ENABLED\n'
printf 'Scope: aivestor.com.cn authenticated users\n'
printf 'Main site aivestor.cn: unchanged\n'
printf 'Environment backup: %s\n' "$backup"
