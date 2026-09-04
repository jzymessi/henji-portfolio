# 衡迹 Portfolio Dashboard

一个本地优先、只读的投资组合看板，用统一口径展示 Interactive Brokers（IBKR）与可选的长桥证券账户。

## 功能

- 组合总览、IBKR 页面和长桥页面
- 每日、每月和每年收益日历
- NAV、简单加权收益率、辅助 TWR 和盈亏统计
- 持仓成本、现价、市值、今日涨跌、未实现与累计盈亏
- 与纳斯达克、标普 500、道琼斯指数进行区间对比
- 美东收盘后每日自动刷新一次，并保留手动刷新与本地缓存
- 长桥完全可选；未启用时显示“未配置”，不影响 IBKR 使用

## 安全边界

这个项目只适合在可信任的本机或私有网络中运行。券商凭证、账户导出和缓存数据不会被前端上传，也不应提交到 Git。

- TWS / IB Gateway 请启用“只读 API”，仅允许 localhost。
- 本地数据桥只监听 `127.0.0.1`。
- `.data/`、`.env.local`、CSV、PDF 和 XML 已被 Git 忽略。
- 不要把本地数据桥直接暴露到公网。

## 环境要求

- Node.js 22.13 或更新版本
- Python 3.10 或更新版本
- 已登录的 TWS / IB Gateway（使用 IBKR 时）
- 长桥官方 CLI 与已登录 OAuth 会话（仅在使用长桥时需要）

## 安装

```bash
npm install
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env.local
```

默认只启用 IBKR：

```env
PORTFOLIO_BROKERS=ibkr
```

同时启用 IBKR 和长桥：

```env
PORTFOLIO_BROKERS=ibkr,longbridge
```

只使用长桥：

```env
PORTFOLIO_BROKERS=longbridge
```

不需要的券商无需填写任何密钥或账户信息。

## 本地运行

一次启动网页和本地数据桥：

```bash
npm run local
```

也可以分别运行 `npm run bridge` 和 `npm run dev`。打开
`http://127.0.0.1:3000` 后，页面先读取本地缓存，再按设置的美东时间每日自动连接一次已配置券商。

在 macOS 上安装登录自启与异常自动重启：

```bash
npm run local:install
```

默认自动更新时间为美东 `16:30`，可以在页面“连接设置”中改为
`16:15–19:45`。关机期间不会运行；再次登录后会检查最近漏过的计划日期。长桥可以补取官方单日历史，IBKR 若已经错过 TWS 当日快照，则需要 Activity Flex 才能准确补录。

移除 macOS 登录服务：

```bash
npm run local:uninstall
```

## IBKR 配置

TWS 正式账户默认端口为 `7496`，模拟账户默认端口为 `7497`。程序也会尝试 IB Gateway 常用端口 `4001` 和 `4002`。如需固定端口或账户，可在 `.env.local` 设置：

```env
IBKR_TWS_PORT=7496
IBKR_ACCOUNT_ID=
```

`IBKR_ACCOUNT_ID` 留空时会使用 TWS 返回的第一个账户。

### 导入 IBKR 历史

IBKR 当前持仓和当日已实现盈亏以 TWS 为准，并按美东交易日保存在本地；同一天重复刷新只覆盖当日快照，不会重复累计。Flex 只作为导入日前的历史基线，以及关机期间漏掉成交时的补录来源。

导入 Flex Trades CSV，以补充历史已实现盈亏：

```bash
npm run import:ibkr-flex -- /absolute/path/to/flex-trades.csv
```

导入 Activity Flex Query CSV，以补充日度 NAV、TWR 和盈亏：

```bash
npm run import:ibkr-activity -- /absolute/path/to/activity.csv
```

脚本会使用 `IBKR_ACCOUNT_ID`；未设置时自动选择文件中第一个有效账户，不包含任何写死的账户号。

## 长桥配置（可选）

安装并登录长桥官方 CLI 后，将 `longbridge` 加到 `PORTFOLIO_BROKERS`。如命令不在 `PATH` 中，可设置：

```env
LONGBRIDGE_CLI=/absolute/path/to/longbridge
LONGBRIDGE_REGION=global
```

批量导入长桥日结单：

```bash
npm run import:longbridge -- 2026-01-01 2026-08-31
```

使用历史收盘价估算缺少日结单的工作日：

```bash
npm run estimate:longbridge -- 2026-01-01 2026-08-31
```

估算数据会明确标记为“估算”，不会伪装成券商确认数据。

更推荐通过长桥官方单日收益接口补齐历史。脚本每成功获取一天便立即保存，支持中断后重跑，并自动跳过已确认日期：

```bash
npm run backfill:longbridge -- 2025-01-01 2025-12-31
```

持仓收盘价估算无法还原两份稀疏日结单之间发生的交易，仅应在官方接口不可用时使用；估算脚本不会覆盖已确认的官方记录。

## 收益口径

- 日历、IBKR、长桥和指数比较统一使用 `America/New_York` 美东交易日；美东 20:00 后的隔夜盘归入下一交易日。
- 总览、IBKR 和长桥统一采用简单加权：`累计盈亏 /（期初资产 + max(累计净入金, 0)）`。净出金不会缩小分母。
- 组合现金流先合并后再计算收益率，因此两个券商之间的转账可以相互抵消；不用不同刷新时点的 NAV 差额代替收益。
- 长桥日收益优先使用官方单日 `profit-analysis`，已确认历史不会被盘中估算覆盖。

- `持仓浮盈 = 剩余数量 × (现价 - 当前持仓均价)`
- `累计总收益 = 持仓浮盈 + 历史已实现盈亏（扣手续费和税费）`
- `摊薄成本 = (当前市值 - 累计总收益) / 剩余数量`
- `累计收益率 = 累计总收益 / (当前市值 - 累计总收益)`

现金股息默认单列，不回填到个股摊薄成本。历史卖出收益覆盖全部净投入时显示“已回本”。

## 开源许可

[MIT](LICENSE)
