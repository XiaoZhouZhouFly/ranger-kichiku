# Ranger 鬼畜工坊
### 👉 [點這裡開啟網站](https://xiaozhouzhoufly.github.io/ranger-kichiku/)
輸入 LINE Rangers 角色名稱，播放技能、移動等動作，調整個別零件，剪成鬼畜影片輸出。

非官方粉絲工具，與 LINE 無關。角色美術版權屬於 LINE；動畫資料每日同步自 [LINE Rangers 資料站](https://rangerbook.warmycat.com/)（蚯蚓貓）的公開素材庫。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `index.html` | 網站本體 |
| `sync.py` | 同步程式：從上游抓新角色、精簡壓縮後存進 `data/` |
| `.github/workflows/sync.yml` | 每天自動執行同步並發布網站 |
| `data/` | 同步下來的角色資料（自動產生，不用手動改） |

## 運作方式

- 每天台灣時間 03:17 自動檢查上游，有新角色或更新才下載變動的部分。
- 只新增、不刪除：上游刪檔或消失時，已同步的角色全部保留，網站照常運作。
- 上游連不上時會跳過，不會清空現有資料。
- 想立刻更新：到 **Actions → 同步角色資料並發布網站 → Run workflow**。

## 注意

- 公開 repo 若 60 天沒有任何更新，GitHub 會暫停排程並寄信通知，到 Actions 頁面按 **Enable workflow** 即可恢復。
- 資料約 570 MB，在 GitHub Pages 1 GB 上限內。
