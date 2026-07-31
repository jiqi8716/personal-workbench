# 个人工作台

一个纯前端的个人工作台，可管理待办、Markdown 笔记、日程和长期目标。

## 使用

直接打开 `index.html`，或访问：

https://jiqi8716.github.io/personal-workbench/

工作台采用本地优先存储：所有修改先写入当前浏览器的 `localStorage`，登录后再通过 Supabase 自动同步。网络不可用时仍可编辑，恢复连接后会补传本地同步队列。

数据库结构和 RLS 策略位于 `supabase/schema.sql`。浏览器端只使用 Supabase Publishable Key，所有云端数据访问均由 RLS 按用户隔离。

首次同步时，点击顶部的“仅本地”，用邮箱注册并完成邮箱验证。之后在其他设备上使用同一邮箱和密码登录即可。

## 技术

- 原生 HTML、CSS 和 JavaScript
- [Marked](https://marked.js.org/) 用于 Markdown 卡片预览（浏览器文件已随站点托管）
- [Vditor](https://b3log.org/vditor/) 用于即时渲染 Markdown 编辑（MIT 协议，浏览器文件已随站点托管）
- [Supabase](https://supabase.com/) 用于邮箱登录和跨设备同步
- 无需构建步骤
