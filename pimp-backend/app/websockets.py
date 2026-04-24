import asyncio
import json
from collections import defaultdict

from fastapi import WebSocket


class ConnectionManager:
    """Tracks active websockets per user_id and broadcasts structured events.

    In-process only: good for a single uvicorn worker (our default). For a
    multi-worker or multi-pod deployment, swap for a Redis pub/sub fan-out.
    """

    def __init__(self) -> None:
        self._conns: dict[int, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def connect(self, user_id: int, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._conns[user_id].add(ws)

    async def disconnect(self, user_id: int, ws: WebSocket) -> None:
        async with self._lock:
            self._conns[user_id].discard(ws)
            if not self._conns[user_id]:
                self._conns.pop(user_id, None)

    async def send_to_users(self, user_ids: list[int], payload: dict) -> None:
        if not user_ids:
            return
        message = json.dumps(payload)
        async with self._lock:
            targets = [(uid, ws) for uid in user_ids for ws in self._conns.get(uid, ())]
        dead: list[tuple[int, WebSocket]] = []
        for uid, ws in targets:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append((uid, ws))
        for uid, ws in dead:
            await self.disconnect(uid, ws)


manager = ConnectionManager()
