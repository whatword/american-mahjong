# 麻將線上對戰 (american-mahjong)

4 人連線麻將，使用 Node.js 與 WebSocket。玩法為**台灣 16 張麻將**（含花牌、台數計算），可以和朋友一起玩，空位可由電腦補上。

## 功能

- 大廳最多同時 4 間房，每桌 4 人，真人不足可加入電腦（Claude、ChatGPT、Gemini）
- 完整開局流程：選座位（東南西北）、擲骰決定起莊、擲骰開門、莊家可換牌（最多 2 次）
- 吃、碰、明槓、暗槓、加槓、搶槓、自摸、胡牌、MIGI（報聽）、過水、過碰
- 八仙過海、七搶一等花牌特殊胡法
- 底 50、每台 20，每人起始 1000 分
- 玩家離線時由電腦代打，可從大廳回到原牌局
- 房內文字聊天
- 計分板：以 email 區分玩家，累計戰績並存到 `data/stats.json`

## 環境需求

- Node.js 18 以上
- npm

## 安裝與啟動

```bash
npm install
npm start
```

啟動後開啟 http://localhost:3000 。

## 環境變數

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `PORT` | `3000` | 伺服器監聽埠 |
| `STATS_FILE` | `data/stats.json` | 計分板檔案位置 |
| `BOT_DELAY` | `700` | 電腦每個動作的延遲（毫秒） |
| `SEAT_SHOW_MS` | `3000` | 座位結果顯示時間（毫秒） |
| `DICE_SHOW_MS` | `2500` | 骰子結果顯示時間（毫秒） |
| `FORCED_PICK_MS` | `1500` | 換牌時只剩一張可取、自動取牌前的顯示時間（毫秒） |

範例：

```bash
PORT=8080 npm start
```

## 用 Cloudflare Tunnel 對外開放

用 Cloudflare Tunnel 可以讓朋友從網際網路連到你電腦上的伺服器，不需要開路由器的 port。Cloudflare 的 Tunnel 支援 WebSocket，本專案的連線不需要另外設定。

### 1. 安裝 cloudflared

```bash
brew install cloudflared
```

### 2. 啟動遊戲伺服器

```bash
npm start
```

### 3a. 快速測試（臨時網址，不需要網域）

另開一個終端機執行：

```bash
cloudflared tunnel --url http://localhost:3000
```

終端機會顯示一個 `https://xxxx.trycloudflare.com` 網址，把它傳給朋友即可。每次重新啟動，網址都會改變。

### 3b. 固定網址（需要放在 Cloudflare 上的網域）

```bash
# 登入並授權網域
cloudflared tunnel login

# 建立 tunnel（名稱自訂）
cloudflared tunnel create mahjong

# 把子網域指向這個 tunnel
cloudflared tunnel route dns mahjong mahjong.example.com
```

建立設定檔 `~/.cloudflared/config.yml`：

```yaml
tunnel: mahjong
credentials-file: /Users/<你的使用者名稱>/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: mahjong.example.com
    service: http://localhost:3000
  - service: http_status:404
```

啟動：

```bash
cloudflared tunnel run mahjong
```

之後用 `https://mahjong.example.com` 連線。

### 注意事項

- 電腦睡眠、關機，或 `cloudflared` 與 `npm start` 任一個停止時，朋友就無法連線。兩個程式都要保持執行。
- 如果修改了 `PORT`，Tunnel 的目標網址也要一起改，例如 `http://localhost:8080`。
- 遊戲本身沒有密碼，知道網址的人都能進入大廳。要限制進入者，可以在 Cloudflare Zero Trust 為這個網址加上 Access 規則。
- 計分板以玩家輸入的 email 為帳號，**沒有驗證**。`data/` 已列入 `.gitignore`，不要把它提交到 Git。

## 測試

```bash
npm test          # 完整測試（規則、AI、模擬對局）
npm run test:quick # 縮減場數的快速測試
npm run test:ui    # 瀏覽器畫面測試（使用 puppeteer-core，需要本機已安裝 Chrome）
```

## 專案結構

```
server.js     HTTP 靜態檔案伺服器與 WebSocket 房間、牌局流程
game.js       牌、胡牌判斷、台數計算
ai.js         電腦玩家
stats.js      計分板讀寫
public/       前端（index.html、client.js、style.css、tiles/ 牌面圖）
test/         規則與 AI 測試，test/ui 為畫面測試
data/         執行時產生的戰績（不納入版本控制）
```

## 授權

- 萬、筒、條、字牌與牌面底圖來自 [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles)，屬公有領域（CC0）。
- 花牌、白板、綠色牌背為本專案自製。詳見 `public/tiles/README.md`。
