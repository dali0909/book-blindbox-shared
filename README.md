# 看一本有一本的欢喜（共享版）

这是“图书盲盒池”的共享部署版：

- 前端：`public/` 静态网页（盲盒池 + 开箱 + 封面展示）
- 后端：`server/` Node.js + PostgreSQL/SQLite（共享书库，所有人看到同一个池子）
- 存储：线上优先使用 `DATABASE_URL` 连接 PostgreSQL，刷新、重启、重新部署后仍保留书库；本地未配置时回退 SQLite。
- 权限：当前默认公开编辑，知道网址的人都能增删改书库；如需只允许你编辑，可设置 `PUBLIC_EDIT=false` 并配置 `ADMIN_TOKEN`。

## 本地运行

1) 安装依赖

```bash
cd /Users/dali/Documents/Playground/book-blindbox-shared
npm install
```

2) 配置环境变量

```bash
cp .env.example .env
```

本地开发可以不填 `DATABASE_URL`，会自动使用 `./data/blindbox.sqlite`。

3) 启动

```bash
npm run dev
```

打开：

- `http://localhost:3000/`（盲盒池）
- `http://localhost:3000/library.html`（书库；当前默认可直接编辑）

## 部署（Render 一键）

见 `DEPLOY_RENDER.md`。
