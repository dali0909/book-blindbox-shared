# 部署到公网（Render + PostgreSQL 持久书库）

目标：把项目部署成公网网站，所有人都能看到同一个“图书盲盒池”，并且录入的图书不会因为页面刷新、服务休眠或重新部署而丢失。

## 存储方式

- 线上：Render PostgreSQL，通过 `DATABASE_URL` 持久保存书库。
- 本地：未配置 `DATABASE_URL` 时，自动回退到 SQLite 文件 `./data/blindbox.sqlite`。
- 注意：Render 免费 PostgreSQL 适合测试，会有期限限制；长期个人网站建议升级为付费数据库。

## Render Blueprint

`render.yaml` 会创建：

- `book-blindbox-shared`：Node Web Service
- `book-blindbox-db`：PostgreSQL 数据库
- `DATABASE_URL`：自动注入到 Web Service

## 访问与管理

- 网站：`https://book-blindbox-shared.onrender.com`
- 书库：`https://book-blindbox-shared.onrender.com/library.html`
- 当前默认公开编辑：知道网址的人都能增删改书库。
- 如需只允许你编辑：在 Render 环境变量里设置 `PUBLIC_EDIT=false`，并设置 `ADMIN_TOKEN`。

## 重要说明

- “书库数据”保存在服务器数据库中，刷新/换设备/重启后仍会保留。
- “正在读/完成/历史记录”仍保存在每个访客自己的浏览器里，不会互相影响。
