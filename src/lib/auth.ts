import {
  getServerSession as nextGetServerSession,
  type NextAuthOptions,
} from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { query } from "@/lib/db";
import {
  verifyPhoneCode,
  isValidPhone,
  findOrCreatePhoneUser,
} from "@/lib/authUtils";

interface DbUser {
  id: string;
  email: string | null;
  name: string;
  password_hash: string | null;
  image_url: string | null;
}

// 登录失败限流：同一标识 15 分钟内失败 5 次即锁定。
const MAX_ATTEMPTS = 5;

// GitHub OAuth 为可选项：仅当配置了 Client ID/Secret 时才启用。
const githubEnabled =
  !!process.env.GITHUB_CLIENT_ID && !!process.env.GITHUB_CLIENT_SECRET;

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "邮箱密码",
      credentials: {
        email: { label: "邮箱", type: "email" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        const email = credentials.email.toLowerCase().trim();

        // 登录限流：统计过去 15 分钟内的失败次数
        const recent = await query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM login_attempts
            WHERE identifier = $1
              AND attempted_at > NOW() - INTERVAL '15 minutes'`,
          [email]
        );
        if (Number(recent[0]?.count ?? 0) >= MAX_ATTEMPTS) {
          throw new Error("登录失败次数过多，请 15 分钟后重试");
        }

        const rows = await query<DbUser>(
          "SELECT id, email, name, password_hash, image_url FROM users WHERE email = $1",
          [email]
        );
        const user = rows[0];
        const ok = user?.password_hash
          ? await bcrypt.compare(credentials.password, user.password_hash)
          : false;

        if (!ok) {
          await query(
            "INSERT INTO login_attempts (identifier) VALUES ($1)",
            [email]
          );
          return null;
        }

        // 登录成功：清除该标识的失败记录
        await query("DELETE FROM login_attempts WHERE identifier = $1", [
          email,
        ]);
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image_url,
        };
      },
    }),
    CredentialsProvider({
      id: "phone",
      name: "手机验证码",
      credentials: {
        phone: { label: "手机号", type: "text" },
        code: { label: "验证码", type: "text" },
      },
      async authorize(credentials) {
        const phone = credentials?.phone?.trim();
        const code = credentials?.code?.trim();
        if (!phone || !code || !isValidPhone(phone)) return null;

        // 登录限流（手机号维度）
        const recent = await query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM login_attempts
            WHERE identifier = $1
              AND attempted_at > NOW() - INTERVAL '15 minutes'`,
          [phone]
        );
        if (Number(recent[0]?.count ?? 0) >= MAX_ATTEMPTS) {
          throw new Error("登录失败次数过多，请 15 分钟后重试");
        }

        const ok = await verifyPhoneCode(phone, code, "login", true);
        if (!ok) {
          await query(
            "INSERT INTO login_attempts (identifier) VALUES ($1)",
            [phone]
          );
          return null;
        }

        // 手机号未注册时静默创建账号，登录即注册一步完成
        const user = await findOrCreatePhoneUser(phone);

        await query("DELETE FROM login_attempts WHERE identifier = $1", [
          phone,
        ]);
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image_url,
        };
      },
    }),
    ...(githubEnabled
      ? [
          GitHubProvider({
            clientId: process.env.GITHUB_CLIENT_ID!,
            clientSecret: process.env.GITHUB_CLIENT_SECRET!,
          }),
        ]
      : []),
  ],
  callbacks: {
    // GitHub 登录：users 表是唯一存储，登录时按邮箱 upsert。
    async signIn({ user, account }) {
      if (account?.provider !== "github") return true;
      const email = user.email?.toLowerCase().trim();
      if (!email) return false;

      await query(
        `INSERT INTO users (email, name, auth_provider, image_url)
         VALUES ($1, $2, 'github', $3)
         ON CONFLICT (email) DO UPDATE SET image_url = EXCLUDED.image_url`,
        [email, user.name ?? email, user.image ?? null]
      );
      return true;
    },
    // 首次登录时把数据库用户 id 写入 JWT，并把 plan 同步进 token
    // （供 middleware 在 Edge 运行时做 /admin 快路径校验；服务端最终仍以 DB 现取为准）。
    async jwt({ token, user, account }) {
      if (user) {
        if (account?.provider === "github") {
          // GitHub OAuth：user.id 是 GitHub 的 id，需按邮箱回查数据库 id
          const email = (user.email ?? token.email)?.toLowerCase().trim();
          if (email) {
            const rows = await query<{ id: string; plan: string }>(
              "SELECT id, plan FROM users WHERE email = $1",
              [email]
            );
            if (rows[0]) {
              token.uid = rows[0].id;
              token.plan = rows[0].plan;
            }
          }
        } else {
          // credentials / phone：authorize 返回的 user.id 即数据库 id
          token.uid = user.id;
          const rows = await query<{ plan: string }>(
            "SELECT plan FROM users WHERE id = $1",
            [user.id]
          );
          if (rows[0]) token.plan = rows[0].plan;
        }
      }
      // 机构版：每次 callback 都重读 org_members，注入组织信息。
      // 授权以 Node 层 orgAuth.getOrgContext（DB 现取）为准，token 仅作
      // middleware 快路径与前端 UI 提示——成员被移出后 token 残留的 orgId
      // 最多产生一次 302/403，不泄露数据（架构文档 v1.1 第 1.4 节）。
      // TODO(perf): 本查询与同请求内 getOrgContext 重复（useSession 轮询也会
      // 触发）。当前单 ECS 低并发无感；若将来成为热点，优化方向是 token 内记
      // orgCheckedAt 时间戳、距上次检查超过 60s 才重读 org_members。
      if (token.uid) {
        try {
          const rows = await query<{ org_id: string; role: string }>(
            "SELECT org_id, role FROM org_members WHERE user_id = $1",
            [token.uid as string]
          );
          token.orgId = rows[0]?.org_id;
          token.orgRole = rows[0]?.role;
        } catch {
          // 迁移 020 未执行时表不存在：静默跳过，个人版行为不变
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.uid) {
        session.user.id = token.uid as string;
      }
      // plan 也透出到 session，供前端做 UI 切换（如显示「进入管理后台」入口）
      if (session.user && typeof token.plan === "string") {
        (session.user as { plan?: string }).plan = token.plan;
      }
      // 组织信息透出（与 plan 同方式）：仅供前端 UI 切换（如「组织设置」入口），
      // 授权判断永远走服务端 orgAuth DB 现取
      if (session.user && typeof token.orgId === "string") {
        session.user.orgId = token.orgId;
      }
      if (session.user && typeof token.orgRole === "string") {
        session.user.orgRole = token.orgRole;
      }
      return session;
    },
  },
};

// 服务端组件/路由中获取会话
export function getSession() {
  return nextGetServerSession(authOptions);
}

// 路由保护：未登录则重定向到登录页（用于服务端组件）
export async function requireAuth() {
  const session = await getSession();
  if (!session?.user) {
    redirect("/login");
  }
  return session;
}
