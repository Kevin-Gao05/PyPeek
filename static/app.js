/**
 * PyPeek — 前端应用逻辑
 *
 * Phase 2+：SSE 消费者、数据渲染、统计卡片更新。
 */

// ── DOM 引用 ───────────────────────────────────────────────────────

const tabBar = document.getElementById("tab-bar");
const content = document.getElementById("content");
const btnRefresh = document.getElementById("btn-refresh");
const scanBar = document.getElementById("scan-bar");

// ── 标签页切换 ─────────────────────────────────────────────────────

tabBar.addEventListener("click", (e) => {
  const tab = e.target.closest(".tab-bar__tab");
  if (!tab) return;
  const tabName = tab.dataset.tab;
  tabBar.querySelectorAll(".tab-bar__tab").forEach((t) =>
    t.classList.remove("tab-bar__tab--active"));
  tab.classList.add("tab-bar__tab--active");
  content.querySelectorAll(".tab-panel").forEach((panel) =>
    panel.hidden = panel.id !== `panel-${tabName}`);
});

// ── 统计卡片点击 → 跳转对应标签页 ──────────────────────────────────

document.getElementById("stat-cards").addEventListener("click", (e) => {
  const card = e.target.closest(".stat-card");
  if (!card) return;
  const tab = tabBar.querySelector(`[data-tab="${card.dataset.tab}"]`);
  if (tab) tab.click();
});

// ── 包列表「返回」按钮 ─────────────────────────────────────────────

document.getElementById("btn-packages-back").addEventListener("click", () => {
  // 清除选中状态
  document.querySelectorAll(".data-table__row--selected").forEach((r) =>
    r.classList.remove("data-table__row--selected"));
  selectedPython = null;

  // 切换回之前的标签页
  const tab = tabBar.querySelector(`[data-tab="${previousTab}"]`);
  if (tab) tab.click();
});

// ── 刷新按钮 — 触发扫描 ────────────────────────────────────────────

let currentScanId = null;
let selectedPython = null;   // { pythonPath, label, version }
let previousTab = "pythons"; // 记录从哪个标签页跳转到包列表

btnRefresh.addEventListener("click", () => {
  btnRefresh.disabled = true;
  showScanBar("正在启动扫描…", "");
  hideAllEmptyStates();

  fetch("/api/scan")
    .then((r) => r.json())
    .then((data) => {
      currentScanId = data.scan_id;
      connectSSE(currentScanId);
    })
    .catch((err) => {
      hideScanBar();
      btnRefresh.disabled = false;
      console.error("扫描启动失败:", err);
    });
});

// ── SSE 连接 ───────────────────────────────────────────────────────

function connectSSE(scanId) {
  const url = `/api/scan/progress?scan_id=${scanId}`;
  const source = new EventSource(url);

  source.addEventListener("phase_update", (e) => {
    const data = JSON.parse(e.data);
    updateScanProgress(data.progress || 0, data.detail || data.phase, "");

    if (data.pythons) {
      renderPythonsTable(data.pythons);
      updateStatCard("pythons", data.pythons.length);
    }
    if (data.venvs) {
      renderVenvsTable(data.venvs);
      updateStatCard("venvs", data.venvs.length);
    }
    if (data.pip_cache) {
      renderPipCacheTab(data.pip_cache);
    }
  });

  source.addEventListener("scan_complete", (e) => {
    const data = JSON.parse(e.data);
    source.close();

    if (data.pythons) {
      renderPythonsTable(data.pythons);
      updateStatCard("pythons", data.pythons.length);
    }
    if (data.venvs) {
      renderVenvsTable(data.venvs);
      updateStatCard("venvs", data.venvs.length);
    }
    if (data.pip_cache) {
      renderPipCacheTab(data.pip_cache);
      updateStatCard("pip-cache", formatSize(data.pip_cache.total_size_mb));
    }

    // 汇总包数量（Python 安装 + venvs）
    let totalPkgs = 0;
    if (data.pythons) {
      totalPkgs += data.pythons.reduce((s, py) => s + (py.package_count || 0), 0);
    }
    if (data.venvs) {
      totalPkgs += data.venvs.reduce((s, v) => s + (v.package_count || 0), 0);
    }
    updateStatCard("packages", totalPkgs);

    updateScanProgress(1.0, "扫描完成", "");
    setTimeout(hideScanBar, 1500);
    btnRefresh.disabled = false;

    // 重复环境检测提示
    let dupPythons = 0, dupVenvs = 0;
    if (data.pythons) {
      dupPythons = data.pythons.filter(p => p.duplicate_group).length;
    }
    if (data.venvs) {
      dupVenvs = data.venvs.filter(v => v.duplicate_group).length;
    }
    if (dupPythons > 0 || dupVenvs > 0) {
      let msg = [];
      if (dupPythons > 0) msg.push(`${dupPythons} 个 Python 安装可能存在重复`);
      if (dupVenvs > 0) msg.push(`${dupVenvs} 个虚拟环境可能存在重复`);
      showToast(` ${msg.join('，')}，已在表格中标出`, "error");
    }
  });

  source.addEventListener("scan_error", (e) => {
    const data = JSON.parse(e.data);
    source.close();
    showScanBar("扫描出错", data.error || "未知错误");
    btnRefresh.disabled = false;
  });

  source.onerror = () => {
    source.close();
    hideScanBar();
    btnRefresh.disabled = false;
  };
}

// ── 渲染 Python 安装表格 ───────────────────────────────────────────

function renderPythonsTable(pythons) {
  const panel = document.getElementById("panel-pythons");
  const empty = panel.querySelector(".empty-state");
  const table = panel.querySelector(".data-table");

  if (!pythons.length) {
    if (empty) {
      empty.innerHTML = `
        <div class="empty-state__icon"></div>
        <p class="empty-state__text">未发现 Python 安装</p>
        <p class="empty-state__hint">PyPeek 扫描了 PATH 和注册表，未找到任何 Python。请确认 Python 已正确安装。</p>`;
      empty.hidden = false;
    }
    if (table) table.hidden = true;
    return;
  }

  if (empty) empty.hidden = true;
  if (!table) {
    panel.insertAdjacentHTML("beforeend", `
      <table class="data-table">
        <thead>
          <tr>
            <th>版本</th>
            <th>路径</th>
            <th>来源</th>
            <th>包数量</th>
            <th>占用空间</th>
            <th style="width:60px">操作</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    `);
  }

  const tbody = panel.querySelector(".data-table tbody");
  tbody.innerHTML = "";

  pythons.forEach((py) => {
    const tr = document.createElement("tr");
    tr.dataset.pythonPath = py.path;
    tr.innerHTML = `
      <td>
        <span class="version">${escapeHtml(py.version)}</span>
        ${py.duplicate_group ? `<span class="dup-badge" title="可能存在重复安装：&#10;${py.duplicate_group.map(p => escapeHtml(p)).join('&#10;')}"> 重复</span>` : ""}
      </td>
      <td><code class="path">${escapeHtml(py.path)}</code></td>
      <td><span class="badge badge--${escapeHtml(py.source)}">${sourceLabel(py.source)}</span></td>
      <td>${py.package_count}</td>
      <td>${formatSize(py.site_packages_size_mb)}</td>
      <td><button class="btn btn--ghost btn--sm btn-open-folder" data-path="${escapeHtml(py.path)}" title="在文件管理器中打开"></button></td>
    `;
    tr.classList.add("data-table__row", "data-table__row--expandable");
    tr.title = "点击展开包列表";
    tbody.appendChild(tr);
  });

  panel.querySelector(".data-table").hidden = false;
}

// ── 渲染虚拟环境表格 ───────────────────────────────────────────────

function renderVenvsTable(venvs) {
  const panel = document.getElementById("panel-venvs");
  const empty = panel.querySelector(".empty-state");
  const table = panel.querySelector(".data-table");

  if (!venvs.length) {
    if (empty) {
      empty.innerHTML = `
        <div class="empty-state__icon"></div>
        <p class="empty-state__text">未发现虚拟环境</p>
        <p class="empty-state__hint">PyPeek 搜索了所有盘符下的 <code>pyvenv.cfg</code> 文件，未找到虚拟环境。</p>`;
      empty.hidden = false;
    }
    if (table) table.hidden = true;
    return;
  }

  if (empty) empty.hidden = true;
  if (!table) {
    panel.insertAdjacentHTML("beforeend", `
      <table class="data-table">
        <thead>
          <tr>
            <th>路径</th>
            <th>Python 版本</th>
            <th>来源 Python</th>
            <th>大小</th>
            <th>包数量</th>
            <th>最后修改</th>
            <th style="width:80px">操作</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    `);
  }

  const tbody = panel.querySelector(".data-table tbody");
  tbody.innerHTML = "";

  venvs.forEach((v) => {
    const tr = document.createElement("tr");
    // 正确检测 Windows 路径（单反斜杠）
    const isWin = v.path.includes("\\") || /^[A-Za-z]:/.test(v.path);
    const pythonPath = isWin
      ? v.path + "\\Scripts\\python.exe"
      : v.path + "/bin/python3";
    tr.dataset.pythonPath = pythonPath;
    tr.dataset.venvPath = v.path;  // 精确路径用于删除匹配
    tr.innerHTML = `
      <td><code class="path">${escapeHtml(v.path)}</code></td>
      <td>
        <span class="version">${escapeHtml(v.python_version)}</span>
        ${v.duplicate_group ? `<span class="dup-badge" title="可能存在重复环境：&#10;${v.duplicate_group.map(p => escapeHtml(p)).join('&#10;')}"> 重复</span>` : ""}
      </td>
      <td><span style="font-size:11px;color:var(--text-muted)">${escapeHtml(v.home_python || "—")}</span></td>
      <td>${formatSize(v.total_size_mb)}</td>
      <td>${v.package_count}</td>
      <td><span style="font-size:11px;color:var(--text-muted)">${formatDate(v.last_modified)}</span></td>
      <td>
        <button class="btn btn--ghost btn--sm btn-open-folder" data-path="${escapeHtml(v.path)}" title="在文件管理器中打开"></button>
        <button class="btn btn--ghost btn--sm btn-delete-venv" data-path="${escapeHtml(v.path)}" title="删除此虚拟环境"></button>
      </td>
    `;
    tr.classList.add("data-table__row", "data-table__row--expandable");
    tr.title = "点击展开包列表";
    tbody.appendChild(tr);
  });

  panel.querySelector(".data-table").hidden = false;
}

// ── 选中 Python/venv 行 → 跳转包列表标签页 ──────────────────────────

function selectPythonRow(row) {
  // 清除其他选中行
  document.querySelectorAll(".data-table__row--selected").forEach((r) =>
    r.classList.remove("data-table__row--selected"));
  row.classList.add("data-table__row--selected");

  const pythonPath = row.dataset.pythonPath;
  const cells = row.querySelectorAll("td");
  // 从行内容提取标签信息
  let version = "", label = "";
  if (cells.length >= 2) {
    version = cells[0].textContent.trim();
    label = cells[1].textContent.trim();  // 路径列
  }

  // 记录当前标签页以便返回
  const activeTab = document.querySelector(".tab-bar__tab--active");
  if (activeTab) previousTab = activeTab.dataset.tab;

  selectedPython = { pythonPath, version, label };
  switchToPackagesTab();
}

function switchToPackagesTab() {
  // 切换到包列表标签页
  tabBar.querySelectorAll(".tab-bar__tab").forEach((t) =>
    t.classList.remove("tab-bar__tab--active"));
  const packagesTab = tabBar.querySelector('[data-tab="packages"]');
  packagesTab.classList.add("tab-bar__tab--active");

  content.querySelectorAll(".tab-panel").forEach((p) => (p.hidden = true));
  document.getElementById("panel-packages").hidden = false;

  loadPackagesTab();
}

async function loadPackagesTab() {
  if (!selectedPython) return;

  const { pythonPath, version, label } = selectedPython;

  // 设置返回按钮和打开文件夹按钮
  document.getElementById("packages-empty").hidden = true;
  document.getElementById("packages-content").hidden = false;
  document.getElementById("packages-stale").hidden = true;
  document.getElementById("packages-table-container").innerHTML = "";
  document.getElementById("packages-label").textContent =
    `Python ${version}`;
  document.getElementById("packages-path").textContent = label;

  // 打开文件夹按钮：指向 venv 根目录或 Python 所在目录
  const folderBtn = document.getElementById("btn-packages-open-folder");
  folderBtn.dataset.path = pythonPath;
  folderBtn.onclick = (e) => {
    e.stopPropagation();
    openFolder(pythonPath);
  };

  // 显示加载状态
  const container = document.getElementById("packages-table-container");
  container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)">正在加载包列表…</div>`;

  try {
    const resp = await fetch(`/api/packages?python_path=${encodeURIComponent(pythonPath)}`);
    const data = await resp.json();

    // 404 = Python/venv 路径已不存在（stale）
    if (resp.status === 404 || (data.error && data.error.includes("不存在"))) {
      showStaleEnvironment();
      return;
    }

    if (data.error) throw new Error(data.error);
    renderPackagesInTab(data.packages);
  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--red)">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

function showStaleEnvironment() {
  document.getElementById("packages-table-container").innerHTML = "";
  document.getElementById("packages-stale").hidden = false;
  document.getElementById("btn-remove-stale").onclick = () => {
    if (!selectedPython) return;
    // 从表格中移除对应行
    const path = selectedPython.pythonPath;
    // 尝试匹配 venv 路径（pythonPath 是 venv\Scripts\python.exe）
    const venvPath = path.replace(/\\Scripts\\python\.exe$/, "").replace(/\/bin\/python3?$/, "");
    document.querySelectorAll(".data-table__row--expandable").forEach((row) => {
      if (row.dataset.pythonPath === path) {
        row.remove();
        // 更新统计卡片
        const parent = row.closest(".tab-panel");
        if (parent && parent.id === "panel-venvs") {
          const count = parent.querySelectorAll(".data-table__row--expandable").length;
          updateStatCard("venvs", count);
        }
      }
    });
    // 返回之前的标签页
    document.getElementById("btn-packages-back").click();
    showToast("已从列表中移除该环境", "success");
  };
}

function renderPackagesInTab(packages) {
  const container = document.getElementById("packages-table-container");

  if (!packages.length) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted)">该环境没有安装任何包</div>`;
    return;
  }

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>包名</th><th>版本</th><th>大小</th><th>安全</th><th>简介</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${packages.map((p) => {
          const badgeInfo = p.safety === "danger"
            ? ["", "危险", "系统关键，不可卸载"]
            : p.safety === "warning"
            ? ["", "警告", `被 ${(p.required_by || []).length} 个包依赖`]
            : ["", "安全", "可安全卸载"];
          const [icon, label, tooltip] = badgeInfo;
          return `
          <tr class="sub-table__row sub-table__row--${p.safety}">
            <td><strong>${escapeHtml(p.name)}</strong></td>
            <td><span class="version">${escapeHtml(p.version)}</span></td>
            <td>${formatSize(p.size_mb)}</td>
            <td><span class="safety-badge safety-badge--${p.safety}" title="${tooltip}">${icon} ${label}</span></td>
            <td><span style="font-size:11px;color:var(--text-muted)">${escapeHtml(p.summary?.substring(0, 60) || "")}</span></td>
            <td><button class="btn btn--ghost btn--sm uninstall-btn" ${p.safety === "danger" ? "disabled title='系统关键包，不可卸载'" : ""} data-package="${escapeHtml(p.name)}">卸载</button></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

// ── 渲染 pip 缓存标签页（CSS 柱状图 + 分类表格）────────────────────

function renderPipCacheTab(pipCache) {
  const panel = document.getElementById("panel-pip-cache");
  const empty = panel.querySelector(".empty-state");
  let chart = panel.querySelector(".cache-chart");

  if (!pipCache.categories || !pipCache.categories.length) {
    if (empty) {
      empty.innerHTML = `
        <div class="empty-state__icon"></div>
        <p class="empty-state__text">未发现 pip 缓存</p>
        <p class="empty-state__hint">当前 pip 缓存为空，或者缓存目录不存在。</p>`;
      empty.hidden = false;
    }
    if (chart) chart.hidden = true;
    return;
  }

  if (empty) empty.hidden = true;
  if (chart) chart.remove();

  const maxSize = Math.max(...pipCache.categories.map((c) => c.size_mb), 1);

  const html = `
    <div class="cache-chart">
      <div class="cache-chart__summary">
        <span>缓存路径: <code>${escapeHtml(pipCache.path)}</code></span>
        <span style="font-weight:700;color:var(--accent)">总计 ${formatSize(pipCache.total_size_mb)}</span>
      </div>
      <div class="cache-chart__bars">
        ${pipCache.categories
          .map(
            (c) => `
          <div class="cache-bar-row">
            <div class="cache-bar-row__label">
              <span>${escapeHtml(c.name)}</span>
              <span style="color:var(--text-muted);font-size:11px">${formatSize(c.size_mb)} · ${c.file_count} 个文件</span>
            </div>
            <div class="cache-bar-row__track">
              <div class="cache-bar-row__fill" style="width:${Math.round((c.size_mb / maxSize) * 100)}%"></div>
            </div>
            <div class="cache-bar-row__desc">${escapeHtml(c.description)}</div>
          </div>`
          )
          .join("")}
      </div>
    </div>
  `;

  panel.insertAdjacentHTML("beforeend", html);
  panel.querySelector(".cache-chart").hidden = false;
}

// ── 辅助函数 ───────────────────────────────────────────────────────

function showScanBar(status, detail) {
  scanBar.hidden = false;
  document.getElementById("scan-status").textContent = status;
  document.getElementById("scan-detail").textContent = detail;
  document.getElementById("scan-fill").style.width = "0%";
}

function hideScanBar() {
  scanBar.hidden = true;
}

function hideAllEmptyStates() {
  document.querySelectorAll(".empty-state").forEach((el) => {
    el.hidden = true;
  });
}

function updateScanProgress(progress, status, detail = "") {
  scanBar.hidden = false;
  document.getElementById("scan-status").textContent = status;
  document.getElementById("scan-detail").textContent = detail;
  document.getElementById("scan-fill").style.width = `${Math.round(progress * 100)}%`;
}

function updateStatCard(cardId, value) {
  const el = document.getElementById(`stat-${cardId}`);
  if (el) el.textContent = value;
}

function showCondaTab(visible) {
  const tab = document.getElementById("tab-conda");
  tab.classList.toggle("tab-bar__tab--hidden", !visible);
}

function sourceLabel(source) {
  const labels = {
    "python.org": "python.org",
    "microsoft_store": "Microsoft Store",
    "conda": "Conda",
    "system": "系统",
    "unknown": "未知",
  };
  return labels[source] || source;
}

function formatSize(mb) {
  if (mb === undefined || mb === null || mb === 0) return "—";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function formatDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return "今天";
    if (days === 1) return "昨天";
    if (days < 30) return `${days} 天前`;
    if (days < 365) return `${Math.floor(days / 30)} 个月前`;
    return `${Math.floor(days / 365)} 年前`;
  } catch (e) {
    return "—";
  }
}

// ── 打开文件夹 ──────────────────────────────────────────────────────

async function openFolder(path) {
  try {
    const resp = await fetch("/api/open-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const data = await resp.json();
    if (!data.ok) {
      showToast(data.error || "打开文件夹失败", "error");
    }
  } catch (err) {
    showToast(`打开文件夹失败: ${err.message}`, "error");
  }
}

// ── 删除虚拟环境 ────────────────────────────────────────────────────

const deleteVenvModal = document.createElement("div");
deleteVenvModal.className = "modal-overlay";
deleteVenvModal.id = "delete-venv-modal";
deleteVenvModal.hidden = true;
deleteVenvModal.innerHTML = `
  <div class="modal">
    <div class="modal__header">
      <span class="modal__icon"></span>
      <h3 class="modal__title">删除虚拟环境</h3>
    </div>
    <div class="modal__body" id="delete-venv-body"></div>
    <div class="modal__footer" id="delete-venv-footer"></div>
  </div>
`;
document.body.appendChild(deleteVenvModal);

let deleteVenvTarget = null;

async function deleteVenv(path) {
  deleteVenvTarget = path;
  document.getElementById("delete-venv-body").innerHTML = `
    <p>确定要删除以下虚拟环境吗？</p>
    <p style="margin-top:8px"><code>${escapeHtml(path)}</code></p>
    <p style="margin-top:12px;color:var(--yellow)"> 此操作不可撤销，虚拟环境内的所有包将被删除。</p>
  `;
  document.getElementById("delete-venv-footer").innerHTML = `
    <button class="btn btn--ghost" onclick="document.getElementById('delete-venv-modal').hidden=true;deleteVenvTarget=null">取消</button>
    <button class="btn btn--danger" id="btn-confirm-delete-venv">确认删除</button>
  `;
  document.getElementById("delete-venv-modal").hidden = false;
  document.getElementById("btn-confirm-delete-venv").onclick = confirmDeleteVenv;
}

async function confirmDeleteVenv() {
  if (!deleteVenvTarget) return;
  const path = deleteVenvTarget;
  const btn = document.getElementById("btn-confirm-delete-venv");
  if (btn) btn.disabled = true;

  try {
    const resp = await fetch("/api/delete-venv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const data = await resp.json();

    if (data.ok) {
      document.getElementById("delete-venv-modal").hidden = true;
      deleteVenvTarget = null;
      showToast(data.message, "success");

      // 精确匹配：使用 data-venv-path 属性而非模糊子串匹配
      const row = document.querySelector(`#panel-venvs [data-venv-path="${path.replace(/\\/g, "\\\\")}"]`);
      if (row) {
        row.remove();
        const venvCount = document.querySelectorAll("#panel-venvs .data-table__row--expandable").length;
        updateStatCard("venvs", venvCount);
      }

      // 如果当前选中的是这个环境，清空包列表
      if (selectedPython && selectedPython.pythonPath.includes(path.replace(/\\/g, "\\\\"))) {
        selectedPython = null;
        document.getElementById("packages-content").hidden = true;
        document.getElementById("packages-empty").hidden = false;
      }
    } else {
      // 删除失败，显示详细错误
      document.getElementById("delete-venv-modal").hidden = true;
      deleteVenvTarget = null;
      const errMsg = data.message || data.error || "未知错误";
      showToast(`删除失败: ${errMsg}`, "error");
    }
  } catch (err) {
    document.getElementById("delete-venv-modal").hidden = true;
    deleteVenvTarget = null;
    showToast(`删除请求失败: ${err.message}`, "error");
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── 卸载流程 ─────────────────────────────────────────────────────────

const uninstallModal = document.getElementById("uninstall-modal");
let uninstallContext = null;  // { pythonPath, packageName }

// ── 文档级事件委托（统一处理所有动态生成的按钮和可展开行）──────

document.addEventListener("click", (e) => {
  // 1) 卸载按钮
  const uninstallBtn = e.target.closest(".uninstall-btn");
  if (uninstallBtn && !uninstallBtn.disabled) {
    e.stopPropagation();
    const packageName = uninstallBtn.dataset.package;
    const pythonPath = selectedPython?.pythonPath;
    if (!pythonPath) return;
    uninstallContext = { pythonPath, packageName };
    startUninstallFlow(pythonPath, packageName);
    return;
  }

  // 2) 打开文件夹按钮
  const openBtn = e.target.closest(".btn-open-folder");
  if (openBtn) {
    e.stopPropagation();
    openFolder(openBtn.dataset.path);
    return;
  }

  // 3) 删除虚拟环境按钮
  const delBtn = e.target.closest(".btn-delete-venv");
  if (delBtn) {
    e.stopPropagation();
    deleteVenv(delBtn.dataset.path);
    return;
  }

  // 4) 可展开行 — 跳转到包列表标签页
  const row = e.target.closest(".data-table__row--expandable");
  if (row && !e.target.closest("button")) {
    selectPythonRow(row);
  }
});

// 关闭弹窗（卸载弹窗 + 删除 venv 弹窗）
uninstallModal.addEventListener("click", (e) => {
  if (e.target === uninstallModal) closeModal();
});
deleteVenvModal.addEventListener("click", (e) => {
  if (e.target === deleteVenvModal) {
    deleteVenvModal.hidden = true;
    deleteVenvTarget = null;
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!uninstallModal.hidden) closeModal();
    if (!deleteVenvModal.hidden) {
      deleteVenvModal.hidden = true;
      deleteVenvTarget = null;
    }
    if (!aboutModal.hidden) aboutModal.hidden = true;
  }
});

async function startUninstallFlow(pythonPath, packageName) {
  // 先显示弹窗（loading 状态），避免等待 API 的延迟感
  document.getElementById("modal-icon").textContent = "";
  document.getElementById("modal-title").textContent = "正在检查…";
  document.getElementById("modal-body").innerHTML = `
    <p>正在检查 <code>${escapeHtml(packageName)}</code> 的安全性…</p>
  `;
  document.getElementById("modal-footer").innerHTML = "";
  uninstallModal.hidden = false;

  // 后台调用预览接口
  try {
    const resp = await fetch("/api/uninstall/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ python_path: pythonPath, package: packageName }),
    });
    const data = await resp.json();

    if (data.level === "danger") {
      showBlockedModal(packageName, data.message);
    } else if (data.level === "warning") {
      showWarningModal(packageName, data.required_by, data.message);
    } else {
      showConfirmModal(packageName, data.message);
    }
  } catch (err) {
    closeModal();
    showToast(`检查失败: ${err.message}`, "error");
  }
}

function showConfirmModal(packageName, message) {
  document.getElementById("modal-icon").textContent = "";
  document.getElementById("modal-title").textContent = "确认卸载";
  document.getElementById("modal-body").innerHTML = `
    <p>${escapeHtml(message)}</p>
    <p>确定要卸载 <code>${escapeHtml(packageName)}</code> 吗？</p>
  `;
  document.getElementById("modal-footer").innerHTML = `
    <button class="btn btn--ghost" onclick="closeModal()">取消</button>
    <button class="btn btn--danger" id="btn-confirm-uninstall">确认卸载</button>
  `;
  uninstallModal.hidden = false;

  document.getElementById("btn-confirm-uninstall").onclick = () => {
    executeUninstall(false);
  };
}

function showWarningModal(packageName, requiredBy, message) {
  document.getElementById("modal-icon").textContent = "";
  document.getElementById("modal-title").textContent = "依赖冲突警告";
  document.getElementById("modal-body").innerHTML = `
    <p>${escapeHtml(message)}</p>
    <p>以下包依赖 <code>${escapeHtml(packageName)}</code>：</p>
    <div class="dep-list">
      ${requiredBy.map((d) => `<span class="dep-tag">${escapeHtml(d)}</span>`).join("")}
    </div>
    <p style="margin-top:12px;color:var(--yellow)"> 强制卸载后，这些包可能无法正常工作。</p>
  `;
  document.getElementById("modal-footer").innerHTML = `
    <button class="btn btn--ghost" onclick="closeModal()">取消</button>
    <button class="btn btn--danger" id="btn-force-uninstall">强制卸载</button>
  `;
  uninstallModal.hidden = false;

  document.getElementById("btn-force-uninstall").onclick = () => {
    executeUninstall(true);
  };
}

function showBlockedModal(packageName, message) {
  document.getElementById("modal-icon").textContent = "";
  document.getElementById("modal-title").textContent = "禁止卸载";
  document.getElementById("modal-body").innerHTML = `
    <div class="blocked-msg">${escapeHtml(message)}</div>
    <p style="margin-top:12px"><code>${escapeHtml(packageName)}</code> 是系统关键包，不允许卸载。</p>
  `;
  document.getElementById("modal-footer").innerHTML = `
    <button class="btn btn--ghost" onclick="closeModal()">我知道了</button>
  `;
  uninstallModal.hidden = false;
}

function closeModal() {
  uninstallModal.hidden = true;
  uninstallContext = null;
}

async function executeUninstall(force) {
  if (!uninstallContext) return;

  const { pythonPath, packageName } = uninstallContext;
  const confirmBtn = document.activeElement;
  if (confirmBtn) confirmBtn.disabled = true;

  try {
    const resp = await fetch("/api/uninstall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        python_path: pythonPath,
        package: packageName,
        force: force,
      }),
    });
    const data = await resp.json();

    if (data.ok) {
      closeModal();
      showToast(data.message, "success");
      // 刷新包列表：重新展开当前行
      refreshCurrentPackageList(pythonPath);
    } else if (data.error === "DEPENDENCY_CONFLICT") {
      // 应该不会到这（force 已处理），但兜底
      showWarningModal(packageName, data.required_by, data.message);
    } else {
      closeModal();
      showToast(data.message || "卸载失败", "error");
    }
  } catch (err) {
    closeModal();
    showToast(`请求失败: ${err.message}`, "error");
  }
}

function refreshCurrentPackageList(pythonPath) {
  // 直接重新加载包列表标签页
  loadPackagesTab();
}

// ── Toast 提示 ───────────────────────────────────────────────────────

let toastTimer = null;

function showToast(message, type) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast toast--${type}`;
  toast.hidden = false;

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3000);
}

// ── 关于弹窗 ─────────────────────────────────────────────────────────

const aboutModal = document.createElement("div");
aboutModal.className = "modal-overlay";
aboutModal.id = "about-modal";
aboutModal.hidden = true;
aboutModal.innerHTML = `
  <div class="modal" style="width:560px">
    <div class="modal__header">
      <h3 class="modal__title">关于 PyPeek</h3>
    </div>
    <div class="modal__body" style="max-height:60vh;overflow-y:auto">
      <p style="font-size:14px;color:var(--text);font-weight:600;margin-bottom:12px">
        Python 环境桌面浏览器 — 双击即开，一眼看全你 Windows 机器上的 Python 安装、虚拟环境和 pip 缓存。
      </p>
      <p style="margin-bottom:4px;font-weight:600;color:var(--text);font-size:12px;text-transform:uppercase;letter-spacing:0.5px">术语</p>
      <table style="width:100%;font-size:12px;border-collapse:collapse;margin-bottom:16px">
        <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border);font-weight:600;white-space:nowrap">Python 安装</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);color:var(--text-muted)">系统上的 Python 解释器，可能来自 python.org、Microsoft Store、Conda</td></tr>
        <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border);font-weight:600;white-space:nowrap">虚拟环境</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);color:var(--text-muted)">通过 venv 创建的隔离环境，由 pyvenv.cfg 标识</td></tr>
        <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border);font-weight:600;white-space:nowrap">包</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);color:var(--text-muted)">可分发的 Python 代码单元，位于 site-packages 中</td></tr>
        <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border);font-weight:600;white-space:nowrap">pip 缓存</td><td style="padding:4px 8px;border-bottom:1px solid var(--border);color:var(--text-muted)">下载的包文件的本地存储，跨安装复用</td></tr>
      </table>
      <p style="margin-bottom:4px;font-weight:600;color:var(--text);font-size:12px;text-transform:uppercase;letter-spacing:0.5px">卸载安全等级</p>
      <table style="width:100%;font-size:12px;border-collapse:collapse">
        <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border)"><span class="safety-badge safety-badge--safe">安全</span></td><td style="padding:4px 8px;border-bottom:1px solid var(--border);color:var(--text-muted)">可卸载，无副作用</td></tr>
        <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border)"><span class="safety-badge safety-badge--warning">警告</span></td><td style="padding:4px 8px;border-bottom:1px solid var(--border);color:var(--text-muted)">其他包依赖此包，需强制确认</td></tr>
        <tr><td style="padding:4px 8px;border-bottom:1px solid var(--border)"><span class="safety-badge safety-badge--danger">危险</span></td><td style="padding:4px 8px;border-bottom:1px solid var(--border);color:var(--text-muted)">系统关键包（pip / setuptools / wheel），禁止卸载</td></tr>
      </table>
    </div>
    <div class="modal__footer">
      <button class="btn btn--ghost" onclick="document.getElementById('about-modal').hidden=true">关闭</button>
    </div>
  </div>
`;
document.body.appendChild(aboutModal);

document.getElementById("btn-about").addEventListener("click", () => {
  aboutModal.hidden = false;
});

aboutModal.addEventListener("click", (e) => {
  if (e.target === aboutModal) aboutModal.hidden = true;
});
