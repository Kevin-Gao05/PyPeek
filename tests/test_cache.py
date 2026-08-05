"""
测试 scanner/cache.py — 本地扫描缓存模块。
"""

import json
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest

import scanner.cache as cache_mod


# ═══════════════════════════════════════════════════════════════════
# get_cache_dir / get_cache_path
# ═══════════════════════════════════════════════════════════════════

class TestGetCacheDir:
    """平台感知的缓存目录路径。"""

    def test_linux_returns_xdg_path(self, monkeypatch):
        monkeypatch.setattr(cache_mod, "IS_WINDOWS", False)
        result = cache_mod.get_cache_dir()
        assert result.endswith(os.path.join(".config", "PyPeek"))

    def test_windows_returns_appdata_path(self, monkeypatch):
        monkeypatch.setattr(cache_mod, "IS_WINDOWS", True)
        monkeypatch.setenv("APPDATA", "C:\\Users\\test\\AppData\\Roaming")
        result = cache_mod.get_cache_dir()
        assert result == os.path.join("C:\\Users\\test\\AppData\\Roaming", "PyPeek")

    def test_windows_fallback_to_home(self, monkeypatch):
        monkeypatch.setattr(cache_mod, "IS_WINDOWS", True)
        monkeypatch.delenv("APPDATA", raising=False)
        result = cache_mod.get_cache_dir()
        assert "PyPeek" in result


class TestGetCachePath:
    """缓存文件完整路径。"""

    def test_returns_cache_json_in_cache_dir(self, temp_cache_dir):
        path = cache_mod.get_cache_path()
        assert path.endswith("cache.json")
        assert "PyPeek" in path


# ═══════════════════════════════════════════════════════════════════
# load_cache
# ═══════════════════════════════════════════════════════════════════

class TestLoadCache:
    """加载缓存的各种场景。"""

    def test_no_file_returns_none(self, temp_cache_dir):
        """缓存文件不存在 → None。"""
        result = cache_mod.load_cache()
        assert result is None

    def test_invalid_json_returns_none(self, temp_cache_dir):
        """JSON 格式错误 → None。"""
        cache_path = cache_mod.get_cache_path()
        Path(cache_path).parent.mkdir(parents=True, exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            f.write("not valid json {{{")
        result = cache_mod.load_cache()
        assert result is None

    def test_missing_required_field_returns_none(self, temp_cache_dir):
        """缺少必需字段 → None。"""
        cache_path = cache_mod.get_cache_path()
        Path(cache_path).parent.mkdir(parents=True, exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump({"scanned_at": "2026-01-01T00:00:00+00:00"}, f)
        result = cache_mod.load_cache()
        assert result is None

    def test_missing_pythons_field_returns_none(self, temp_cache_dir):
        """缺少 pythons 字段 → None。"""
        cache_path = cache_mod.get_cache_path()
        Path(cache_path).parent.mkdir(parents=True, exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump({
                "scanned_at": "2026-01-01T00:00:00+00:00",
                "venvs": [],
                "pip_cache": {},
            }, f)
        result = cache_mod.load_cache()
        assert result is None

    def test_valid_fresh_cache_returns_data(self, write_cache_file, valid_cache_data):
        """有效且未过期的缓存 → 返回完整数据。"""
        result = cache_mod.load_cache()
        assert result is not None
        assert result["pythons"] == valid_cache_data["pythons"]
        assert result["venvs"] == valid_cache_data["venvs"]
        assert result["pip_cache"] == valid_cache_data["pip_cache"]

    def test_expired_cache_returns_none(self, temp_cache_dir, expired_cache_data):
        """超过 7 天的缓存 → None。"""
        cache_path = cache_mod.get_cache_path()
        Path(cache_path).parent.mkdir(parents=True, exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(expired_cache_data, f, ensure_ascii=False, indent=2)
        result = cache_mod.load_cache()
        assert result is None

    def test_exactly_seven_days_expires(self, temp_cache_dir):
        """恰好 7 天 + 1 秒 → None（边界测试）。"""
        cache_path = cache_mod.get_cache_path()
        Path(cache_path).parent.mkdir(parents=True, exist_ok=True)
        just_over_7_days = (datetime.now(timezone.utc) -
                            timedelta(seconds=cache_mod.CACHE_MAX_AGE_SECONDS + 1))
        data = {
            "scanned_at": just_over_7_days.isoformat(),
            "pythons": [],
            "venvs": [],
            "pip_cache": {},
        }
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        result = cache_mod.load_cache()
        assert result is None

    def test_just_under_seven_days_is_fresh(self, temp_cache_dir):
        """不到 7 天 → 有效（边界测试）。"""
        cache_path = cache_mod.get_cache_path()
        Path(cache_path).parent.mkdir(parents=True, exist_ok=True)
        just_under_7_days = (datetime.now(timezone.utc) -
                             timedelta(seconds=cache_mod.CACHE_MAX_AGE_SECONDS - 1))
        data = {
            "scanned_at": just_under_7_days.isoformat(),
            "pythons": [],
            "venvs": [],
            "pip_cache": {},
        }
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        result = cache_mod.load_cache()
        assert result is not None

    def test_unparseable_scanned_at_returns_none(self, temp_cache_dir):
        """scanned_at 格式非法 → None。"""
        cache_path = cache_mod.get_cache_path()
        Path(cache_path).parent.mkdir(parents=True, exist_ok=True)
        data = {
            "scanned_at": "this-is-not-a-date",
            "pythons": [],
            "venvs": [],
            "pip_cache": {},
        }
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        result = cache_mod.load_cache()
        assert result is None


# ═══════════════════════════════════════════════════════════════════
# save_cache
# ═══════════════════════════════════════════════════════════════════

class TestSaveCache:
    """保存缓存到磁盘。"""

    def test_creates_directory_if_missing(self, temp_cache_dir, valid_cache_data):
        """目录不存在时自动创建。"""
        cache_dir = cache_mod.get_cache_dir()
        # 确保目录不存在
        import shutil
        if os.path.isdir(cache_dir):
            shutil.rmtree(cache_dir)
        cache_mod.save_cache(valid_cache_data)
        assert os.path.isdir(cache_dir)

    def test_writes_valid_json_file(self, temp_cache_dir, valid_cache_data):
        """写入的文件可以用 load_cache 正确读回。"""
        cache_mod.save_cache(valid_cache_data)
        loaded = cache_mod.load_cache()
        assert loaded is not None
        assert loaded["pythons"] == valid_cache_data["pythons"]
        assert loaded["venvs"] == valid_cache_data["venvs"]
        assert loaded["pip_cache"] == valid_cache_data["pip_cache"]
        assert loaded["scanned_at"] == valid_cache_data["scanned_at"]

    def test_overwrites_existing_file(self, temp_cache_dir, valid_cache_data):
        """再次保存会覆盖旧文件。"""
        cache_mod.save_cache(valid_cache_data)
        new_data = dict(valid_cache_data)
        new_data["pythons"] = [{"path": "new", "version": "3.12"}]
        cache_mod.save_cache(new_data)
        loaded = cache_mod.load_cache()
        assert loaded is not None
        assert len(loaded["pythons"]) == 1
        assert loaded["pythons"][0]["version"] == "3.12"

    def test_writes_utf8_json(self, temp_cache_dir, valid_cache_data):
        """写入的内容是合法的 UTF-8 JSON。"""
        cache_mod.save_cache(valid_cache_data)
        cache_path = cache_mod.get_cache_path()
        with open(cache_path, "r", encoding="utf-8") as f:
            content = json.load(f)
        assert content["scan_summary"]["drives_scanned"] == ["C:\\"]
