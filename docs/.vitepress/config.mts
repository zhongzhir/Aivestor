import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'Aivestor',
  description: '以投资人为中心，AI 赋能投资人持续进化',
  base: '/',

  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    ['meta', { name: 'theme-color', content: '#f97316' }]
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Aivestor',

    nav: [
      { text: '快速开始', link: '/guide/getting-started' },
      { text: '功能说明', link: '/features/overview' },
      { text: '部署指南', link: '/deploy/saas' },
      { text: '常见问题', link: '/faq/product' },
      { text: '立即体验', link: 'https://aivestor.cn' }
    ],

    sidebar: {
      '/guide/': [
        {
          text: '入门',
          items: [
            { text: '什么是 Aivestor', link: '/guide/introduction' },
            { text: '快速开始', link: '/guide/getting-started' },
          ]
        }
      ],
      '/features/': [
        {
          text: '功能说明',
          items: [
            { text: '功能概览', link: '/features/overview' },
            { text: '项目分析', link: '/features/project-analysis' },
            { text: '私有知识库', link: '/features/knowledge-base' },
            { text: 'SKILL 广场', link: '/features/skills' },
            { text: '项目档案', link: '/features/archive' },
          ]
        }
      ],
      '/deploy/': [
        {
          text: '部署指南',
          items: [
            { text: 'SaaS 版（推荐）', link: '/deploy/saas' },
            { text: 'Docker 本地部署', link: '/deploy/docker' },
          ]
        }
      ],
      '/faq/': [
        {
          text: '常见问题',
          items: [
            { text: '产品认知', link: '/faq/product' },
            { text: '与通用 AI 的比较', link: '/faq/comparison' },
            { text: '数据与安全', link: '/faq/security' },
            { text: '使用问题', link: '/faq/usage' },
            { text: '机构用户', link: '/faq/enterprise' },
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/zhongzhir/aivestor' }
    ],

    footer: {
      message: '基于 MIT 协议开源',
      copyright: 'Copyright © 2026 Aivestor · <a href="https://aivestor.cn">aivestor.cn</a> · 京ICP备2026011107号-3'
    },

    search: {
      provider: 'local'
    }
  }
})
