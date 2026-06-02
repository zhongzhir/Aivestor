# 2026-06-02 · HTTPS 上线 · aivestor.cn 切换

> 起因：aivestor.cn 备案完成（京ICP备2026011107号-3），阿里云免费 SSL 证书
> 已上传至 ECS。本次把主生产地址从 `http://x.x.x.x` 切到
> `https://aivestor.cn`，完成 §九"阻断性问题"中的"域名切换"项。

执行机器：阿里云 ECS（x.x.x.x，Ubuntu 22.04，nginx 1.18.0）
切换时间：2026-06-02 上午

---

## 一、切换前现状

`/etc/nginx/sites-enabled/aivestor`（旧）：
```nginx
server {
    listen 80;
    server_name x.x.x.x;
    client_max_body_size 30m;
    location / {
        proxy_pass http://localhost:3000;
        # ... 标准代理头，无 X-Forwarded-Proto
    }
}
```

同目录还启用着 nginx 默认 `default` site（仅欢迎页）。

证书在位：
```
-rw-r--r-- 1 root root 1675 Jun  2 11:02 /etc/nginx/ssl/aivestor/aivestor.cn.key
-rw-r--r-- 1 root root 3818 Jun  2 11:02 /etc/nginx/ssl/aivestor/aivestor.cn.pem
```

---

## 二、本次改动

### Nginx 新配置（重点 diff）

新 `/etc/nginx/sites-enabled/aivestor` 由 3 个 server 块组成：

1. **80 端口 default_server**：吃下所有 80 请求（含 IP 直访），全部 `return 301 https://aivestor.cn$request_uri`；预留 `/.well-known/acme-challenge/` 给未来 Let's Encrypt 续签
2. **443 主站**：`ssl http2`，TLSv1.2/1.3，HIGH cipher，session cache 10m；location 同旧版反代 `localhost:3000`，但补 `X-Forwarded-Proto https`
3. **www 子域**：单独 server 块，443 ssl，return 301 到裸域

`default_server` 标签搬到我们这边，并 `rm /etc/nginx/sites-enabled/default`，避免欢迎页抢 IP 流量。

### 服务端环境

`/var/www/Aivestor/.env.local` 两行：
```diff
- NEXTAUTH_URL=http://x.x.x.x
- NEXT_PUBLIC_APP_URL=http://x.x.x.x
+ NEXTAUTH_URL=https://aivestor.cn
+ NEXT_PUBLIC_APP_URL=https://aivestor.cn
```

`NEXT_PUBLIC_*` 是 Next.js 构建期注入，必须 `npm run build` + `pm2 restart aivestor` 才生效。

### 故意没做的事

- **HSTS**：留到 HTTPS 跑稳 1~2 天再开 `Strict-Transport-Security`，避免证书出
  问题时无法回滚 HTTP（HSTS 一旦写入用户浏览器即生效，无法远程撤销）
- **80 → 443 OCSP stapling**：阿里云免费证书未带 OCSP，不必配
- **TLS 1.0/1.1 显式禁用**：已经默认禁，nginx 1.18 不再开

---

## 三、执行序列与结果

```bash
sudo cp /etc/nginx/sites-enabled/aivestor /etc/nginx/sites-enabled/aivestor.bak.20260602
sudo nano /etc/nginx/sites-enabled/aivestor      # 覆盖
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t                                    # warn 但 OK
sudo systemctl reload nginx
cd /var/www/Aivestor && npm run build            # NEXT_PUBLIC_APP_URL 重注入
pm2 restart aivestor
```

`nginx -t` 的 warn 是 default site 与新配置都监听了 IP 80 上的 `x.x.x.x`，
`rm default` 后下次 reload 即消，无害。

`npm run build` 警告与本次切换无关：
- `officeparser/moduleLoader` 动态 require（V2 起就有，已忽略）
- `/api/skills/catalog` dynamic-server-usage（V2.9 后引入，已忽略）

PM2 重启正常，新 pid 25739，进程 online。

---

## 四、烟测（4/4 通过）

```
$ curl -I http://aivestor.cn
HTTP/1.1 301 Moved Permanently
Location: https://aivestor.cn/

$ curl -I http://x.x.x.x
HTTP/1.1 301 Moved Permanently
Location: https://aivestor.cn/

$ curl -I https://aivestor.cn
HTTP/2 200
server: nginx/1.18.0 (Ubuntu)
x-frame-options: DENY
x-content-type-options: nosniff
referrer-policy: strict-origin-when-cross-origin
permissions-policy: camera=(), microphone=(), geolocation=()

$ curl -I https://www.aivestor.cn
HTTP/2 301
location: https://aivestor.cn/
```

next.config.mjs 在 V2.5 配的安全响应头都跟随到 HTTPS 主站了，含 CSP-adjacent
头集合（X-Frame-Options/X-Content-Type-Options/Referrer-Policy/Permissions-Policy）。

---

## 五、回滚步骤（如证书或 reload 出问题）

```bash
# 还原 nginx 配置
sudo cp /etc/nginx/sites-enabled/aivestor.bak.20260602 /etc/nginx/sites-enabled/aivestor
# 还原 .env.local 两行回 http://x.x.x.x
sudo nano /var/www/Aivestor/.env.local
# 重建并重启
cd /var/www/Aivestor && npm run build && pm2 restart aivestor
sudo nginx -t && sudo systemctl reload nginx
```

未开 HSTS 是为了让这套回滚步骤随时可用——浏览器不会强制升级 https。

---

## 六、配套站点底脚 + ICP

V3.1.1 末（commit `7279b39`）已经做完：
- 新建 `src/components/Footer.tsx`：居中 `color: #666 fontSize: 13px`，包含
  「aivestor.cn · Aivestor@qq.com · 北京链上文投有限公司」+ 「京ICP备2026011107号-3」
- ICP 链接 `https://beian.miit.gov.cn`，`target="_blank" rel="noopener noreferrer"`
- LandingPage 删除旧内联底脚行，引用 `<Footer />`

目前 Footer 只在 LandingPage 展示。若要让登录页 / 应用内页也展示，分别在
`src/app/(auth)/layout.tsx` 与 `src/app/(app)/layout.tsx` 引入即可，本次未做。

---

## 七、后续待办

| 项 | 说明 | 何时做 |
|----|------|-------|
| HSTS | nginx 443 块加 `add_header Strict-Transport-Security "max-age=15552000; includeSubDomains" always;` | HTTPS 跑稳 1~2 天后 |
| OSS CORS | 阿里云控制台 OSS bucket `aivestor` 的 CORS 来源加 `https://aivestor.cn`（保留旧的 `http://x.x.x.x` 一段时间作为兜底） | 立即（手动） |
| 证书续签 | 阿里云免费证书 1 年期，到期前 30 天换；或切 Let's Encrypt 自动续签 | 2027-06 前 |
| Footer 扩到全站 | 登录页 / 应用内页也加 Footer，满足 ICP "每页底部"严格合规 | 视监管反馈 |
