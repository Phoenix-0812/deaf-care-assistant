# 听障就诊助手

双端联动演示系统：护士分诊台 + 患者手表端（手机 / 手表均可打开）。

## 一键部署到 Render（免费，24 小时在线）

点击下方按钮，按提示操作即可：

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Phoenix-0812/deaf-care-assistant)

部署完成后会得到一个公网地址（如 `https://deaf-care-assistant.onrender.com`），两个端的入口：

- 护士端：`/`（分诊工作台）
- 手表端：`/watch/`（患者侧，含楼层地图导航）

## 本地运行

```bash
node server.js
# 打开 http://localhost:3000
```
