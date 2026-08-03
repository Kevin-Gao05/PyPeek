"""
PyPeek SSE（Server-Sent Events）事件管理器。

线程安全：多个扫描线程通过各自的扫描队列推送事件，
由单个 SSE 消费者端点统一消费。
"""

import queue
import json
import threading
import uuid

_SENTINEL = object()


class SSEManager:
    """管理每次扫描的事件队列，支持 Server-Sent Events 推送。"""

    def __init__(self):
        self._scans: dict[str, queue.Queue] = {}
        self._lock = threading.Lock()

    def create_scan(self) -> str:
        """注册一次新的扫描，返回 scan_id。"""
        scan_id = uuid.uuid4().hex
        with self._lock:
            self._scans[scan_id] = queue.Queue()
        return scan_id

    def push(self, scan_id: str, event: str, data: dict) -> None:
        """向指定扫描队列推送一个 SSE 事件。"""
        with self._lock:
            q = self._scans.get(scan_id)
        if q is None:
            return
        payload = (
            f"event: {event}\n"
            f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
        )
        q.put(payload)

    def finish_scan(self, scan_id: str) -> None:
        """标记扫描结束，订阅者将在消费完所有事件后退出。"""
        with self._lock:
            q = self._scans.get(scan_id)
        if q is not None:
            q.put(_SENTINEL)

    def subscribe(self, scan_id: str):
        """
        生成器：从扫描队列中取出 SSE 事件。

        收到 _SENTINEL 后自动退出。
        队列空闲时每 15 秒发送一次心跳注释，防止连接被关闭。
        """
        with self._lock:
            q = self._scans.get(scan_id)
        if q is None:
            yield (
                "event: error\n"
                f"data: {json.dumps({'error': 'unknown scan_id'})}\n\n"
            )
            return

        while True:
            try:
                payload = q.get(timeout=15)
            except queue.Empty:
                yield ": keepalive\n\n"
                continue

            if payload is _SENTINEL:
                break
            yield payload

    def remove_scan(self, scan_id: str) -> None:
        """清理已完成扫描的队列。"""
        with self._lock:
            self._scans.pop(scan_id, None)


# 模块级单例
sse_manager = SSEManager()
