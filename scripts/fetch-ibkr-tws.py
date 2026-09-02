#!/usr/bin/env python3
"""Read-only snapshot from a locally running TWS or IB Gateway session."""

import json
import os
import sys
import threading
from math import isfinite

from ibapi.client import EClient
from ibapi.wrapper import EWrapper


def finite_number(value, fallback=0.0):
    try:
        parsed = float(value)
        return parsed if isfinite(parsed) else fallback
    except (TypeError, ValueError):
        return fallback


class SnapshotClient(EWrapper, EClient):
    def __init__(self):
        EClient.__init__(self, self)
        self.ready = threading.Event()
        self.downloaded = threading.Event()
        self.pnl_received = threading.Event()
        self.single_pnl_received = threading.Event()
        self.account = ""
        self.nav = 0.0
        self.daily_pnl = None
        self.positions = {}
        self.single_pnl_by_req = {}
        self.single_pnl_req_to_conid = {}
        self.single_pnl_expected = 0
        self.errors = []

    def nextValidId(self, _order_id):
        self.ready.set()

    def managedAccounts(self, accounts_list):
        accounts = [item for item in accounts_list.split(",") if item]
        preferred = os.environ.get("IBKR_ACCOUNT_ID", "")
        self.account = preferred if preferred in accounts else (accounts[0] if accounts else preferred)
        if self.account:
            self.reqAccountUpdates(True, self.account)
            self.reqPnL(9001, self.account, "")

    def updateAccountValue(self, key, value, currency, _account_name):
        if key == "NetLiquidation" and currency in ("BASE", "USD"):
            self.nav = finite_number(value, self.nav)

    def updatePortfolio(
        self,
        contract,
        position,
        market_price,
        market_value,
        average_cost,
        unrealized_pnl,
        realized_pnl,
        _account_name,
    ):
        multiplier = max(finite_number(contract.multiplier, 1.0), 1.0)
        quoted_cost = finite_number(average_cost)
        if contract.secType in ("OPT", "FOP"):
            quoted_cost /= multiplier
        self.positions[str(contract.conId)] = {
            "conid": contract.conId,
            "symbol": contract.localSymbol or contract.symbol or str(contract.conId),
            "name": contract.symbol or contract.localSymbol or str(contract.conId),
            "market": contract.primaryExchange or contract.exchange or "IBKR",
            "quantity": finite_number(position),
            "currency": contract.currency or "USD",
            "cost": quoted_cost,
            "price": finite_number(market_price),
            "marketValue": finite_number(market_value),
            "multiplier": multiplier,
            "unrealizedPnl": finite_number(unrealized_pnl),
            "sessionRealizedPnl": finite_number(realized_pnl),
        }

    def accountDownloadEnd(self, _account_name):
        self.downloaded.set()

    def pnl(self, _req_id, daily_pnl, _unrealized_pnl, _realized_pnl):
        parsed = finite_number(daily_pnl, float("nan"))
        if isfinite(parsed):
            self.daily_pnl = parsed
            self.pnl_received.set()

    def pnlSingle(
        self, req_id, _position, daily_pnl, _unrealized_pnl, _realized_pnl, _value
    ):
        conid = self.single_pnl_req_to_conid.get(req_id)
        if conid is None:
            return
        self.single_pnl_by_req[conid] = finite_number(daily_pnl, float("nan"))
        if len(self.single_pnl_by_req) >= self.single_pnl_expected:
            self.single_pnl_received.set()

    def error(self, req_id, error_code, error_string, advanced_order_reject_json=""):
        if error_code not in (2104, 2106, 2107, 2108, 2158):
            self.errors.append(f"{error_code}: {error_string}")


def snapshot_for_port(port):
    client = SnapshotClient()
    client.connect(
        os.environ.get("IBKR_TWS_HOST", "127.0.0.1"),
        port,
        clientId=int(os.environ.get("IBKR_TWS_CLIENT_ID", "71")),
    )
    if not client.isConnected():
        raise RuntimeError(f"TWS port {port} is unavailable")
    worker = threading.Thread(target=client.run, daemon=True)
    worker.start()
    if not client.ready.wait(4):
        client.disconnect()
        raise RuntimeError(f"TWS port {port} did not finish the API handshake")
    if not client.downloaded.wait(8):
        client.disconnect()
        detail = "; ".join(client.errors[-2:])
        raise RuntimeError(detail or f"TWS port {port} did not return account data")
    client.single_pnl_expected = len(client.positions)
    for index, conid in enumerate(client.positions):
        req_id = 10000 + index
        client.single_pnl_req_to_conid[req_id] = conid
        client.reqPnLSingle(req_id, client.account, "", int(conid))
    if client.positions:
        client.single_pnl_received.wait(8)
    client.pnl_received.wait(3)
    if client.account:
        client.reqAccountUpdates(False, client.account)
        client.cancelPnL(9001)
        for index in range(len(client.positions)):
            client.cancelPnLSingle(10000 + index)
    for conid, item in client.positions.items():
        daily = client.single_pnl_by_req.get(conid)
        item["dailyPnl"] = daily if daily is not None and isfinite(daily) else None
    client.disconnect()
    return {
        "accountId": client.account,
        "nav": client.nav,
        "dailyPnl": client.daily_pnl,
        "positions": list(client.positions.values()),
        "port": port,
    }


def main():
    configured = os.environ.get("IBKR_TWS_PORT", "")
    ports = [int(configured)] if configured else [7496, 7497, 4001, 4002]
    failures = []
    for port in ports:
        try:
            print(json.dumps(snapshot_for_port(port), ensure_ascii=False))
            return 0
        except Exception as error:
            failures.append(str(error))
    print(json.dumps({"error": "; ".join(failures)}, ensure_ascii=False))
    return 1


if __name__ == "__main__":
    sys.exit(main())
