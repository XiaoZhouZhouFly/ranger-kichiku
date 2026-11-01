# Ranger 惡搞工坊

<p align="center">
  <a href="https://xiaozhouzhoufly.github.io/ranger-kichiku/"><img src="https://img.shields.io/badge/%E9%96%8B%E5%95%9F%E7%B6%B2%E7%AB%99-%E9%BB%9E%E6%88%91-ff5a5f?style=for-the-badge&logo=googlechrome&logoColor=white" alt="開啟網站"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/%E6%9B%B4%E6%96%B0%E6%97%A5%E8%AA%8C-v4.2-2f80ed?style=for-the-badge&logo=readthedocs&logoColor=white" alt="更新日誌 v4.2"></a>
</p>

### 👉 [點這裡開啟網站](https://xiaozhouzhoufly.github.io/ranger-kichiku/)

輸入 LINE Rangers 角色名稱，播放技能、移動等動作，調整個別零件，剪成惡搞影片輸出。

非官方粉絲工具，與 LINE 無關。角色美術版權屬於 LINE；動畫資料每日同步自 [LINE Rangers 資料站](https://rangerbook.warmycat.com/)（蚯蚓貓）的公開素材庫。

## 最近更新（v4.2）

- 原始數值加入技能抗性：受到的技能傷害照 % 減少，不影響普通攻擊。
- 金手指可以分別調整普攻與技能的閃避、命中，以及技能抗性。

📜 [完整版本更新日誌](CHANGELOG.md)

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `index.html` | 網站本體 |
| `sync.py` | 同步程式：從上游抓新角色、精簡壓縮後存進 `data/` |
| `.github/workflows/sync.yml` | 每天自動執行同步並發布網站 |
| `CHANGELOG.md` | 版本更新日誌 |
| `data/` | 同步下來的角色資料（自動產生，不用手動改） |

## 運作方式

- 每天台灣時間 03:17 自動檢查上游，有新角色或更新才下載變動的部分。
- 只新增、不刪除：上游刪檔或消失時，已同步的角色全部保留，網站照常運作。
- 上游連不上時會跳過，不會清空現有資料。
- 想立刻更新：到 **Actions → 同步角色資料並發布網站 → Run workflow**。

## 注意

- 公開 repo 若 60 天沒有任何更新，GitHub 會暫停排程並寄信通知，到 Actions 頁面按 **Enable workflow** 即可恢復。
- 資料約 570 MB，在 GitHub Pages 1 GB 上限內。
