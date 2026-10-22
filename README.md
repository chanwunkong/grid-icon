# 格點幾何 Icon

在格點上畫 icon 的網頁工具（Vite + TypeScript，不使用前端框架）。手機和電腦都能用。

## 核心理念

- 只能在格點上定位；其他的點都是兩條曲線的交點。
- 只有兩種曲線：直線和圓。圓弧是用直線（或不會匯出的「輔助線」）切開圓，再刪掉不要的片段做出來的。
- **精確層**：交點、切分、封閉區域判定全部用精確數學（BigInt 有理數，以及 p + q√d），不用浮點容差。
- **渲染層**：只有畫到 Canvas 和匯出時才轉成浮點。

## 開發（Windows PowerShell）

```powershell
npm install
npm run dev        # 開發伺服器，打開終端機顯示的網址
npm test           # 單元測試（vitest）
npm run build      # 建置到 dist\
```

## 操作

| 工具 | 電腦 | 手機 |
|---|---|---|
| 直線 / 圓 | 按下 → 拖到終點 → 放開（L / C） | 單指按住拖曳，放開才放下 |
| 輔助線 | G 切換；選取後可把一條線改成輔助線 | 「輔助線」按鈕 |
| 選取 | 點一段（交點之間的部分）（V） | 點一段 |
| 只刪這一段 / 刪整條 | Delete / Shift+Delete | 「刪這段」「刪整條」 |
| 填色 | 點封閉區域（B） | 點封閉區域 |
| 縮放 / 平移 | 滾輪；空白鍵或中鍵、右鍵拖曳 | 雙指捏合、拖曳 |
| 復原 / 重做 | Ctrl+Z / Ctrl+Shift+Z、Ctrl+Y | 上方按鈕 |

定位點可以放在畫布外（四周各一個畫布大小的範圍），匯出時只輸出畫布範圍。

## 專案檔（JSON）

存格數、曲線（整數格點）、線條樣式、被刪的片段（兩端的精確座標）、填色（區域內一個精確的有理數代表點）。交點每次重算。

## 程式結構

- `src/exact/`：精確數學（有理數、p + q√d、交點、平面圖 / 半邊結構、封閉面、點的定位）
- `src/model/`：專案資料、讀寫、復原
- `src/editor/`：工具和操作
- `src/view/`：Canvas 繪製（填色、串接路徑、交會圓點）
- `src/export/`：PNG（批次、zip）、SVG
- `tests/`：單元測試

## 部署

推送到 `main` 分支時，GitHub Actions 會自動執行測試、建置並部署到 GitHub Pages（`.github/workflows/deploy.yml`）。
第一次要到 repo 的 **Settings → Pages**，把 **Source** 設成 **GitHub Actions**。
