# 原始碼說明

網站只有一個 `index.html`，是由這個資料夾裡的檔案組出來的。**改程式請改這裡，不要直接改 `index.html`**，改完在 repo 根目錄執行：

```
python build.py            # 重新產生 index.html
python build.py --check    # 檢查 index.html 是否由目前的 src/ 產生（GitHub 健檢也會跑）
```

`src/` 和新的 `index.html` 要一起上傳；只傳其中一個，GitHub 的健檢會擋下來不發布。

## 組成順序

`head.html` → `style.css` → `body.html` → `js-*.js`（依檔名排序）。

所有 `js-*.js` 會被放進**同一個函式**裡，所以後面的檔可以直接用前面檔定義的東西。
注意：檔案最外層的 `const`／`let` 要在「真的用到」之前就定義好（函式裡用到沒關係，頁面載入時直接執行的程式碼才要注意）。

## 各檔負責的事

| 檔案 | 內容 |
| --- | --- |
| `js-00-core.js` | 版本號、共用常數（`FPS`、預設角色）、單人狀態 `S`、`store`（瀏覽器存檔） |
| `js-01-data.js` | 讀資料：索引、`stats.json`、角色動畫（`loadUnitMeta`、`loadBullets`，單人雙人共用） |
| `js-02-library.js` | 搜尋與角色庫 |
| `js-03-unit.js` | 單人：選角色、部件、動作片段 |
| `js-04-render.js` | 單人：畫面 |
| `js-05-playback.js` | 單人：惡搞時間軸、播放迴圈；**播放音效時鐘**（`clockAdvance`，單人雙人共用） |
| `js-06-single-edit.js` | 單人：零件調整、惡搞片段、上一步／下一步 |
| `js-07-sfx.js` | 下載檔案、音效（合成、預約播放）、自己上傳的檔案（IndexedDB）、單人／雙人的音效清單 |
| `js-08-video.js` | 錄影：MP4／WebM 長度修正、離線逐格輸出、**共用錄影流程 `recordCanvas`** |
| `js-09-single-ui.js` | 單人：錄影按鈕、截圖、介面事件 |
| `js-10-duel-state.js` | 雙人：狀態 `D`、對戰類型 `KINDS`、**設定表 `DUEL_SETTINGS`**、**TIMELINE 說明**（`resetTimeline`） |
| `js-11-duel-engine.js` | 雙人：角色與召喚物載入、`compileDuel`（重新計算的入口）、經典對戰引擎、K.O. 重播 |
| `js-12-duel-sim.js` | 雙人：真距離／原始數值引擎（逐格模擬，多打多的單位模型） |
| `js-13-duel-render.js` | 雙人：畫面（只讀 TIMELINE）、倒數、結果文字 |
| `js-14-duel-ui.js` | 雙人：播放／倒數狀態、招式編排、錄影、`initDuel`（讀存檔與分享連結） |
| `js-15-duel-panel.js` | 雙人：真距離／原始數值設定面板、金手指、重新對戰、全部恢復預設 |
| `js-16-share.js` | 分享連結、專案檔（`PROJECT_VER`、`migrateProject`） |
| `js-17-boot.js` | 回報資訊、唯讀測試介面 `window.__rk`、啟動 |
| `js-18-fight-data.js` | 格鬥場（測試版）：**全部數值 `FT`**、招式操作方式 `AIM_MODE`、自製角色手寫數值、角色名單、官方角色換算 `fightStats` |
| `js-18-fight-data-fx.js` | 格鬥場：**效果設定 `FX_TABLE`、最大等級 `FX_MAXLEVEL`**（由 `tools/gen_fx_table.py` 自動產生，不要手改） |
| `js-18-fight-norm.js` | 格鬥場：**角色資料標準化（解讀層）** `normUnit`：每個欄位的狀態與出處、攻擊形式、效果清單、哪些還不支援；相容性報告 `normAll` |
| `js-18-fight-effects.js` | 格鬥場：**技能效果模組** `FIGHT_FX`（每種效果代碼一筆：對象、套用方式）、效果數字 `FX_NUM`、狀態倒數 `fxTick` |
| `js-18-fight-engine.js` | 格鬥場：規則引擎 `fightStep`（每步 1/60 秒、只吃按鍵＋固定亂數，同樣輸入＝同樣結果）、電腦對手 `fightAi` |
| `js-19-fight-ui.js` | 格鬥場：選角、觸控與鍵盤 → 按鍵、畫面、回合流程 |

## 雙人對戰的資料流

```
使用者操作／存檔／分享連結
        │  （都經過設定表 DUEL_SETTINGS 整理）
        ▼
   D 的設定欄位 ──► compileDuel()
                      ├─ resetTimeline()      清掉上一次的結果
                      ├─ compileOnce()        經典對戰   ┐ 只寫 TIMELINE 欄位，
                      └─ compileReal()        真距離／原始數值 ┘ 不碰網頁畫面
                      ▼
                 TIMELINE（D.len、events、tracks、frames、summons…）
                      ├─ renderDuel(k)        畫第 k 格
                      ├─ duelSfxList()        音效時間表
                      └─ recordCanvas()       錄影（逐格輸出或即時錄影）
```

## 常見修改

- **新增一個雙人設定**：在 `js-10-duel-state.js` 的 `DUEL_SETTINGS` 加一筆（預設值、整理規則、網址代號、恢復預設時機），
  再到 `body.html` 加輸入框、`js-15-duel-panel.js` 綁事件（用 `setDuelSetting`）、`syncDuelInputs` 把值放回輸入框。
  存檔、專案檔、分享連結、交換左右都不用另外改。網址代號不能跟現有的重複，並記得在 CHANGELOG 的規格小抄寫上。
- **對戰計算改變**：改 `js-11`／`js-12`。刻意改變結果時，用 `node tests/healthcheck.mjs <網站資料夾> --update-baseline` 重記標準答案。
- **新增錄影的地方**：呼叫 `recordCanvas`，不要再寫一份錄影流程。
- **格鬥場的角色解讀**（某種攻擊形式、效果怎麼判斷）：改 `js-18-fight-norm.js`；改完跑 `node tools/fight_compat.mjs <網站資料夾>` 看全部角色的相容性報告。
- **格鬥場改某個效果的做法或數字**：改格鬥場效果決定表（或 `tools/fight_effects_decisions.json`）→ `python tools/gen_fx_table.py` → `python build.py`。
- **格鬥場新增一種技能效果的做法**：在 `js-18-fight-effects.js` 的 `FX_BEHAVIOR` 加一筆，並在 `tools/gen_fx_table.py` 的 `NEW_MAP` 指給對應的效果代碼（標準化層、相容性報告會自動把它當成已支援），數字放 `FX_NUM`；需要畫面標籤就加進 `FX_STATUS_TAG`。效果整理表見 `FIGHT_EFFECTS.md`。
- **格鬥場調平衡**：只改 `js-18-fight-data.js`（`FT` 是全體規則、`FIGHT_PRESET` 是自製角色）。改規則時每個機制在 engine 裡各有一個函式（`fightGuard`、`fightHit`、`fightAims`…），
  用 `window.__rk.fightRun(spec)` 跑固定輸入確認（健檢也用它）。
- **召喚物系列對應**（資料命名對不上時）：改 repo 根目錄的 `sync_overrides.json`，不用改 `sync.py`。
