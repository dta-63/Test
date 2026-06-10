from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session

from ..auth import user_id_from_ws_token
from ..database import get_db
from ..websockets import manager

router = APIRouter()


@router.websocket("/ws/cart")
async def ws_cart(ws: WebSocket, token: str = Query(...), db: Session = Depends(get_db)) -> None:
    try:
        user_id = user_id_from_ws_token(token, db)
    except Exception:
        await ws.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(user_id, ws)
    try:
        await ws.send_json({"type": "hello", "user_id": user_id})
        while True:
            # We don't expect client messages; keep the loop alive to detect
            # disconnects. receive_text() raises WebSocketDisconnect on close.
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(user_id, ws)
