# 格點幾何 Icon · Grid Geometry Icon

**English**: a web tool for drawing icons on a grid, for phones and desktops. You place points only on grid points; every other point is an intersection of two curves. There are just lines and circles — arcs come from cutting circles and deleting pieces. Intersections, pieces and closed regions are computed exactly (BigInt rationals and p + q√d), floating point is used only for drawing and export. Exports PNG (batch sizes, pixel snapping) and SVG, and can turn a filled SVG into grid circles and lines. The interface follows your browser language (Traditional Chinese or English); switch with the language button. Live: https://chanwunkong.github.io/grid-icon/

---

在格點上畫 icon 的網頁工具（Vite + TypeScript，不使用前端框架）。手機和電腦都能用。

## 核心理念

- 只能在格點上定位；其他的點都是兩條曲線的交點。
- 只有兩種曲線：直線和圓。圓弧是用直線（或不會匯出的「輔助線」）切開圓，再刪掉不要的片段做出來的。
- **精確層**：交點、切分、封閉區域判定全部用精確數學（BigInt 有理數，以及 p + q√d），不用浮點容差。
- **渲染層**：只有畫到 Canvas 和匯出時才轉成浮點。

## 介面語言

依瀏覽器語言自動選擇繁體中文或英文；電腦版在上方按鈕列、手機版在「設定」最上面可以切換，選擇會記住。字串都在 `src/i18n-en.ts`（中文原文當鍵值），`tests/i18n.test.ts` 會檢查每個字串都有英文、沒有漏掉的中文。

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

## 匯入 SVG

「新專案」對話框 → 設定格數 → **從 SVG 匯入**：

1. 讀取 SVG 的填色圖形（路徑、圓、矩形、多邊形，含 transform），輪廓拆成圓弧和直線（誤差在圖形大小的 0.1% 內）
2. 每段換成格點上的曲線（圓心在格點、圓上有格點；直線通過兩個格點），沿整條輪廓一起最佳化：相鄰兩段一定在原本的轉角附近相交，轉角多彎不超過 15°
3. 曲線全部是輔助線，圍出的區域用原本的顏色填色；原圖設成底圖方便比對
4. 很平的弧（圓心超出可用範圍）用通過格點的直線代替；太小或太細、在這個格數下無法封閉的外框會略過並提示

只支援填色，不支援只有描邊的線條。

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
