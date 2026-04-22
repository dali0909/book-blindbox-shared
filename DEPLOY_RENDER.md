# 部署到公网（Render + SQLite 磁盘）

目标：把这个项目部署成一个公网网站，**所有人都能看到同一个“盲盒池”**，但只有你能改书库。

## 0. 准备

- 一个 GitHub 账号
- 一个 Render 账号（用 GitHub 登录最省事）

## 1. 把项目推到 GitHub

在终端执行（把 `<REPO>` 换成你要的仓库名）：

```bash
cd /Users/dali/Documents/Playground/book-blindbox-shared
git init
git add .
git commit -m "init shared blindbox"
git branch -M main
```

然后在 GitHub 新建仓库（例如 `<REPO>`），按 GitHub 页面提示把远程仓库地址复制出来，再执行：

```bash
git remote add origin <YOUR_GIT_URL>
git push -u origin main
```

## 2. 在 Render 创建服务

1) 打开 Render 新建 Web Service  
2) 选择刚才的 GitHub 仓库  
3) Render 会自动识别 `render.yaml`（Blueprint），按提示创建

创建成功后，Render 会给你一个公网域名，例如：

`https://book-blindbox-shared.onrender.com`

## 3. 设置管理员口令（重要）

在 Render 的 Service → Environment 里设置：

- `ADMIN_TOKEN`：一段随机长字符串（这就是你的管理口令）

保存后会触发一次重新部署。

## 4. 访问与管理

- 任何人打开首页：都能看到盲盒池、开箱、封面
- 你要编辑书库：
  1) 打开 `https://你的域名/library.html`
  2) 在顶部的 `Admin Token` 输入框填入你设置的 `ADMIN_TOKEN`
  3) 点“保存口令”，状态变成“已解锁管理”后就能增删改

## 5. 说明（非常关键）

- 共享的只有“书库数据”（由后端 SQLite 提供）
- “正在读/完成/历史记录”仍然是**每个访客自己浏览器本地**的数据（不会互相影响）

