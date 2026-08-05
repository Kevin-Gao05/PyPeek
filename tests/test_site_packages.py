"""
测试 scanner/site_packages.py — 纯函数部分。
"""

import pytest
from scanner.site_packages import (
    _clean_dir_name,
    _parse_pip_show,
    _classify_safety,
    CRITICAL_PACKAGES,
)


# ═══════════════════════════════════════════════════════════════════
# _clean_dir_name
# ═══════════════════════════════════════════════════════════════════

class TestCleanDirName:
    """剥离 .dist-info / .egg-info 后缀。"""

    def test_strips_dist_info(self):
        assert _clean_dir_name("flask-3.1.0.dist-info") == "flask"

    def test_strips_egg_info(self):
        assert _clean_dir_name("setuptools-68.0.0.egg-info") == "setuptools"

    def test_handles_multi_digit_version(self):
        assert _clean_dir_name("numpy-1.26.0.dist-info") == "numpy"

    def test_handles_name_with_numbers(self):
        """包名本身含数字，不应被截断。"""
        assert _clean_dir_name("six-1.16.0.dist-info") == "six"

    def test_no_suffix_passes_through(self):
        assert _clean_dir_name("plain_package") == "plain_package"

    def test_empty_string(self):
        assert _clean_dir_name("") == ""

    def test_handles_hyphenated_name(self):
        """带连字符的包名（如 scikit-learn）。"""
        # 实际目录可能是 scikit_learn-1.0.0.dist-info (连字符会变成下划线)
        assert _clean_dir_name("scikit_learn-1.0.0.dist-info") == "scikit_learn"


# ═══════════════════════════════════════════════════════════════════
# _parse_pip_show
# ═══════════════════════════════════════════════════════════════════

class TestParsePipShow:
    """解析 pip show 输出。"""

    PIP_SHOW_NORMAL = """\
Name: requests
Version: 2.31.0
Summary: Python HTTP for Humans.
Home-page: https://requests.readthedocs.io
Author: Kenneth Reitz
Author-email: me@kennethreitz.org
License: Apache 2.0
Location: /usr/lib/python3.10/site-packages
Requires: certifi, charset-normalizer, idna, urllib3
Required-by: flask, some-other-pkg"""

    def test_parses_normal_output(self):
        info = _parse_pip_show(self.PIP_SHOW_NORMAL)
        assert info is not None
        assert info["name"] == "requests"
        assert info["version"] == "2.31.0"
        assert info["summary"] == "Python HTTP for Humans."
        assert "flask" in info["required_by"]
        assert "some-other-pkg" in info["required_by"]

    def test_empty_required_by(self):
        # 注：pip show 空 Required-by 格式为 "Required-by: "（冒号+空格，无值）
        # 需要确保这行不在文本末尾，否则 text.strip() 会去掉末尾空格
        output = "Name: six\n" \
                 "Version: 1.16.0\n" \
                 "Summary: Python 2 and 3 compatibility library\n" \
                 "Required-by: \n" \
                 "Location: /usr/lib/python3/site-packages"
        info = _parse_pip_show(output)
        assert info is not None
        assert info["name"] == "six"
        assert info["required_by"] == []

    def test_required_by_single(self):
        output = """\
Name: markupsafe
Version: 2.1.5
Summary: Safely add untrusted strings to HTML/XML markup.
Required-by: jinja2"""
        info = _parse_pip_show(output)
        assert info is not None
        assert info["required_by"] == ["jinja2"]

    def test_returns_none_for_empty_input(self):
        assert _parse_pip_show("") is None

    def test_returns_none_without_name_field(self):
        output = """\
Version: 1.0.0
Summary: Some package
Required-by:"""
        assert _parse_pip_show(output) is None

    def test_case_insensitive_name_match(self):
        """虽然 pip show 输出标准是 'Name'，但应当健壮。"""
        output = """\
NAME: Flask
Version: 3.0.0
Summary: A web framework
Required-by:"""
        info = _parse_pip_show(output)
        assert info is not None
        assert info["name"] == "Flask"

    def test_missing_version_still_parses(self):
        output = """\
Name: testpkg
Summary: Test only
Required-by:"""
        info = _parse_pip_show(output)
        assert info is not None
        assert info["name"] == "testpkg"
        assert info.get("version") is None


# ═══════════════════════════════════════════════════════════════════
# _classify_safety
# ═══════════════════════════════════════════════════════════════════

class TestClassifySafety:
    """安全分级逻辑。"""

    def test_pip_is_danger(self):
        assert _classify_safety({"name": "pip", "required_by": []}) == "danger"

    def test_setuptools_is_danger(self):
        assert _classify_safety({"name": "setuptools", "required_by": []}) == "danger"

    def test_wheel_is_danger(self):
        assert _classify_safety({"name": "wheel", "required_by": []}) == "danger"

    def test_pkg_resources_is_danger(self):
        assert _classify_safety({"name": "pkg_resources", "required_by": []}) == "danger"

    def test_case_insensitive_critical(self):
        """大小写不敏感。"""
        assert _classify_safety({"name": "Pip", "required_by": []}) == "danger"

    def test_has_required_by_is_warning(self):
        assert _classify_safety({
            "name": "requests",
            "required_by": ["flask"],
        }) == "warning"

    def test_safe_package_returns_safe(self):
        assert _classify_safety({
            "name": "colorama",
            "required_by": [],
        }) == "safe"

    def test_safe_with_no_required_by_key(self):
        """required_by 键不存在也视为 safe。"""
        assert _classify_safety({"name": "typing_extensions"}) == "safe"

    def test_critical_with_required_by_still_danger(self):
        """即使有其他包依赖，关键包仍是 danger。"""
        assert _classify_safety({
            "name": "pip",
            "required_by": ["some-tool"],
        }) == "danger"


# ═══════════════════════════════════════════════════════════════════
# CRITICAL_PACKAGES
# ═══════════════════════════════════════════════════════════════════

class TestCriticalPackages:
    """系统关键包常量。"""

    def test_contains_all_expected(self):
        assert CRITICAL_PACKAGES == {"pip", "setuptools", "wheel", "pkg_resources"}

    def test_all_lowercase(self):
        for pkg in CRITICAL_PACKAGES:
            assert pkg == pkg.lower()
