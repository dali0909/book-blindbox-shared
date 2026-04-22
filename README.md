# 看一本有一本的欢喜（共享版）

这是“图书盲盒池”的共享部署版：

- 前端：`public/` 静态网页（盲盒池 + 开箱 + 封面展示）
- 后端：`server/` Node.js + SQLite（共享书库，所有人看到同一个池子）
- 权限：**只有你**持有 `ADMIN_TOKEN` 才能增删改书库；其他访问者只能看与开箱（他们的“正在读/完成/历史”仍是本地浏览器自己的）。

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

编辑 `.env`，把 `ADMIN_TOKEN` 改成一段随机长字符串。

3) 启动

```bash
npm run dev
```

打开：

- `http://localhost:3000/`（盲盒池）
- `http://localhost:3000/library.html`（书库；右上角填 Admin Token 才能编辑）

## 部署（Render 一键）

见 `DEPLOY_RENDER.md`。

