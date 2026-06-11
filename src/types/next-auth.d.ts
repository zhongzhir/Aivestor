import type { DefaultSession } from "next-auth";

// 扩展 Session.user，加入数据库用户 id 与组织信息。
// orgId / orgRole 仅供前端 UI 切换；服务端授权永远走 orgAuth DB 现取。
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      orgId?: string;
      orgRole?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    orgId?: string;
    orgRole?: string;
  }
}
