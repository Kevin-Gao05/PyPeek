"""
测试 server/sse.py — SSE 事件管理器。
"""

import threading
import time

import pytest
from server.sse import SSEManager


class TestCreateScan:
    """create_scan() — 注册新扫描。"""

    def test_returns_non_empty_string(self, sse_manager):
        scan_id = sse_manager.create_scan()
        assert isinstance(scan_id, str)
        assert len(scan_id) > 0

    def test_returns_unique_ids(self, sse_manager):
        ids = {sse_manager.create_scan() for _ in range(10)}
        assert len(ids) == 10

    def test_creates_queue_in_scans_dict(self, sse_manager):
        scan_id = sse_manager.create_scan()
        assert scan_id in sse_manager._scans


class TestPush:
    """push() — 推送事件到扫描队列。"""

    def test_push_adds_to_queue(self, sse_manager):
        scan_id = sse_manager.create_scan()
        sse_manager.push(scan_id, "test", {"msg": "hello"})
        # queue 中应有 1 条消息
        q = sse_manager._scans[scan_id]
        assert not q.empty()

    def test_push_formats_sse_correctly(self, sse_manager):
        """验证 push 产生的 SSE 格式：event: xxx\ndata: {...}\n\n"""
        scan_id = sse_manager.create_scan()
        sse_manager.push(scan_id, "phase_update", {"progress": 0.5})
        sse_manager.finish_scan(scan_id)

        events = list(sse_manager.subscribe(scan_id))
        assert len(events) == 1
        assert events[0].startswith("event: phase_update\n")
        assert "progress" in events[0]

    def test_push_to_unknown_scan_does_not_raise(self, sse_manager):
        """推送到无效 scan_id 应静默忽略。"""
        sse_manager.push("nonexistent", "test", {})

    def test_multiple_pushes_arrive_in_order(self, sse_manager):
        scan_id = sse_manager.create_scan()
        for i in range(5):
            sse_manager.push(scan_id, "update", {"n": i})
        sse_manager.finish_scan(scan_id)

        events = list(sse_manager.subscribe(scan_id))
        assert len(events) == 5
        for i, event in enumerate(events):
            assert str(i) in event


class TestFinishScan:
    """finish_scan() — 发送终止信号。"""

    def test_subscribe_exits_after_finish(self, sse_manager):
        scan_id = sse_manager.create_scan()
        sse_manager.finish_scan(scan_id)
        events = list(sse_manager.subscribe(scan_id))
        assert len(events) == 0

    def test_subscribe_exits_after_finish_with_events(self, sse_manager):
        scan_id = sse_manager.create_scan()
        sse_manager.push(scan_id, "update", {"n": 1})
        sse_manager.push(scan_id, "update", {"n": 2})
        sse_manager.finish_scan(scan_id)
        events = list(sse_manager.subscribe(scan_id))
        assert len(events) == 2


class TestSubscribe:
    """subscribe() — 生成器消费事件。"""

    def test_unknown_scan_yields_error(self, sse_manager):
        events = list(sse_manager.subscribe("nonexistent"))
        assert len(events) == 1
        assert "error" in events[0]
        assert "unknown scan_id" in events[0]

    def test_finish_before_subscribe_completes_immediately(self, sse_manager):
        scan_id = sse_manager.create_scan()
        sse_manager.finish_scan(scan_id)
        events = list(sse_manager.subscribe(scan_id))
        assert events == []

    def test_subscribe_yields_all_pushed_before_sentinel(self, sse_manager):
        scan_id = sse_manager.create_scan()
        sse_manager.push(scan_id, "phase", {"step": 1})
        sse_manager.push(scan_id, "phase", {"step": 2})
        sse_manager.push(scan_id, "complete", {"done": True})
        sse_manager.finish_scan(scan_id)

        events = list(sse_manager.subscribe(scan_id))
        assert len(events) == 3

    def test_concurrent_push_and_subscribe(self, sse_manager):
        """在另一个线程中 push，subscribe 能正确消费。"""
        scan_id = sse_manager.create_scan()

        received = []

        def consume():
            for event in sse_manager.subscribe(scan_id):
                received.append(event)

        t = threading.Thread(target=consume, daemon=True)
        t.start()

        sse_manager.push(scan_id, "update", {"n": 1})
        time.sleep(0.05)
        sse_manager.push(scan_id, "update", {"n": 2})
        time.sleep(0.05)
        sse_manager.finish_scan(scan_id)
        t.join(timeout=2)

        assert len(received) == 2


class TestRemoveScan:
    """remove_scan() — 清理扫描资源。"""

    def test_removes_scan_from_dict(self, sse_manager):
        scan_id = sse_manager.create_scan()
        assert scan_id in sse_manager._scans
        sse_manager.remove_scan(scan_id)
        assert scan_id not in sse_manager._scans

    def test_removed_scan_subscribe_is_unknown(self, sse_manager):
        scan_id = sse_manager.create_scan()
        sse_manager.remove_scan(scan_id)
        events = list(sse_manager.subscribe(scan_id))
        assert len(events) == 1
        assert "unknown scan_id" in events[0]

    def test_remove_nonexistent_does_not_raise(self, sse_manager):
        sse_manager.remove_scan("nonexistent")


class TestThreadSafety:
    """SSEManager 基础线程安全性。"""

    def test_parallel_create_and_push(self, sse_manager):
        """多个线程并发 create + push 不应丢失数据。"""
        num_scans = 20

        def run_scan(i):
            sid = sse_manager.create_scan()
            sse_manager.push(sid, "test", {"i": i})
            sse_manager.finish_scan(sid)
            return sid

        threads = [threading.Thread(target=run_scan, args=(i,), daemon=True)
                   for i in range(num_scans)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=2)

        # 所有 scan 都应该在 dict 中（因为还没 remove）
        assert len(sse_manager._scans) == num_scans
