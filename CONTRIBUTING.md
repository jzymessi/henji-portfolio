# Contributing

欢迎提交问题和改进建议。

1. 不要在 issue、截图、测试夹具或提交中包含真实账户号、持仓、账单或访问令牌。
2. 修改应尽量小，并保持 IBKR-only、Longbridge-only 和双券商三种模式可用。
3. 提交前运行：

```bash
npm run lint
npm run test:dates
npm run build
```

涉及收益计算时，请同时说明数据口径和边界情况。
