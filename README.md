# 听障就诊助手

三端联动演示系统：护士分诊台 + 患者手环端 + 患者手表端。

## 一键部署到 Render（免费，24 小时在线）

点击下方按钮，按提示操作即可：

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Phoenix-0812/deaf-care-assistant)

部署完成后会得到一个公网地址（如 `https://deaf-care-assistant.onrender.com`），三个端的入口：

- 护士端：`/`（手机形态工作台）
- 手环端：`/band/`（细长竖屏手环）
- 手表端：`/watch/`（方屏手表）

## 本地运行

```bash
node server.js
# 打开 http://localhost:3000
```
