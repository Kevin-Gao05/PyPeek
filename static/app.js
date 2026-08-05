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

// ── 启动时加载缓存数据 ─────────────────────────────────────────────

(async function loadCachedData() {
  try {
    const resp = await fetch("/api/cache");
    const result = await resp.json();
    if (result.cached && result.data) {
      renderScanResults(result.data);
    } else {
      // 首次启动 — 显示欢迎弹窗
      document.getElementById("welcome-modal").hidden = false;
    }
  } catch (err) {
    // 静默回退 — 缓存不可用时展示空状态
  }
})();

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

  // 虚拟环境子标签栏仅在 venv 标签页激活且有数据时可见
  const venvSubTabs = document.getElementById("venv-sub-tabs");
  if (venvSubTabs) {
    if (tabName !== "venvs") {
      venvSubTabs.hidden = true;
    } else {
      // 只有数据表格可见时才显示子标签栏
      const table = document.querySelector("#panel-venvs .data-table");
      venvSubTabs.hidden = !table || table.hidden;
    }
  }
});

// ── 虚拟环境子标签切换 ─────────────────────────────────────────────

const venvSubTabBar = document.getElementById("venv-sub-tabs");
if (venvSubTabBar) {
  venvSubTabBar.addEventListener("click", (e) => {
    const subtab = e.target.closest(".sub-tab-bar__tab");
    if (!subtab) return;
    const subtabName = subtab.dataset.subtab;

    venvSubTabBar.querySelectorAll(".sub-tab-bar__tab").forEach((t) =>
      t.classList.remove("sub-tab-bar__tab--active"));
    subtab.classList.add("sub-tab-bar__tab--active");

    currentVenvSubtab = subtabName;

    const table = document.querySelector("#panel-venvs .data-table");
    if (table) applyVenvSubtabFilter(table);
  });
}

// ── 欢迎弹窗按钮 ───────────────────────────────────────────────────

const welcomeModal = document.getElementById("welcome-modal");
let needsOnboarding = false;

document.getElementById("btn-welcome-scan").addEventListener("click", () => {
  welcomeModal.hidden = true;
  needsOnboarding = true;
  btnRefresh.click();
  // 立刻启动教程，不等待扫描完成
  onboardingActive = true;
  _onboardingScanDone = false;
  setTimeout(() => showOnboardingStep(0), 300);
});

document.getElementById("btn-welcome-skip").addEventListener("click", () => {
  welcomeModal.hidden = true;
  needsOnboarding = false;
});

// 点击遮罩关闭欢迎弹窗
welcomeModal.addEventListener("click", (e) => {
  if (e.target === welcomeModal) welcomeModal.hidden = true;
});

// ── Onboarding 步骤定义 ───────────────────────────────────────────

const ONBOARDING_STEPS = [
  {
    title: "扫描结果一览",
    desc: "扫描完成后，这里展示本机 Python 安装数量、虚拟环境数量、pip 缓存占用和包总数。<br>点击卡片可快速跳转到对应标签页。",
    target: "#stat-cards",
    position: "below",
    prev: false,
    next: true,
    skip: true,
    finish: false,
  },
  {
    title: "切换标签页视图",
    desc: "通过这些标签页在不同视图间切换：<br>Python 安装 · 虚拟环境 · pip 缓存 · 包列表。",
    target: "#tab-bar",
    position: "below",
    prev: true,
    next: true,
    skip: true,
    finish: false,
    beforeShow() {
      const pyTab = tabBar.querySelector('[data-tab="pythons"]');
      if (pyTab) pyTab.click();
    },
  },
  {
    title: "正在扫描你的系统",
    desc: "PyPeek 正在搜索 PATH、注册表和磁盘上的 <code>pyvenv.cfg</code> 文件。<br>所有数据仅在本地处理，<strong>不会上传到任何云端服务器</strong>。<br>扫描完成后会自动进入下一步。",
    target: "#scan-bar",
    position: "below",
    prev: true,
    next: true,
    skip: true,
    finish: false,
  },
  {
    title: "展开查看包列表",
    desc: "点击 Python 或虚拟环境行，即可查看该环境已安装的所有包。<br>下方高亮的是第一行，试试点击它。",
    target: "#panel-pythons .data-table__row--expandable:first-child",
    position: "below",
    prev: true,
    next: true,
    skip: true,
    finish: false,
  },
  {
    title: "卸载前看清安全等级",
    desc: "<span class='safety-badge safety-badge--safe'>安全</span> 可直接卸载 &nbsp; <span class='safety-badge safety-badge--warning'>警告</span> 被其他包依赖 &nbsp; <span class='safety-badge safety-badge--danger'>危险</span> 系统关键包禁止卸载。<br>卸载前三思，关键包不可卸载。",
    target: "#panel-packages .safety-badge:first-of-type",
    position: "above",
    prev: true,
    next: false,
    skip: false,
    finish: true,
    beforeShow() {
      return new Promise((resolve) => {
        const firstRow = document.querySelector("#panel-pythons .data-table__row--expandable");
        if (firstRow) selectPythonRow(firstRow);
        let ticks = 0;
        const check = setInterval(() => {
          const badge = document.querySelector("#panel-packages .safety-badge");
          if (badge || ticks >= 30) { clearInterval(check); resolve(); }
          ticks++;
        }, 100);
      });
    },
    afterHide() {
      const backBtn = document.getElementById("btn-packages-back");
      if (backBtn) backBtn.click();
      selectedPython = null;
    },
  },
];

let onboardingActive = false;
let onboardingStep = -1;
let _onboardingScanDone = false;

function showOnboardingStep(n) {
  // 扫描步骤：如果扫描已完成则直接跳过
  if (n === 2 && _onboardingScanDone) {
    showOnboardingStep(3);
    return;
  }

  clearOnboardingHighlight();

  onboardingStep = n;
  const step = ONBOARDING_STEPS[n];
  const overlay = document.getElementById("onboarding-overlay");
  const stepLabel = document.getElementById("onboarding-step-label");
  const title = document.getElementById("onboarding-title");
  const desc = document.getElementById("onboarding-desc");
  const actions = document.getElementById("onboarding-actions");

  stepLabel.textContent = `第 ${n + 1} 步 / 共 ${ONBOARDING_STEPS.length} 步`;
  title.textContent = step.title;
  desc.innerHTML = step.desc;

  // 构建按钮
  let btns = "";
  if (step.prev) btns += `<button class="btn btn--ghost" id="btn-onboarding-prev">上一步</button>`;
  const skipLabel = n === 0 ? "跳过引导" : "跳过";
  if (step.skip) btns += `<button class="btn btn--ghost" id="btn-onboarding-skip">${skipLabel}</button>`;
  if (step.next) btns += `<button class="btn btn--primary" id="btn-onboarding-next">下一步</button>`;
  if (step.finish) btns += `<button class="btn btn--primary" id="btn-onboarding-finish">完成</button>`;
  actions.innerHTML = btns;

  // 绑定按钮
  const prevBtn = document.getElementById("btn-onboarding-prev");
  const nextBtn = document.getElementById("btn-onboarding-next");
  const skipBtn = document.getElementById("btn-onboarding-skip");
  const finishBtn = document.getElementById("btn-onboarding-finish");
  if (prevBtn) prevBtn.onclick = () => showOnboardingStep(n - 1);
  if (nextBtn) nextBtn.onclick = () => showOnboardingStep(n + 1);
  if (skipBtn) skipBtn.onclick = hideOnboarding;
  if (finishBtn) finishBtn.onclick = hideOnboarding;

  // 遮罩点击不关闭
  overlay.onclick = (e) => { if (e.target === overlay) e.stopPropagation(); };

  const doShow = () => {
    highlightOnboardingTarget(step.target);
    overlay.hidden = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        positionOnboardingTooltip(step.target, step.position);
      });
    });
  };

  if (step.beforeShow) {
    const result = step.beforeShow();
    if (result && typeof result.then === "function") {
      // 异步 beforeShow 需要更长延迟让 DOM 稳定，防止 tooltip 跳动
      result.then(() => setTimeout(doShow, 350));
    } else {
      doShow();
    }
  } else {
    doShow();
  }
}

function hideOnboarding() {
  const prevStep = ONBOARDING_STEPS[onboardingStep];
  onboardingActive = false;
  needsOnboarding = false;
  _onboardingScanDone = false;
  document.getElementById("onboarding-overlay").hidden = true;
  clearOnboardingHighlight();
  hideScanBar();
  if (prevStep && prevStep.afterHide) prevStep.afterHide();
  onboardingStep = -1;
}

function highlightOnboardingTarget(selector) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.scrollIntoView({ behavior: "instant", block: "center" });
  el.classList.add("onboarding-highlight");
}

function clearOnboardingHighlight() {
  document.querySelectorAll(".onboarding-highlight").forEach((el) =>
    el.classList.remove("onboarding-highlight"));
}

function positionOnboardingTooltip(targetSelector, position) {
  const target = document.querySelector(targetSelector);
  const tooltip = document.getElementById("onboarding-tooltip");
  if (!target || !tooltip) return;

  // 临时显示以获取真实尺寸
  tooltip.style.visibility = "hidden";
  tooltip.style.display = "";

  const tr = target.getBoundingClientRect();
  const tt = tooltip.getBoundingClientRect();
  const MARGIN = 14;

  let top;
  if (position === "above") {
    top = tr.top - tt.height - MARGIN;
    if (top < MARGIN) top = tr.bottom + MARGIN;
  } else {
    top = tr.bottom + MARGIN;
    if (top + tt.height > window.innerHeight - MARGIN) top = tr.top - tt.height - MARGIN;
  }

  let left = tr.left + (tr.width - tt.width) / 2;
  if (left < MARGIN) left = MARGIN;
  if (left + tt.width > window.innerWidth - MARGIN) left = window.innerWidth - tt.width - MARGIN;

  tooltip.style.top = Math.round(top) + "px";
  tooltip.style.left = Math.round(left) + "px";
  tooltip.style.visibility = "visible";
}

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

// ── 双向关联全局状态 ──────────────────────────────────────────────
let allPythonsData = [];
let allVenvsData = [];
let expandedLinkedPythonPath = null;

btnRefresh.addEventListener("click", () => {
  btnRefresh.disabled = true;
  showScanBar("正在启动扫描…", "");
  hideScanSummary();
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

// ── 共享渲染函数（缓存加载 + scan_complete 复用）──────────────────

function renderScanResults(data) {
  allPythonsData = data.pythons || [];
  allVenvsData = data.venvs || [];
  expandedLinkedPythonPath = null;

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
}

// ── SSE 连接 ───────────────────────────────────────────────────────

function connectSSE(scanId) {
  const url = `/api/scan/progress?scan_id=${scanId}`;
  const source = new EventSource(url);

  source.addEventListener("phase_update", (e) => {
    const data = JSON.parse(e.data);
    updateScanProgress(data.progress || 0, data.detail || data.phase, "");

    if (data.pythons) {
      allPythonsData = data.pythons;
      renderPythonsTable(data.pythons);
      updateStatCard("pythons", data.pythons.length);
    }
    if (data.venvs) {
      allVenvsData = data.venvs;
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

    renderScanResults(data);

    // 显示扫描摘要
    if (data.scan_summary) {
      showScanSummary(data.scan_summary);
    }

    updateScanProgress(1.0, "扫描完成", "");
    btnRefresh.disabled = false;

    // ── Onboarding: 扫描完成通知 + 自动推进 ────────────────────────
    _onboardingScanDone = true;
    if (onboardingActive && onboardingStep === 2) {
      // 用户在「扫描中」步骤，自动跳到下一步
      setTimeout(() => showOnboardingStep(3), 500);
    }
    if (!onboardingActive) {
      setTimeout(hideScanBar, 1500);
    }

    // 重复环境检测提示
    if (!onboardingActive) {
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

  // 清除任何之前展开的关联 venv 子行
  expandedLinkedPythonPath = null;

  if (!table) {
    panel.insertAdjacentHTML("beforeend", `
      <table class="data-table">
        <thead>
          <tr>
            <th>版本</th>
            <th>路径</th>
            <th>来源</th>
            <th>关联 venv</th>
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
    const venvCount = allVenvsData.filter((v) =>
      v.home_python && isRelatedPython(v.home_python, py.path)
    ).length;

    const tr = document.createElement("tr");
    tr.dataset.pythonPath = py.path;
    tr.innerHTML = `
      <td>
        <span class="version">${escapeHtml(py.version)}</span>
        ${py.duplicate_group ? `<span class="dup-badge" title="可能存在重复安装：&#10;${py.duplicate_group.map(p => escapeHtml(p)).join('&#10;')}"> 重复</span>` : ""}
      </td>
      <td><code class="path">${escapeHtml(py.path)}</code></td>
      <td><span class="badge badge--${escapeHtml(py.source)}">${sourceLabel(py.source)}</span></td>
      <td>${venvCount > 0
        ? `<span class="linked-venv-count" data-python-path="${escapeHtml(py.path)}" data-count="${venvCount}">${venvCount} 个 venv <span class="linked-venv-count__arrow">▸</span></span>`
        : `<span style="font-size:11px;color:var(--text-muted)">—</span>`}</td>
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

let currentVenvSubtab = "all";  // "all" | "duplicates"

function renderVenvsTable(venvs) {
  const panel = document.getElementById("panel-venvs");
  const emptyAll = document.getElementById("venv-empty-all");
  const emptyDup = document.getElementById("venv-empty-duplicates");
  const subTabBar = document.getElementById("venv-sub-tabs");
  let table = panel.querySelector(".data-table");

  if (!venvs.length) {
    if (emptyAll) emptyAll.hidden = false;
    if (emptyDup) emptyDup.hidden = true;
    if (subTabBar) subTabBar.hidden = true;
    if (table) table.hidden = true;
    return;
  }

  if (emptyAll) emptyAll.hidden = true;
  if (emptyDup) emptyDup.hidden = true;

  // ── 子标签栏：显示 + 更新重复计数 ─────────────────────────────────
  const dupCount = venvs.filter((v) => v.duplicate_group).length;
  if (subTabBar) {
    subTabBar.hidden = false;
    document.getElementById("subtab-dup-count").textContent = dupCount;
  }

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
    table = panel.querySelector(".data-table");
  }

  // ── 清除旧的重复分组样式 ─────────────────────────────────────────
  table.querySelectorAll(".data-table__row--dup-group").forEach((r) =>
    r.classList.remove("data-table__row--dup-group"));
  table.querySelectorAll("[data-dup-group]").forEach((r) =>
    r.removeAttribute("data-dup-group"));

  const tbody = table.querySelector("tbody");
  tbody.innerHTML = "";

  // ── 构建重复组映射（canonical key → color index）───────────────────
  const dupGroupColors = new Map();
  let colorIndex = 0;

  venvs.forEach((v) => {
    const tr = document.createElement("tr");
    // 正确检测 Windows 路径（单反斜杠）
    const isWin = v.path.includes("\\") || /^[A-Za-z]:/.test(v.path);
    const pythonPath = isWin
      ? v.path + "\\Scripts\\python.exe"
      : v.path + "/bin/python3";
    tr.dataset.pythonPath = pythonPath;
    tr.dataset.venvPath = v.path;  // 精确路径用于删除匹配

    // 重复组标记 — 用于子标签过滤和视觉分组
    if (v.duplicate_group) {
      const groupKey = getDuplicateGroupKey(v);
      tr.dataset.dupGroup = groupKey;
      if (!dupGroupColors.has(groupKey)) {
        dupGroupColors.set(groupKey, colorIndex++);
      }
    }

    tr.innerHTML = `
      <td><code class="path">${escapeHtml(v.path)}</code></td>
      <td>
        <span class="version">${escapeHtml(v.python_version)}</span>
        ${v.duplicate_group ? `<span class="dup-badge" title="可能存在重复环境：&#10;${v.duplicate_group.map(p => escapeHtml(p)).join('&#10;')}"> 重复</span>` : ""}
      </td>
      <td>${renderHomePythonCell(v.home_python)}</td>
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

  // ── 应用重复组视觉样式 ────────────────────────────────────────────
  applyDuplicateGroupStyling(tbody, dupGroupColors);

  table.hidden = false;

  // ── 应用当前子标签过滤器 ──────────────────────────────────────────
  applyVenvSubtabFilter(table);
}

function getDuplicateGroupKey(entry) {
  const all = [entry.path, ...(entry.duplicate_group || [])].sort();
  return all[0];
}

function applyDuplicateGroupStyling(tbody, dupGroupColors) {
  const DUP_COLORS = [
    "var(--accent)",       // #E4002B red
    "#2563EB",             // blue
    "#7C3AED",             // purple
    "#059669",             // green
    "#D97706",             // amber
    "#DB2777",             // pink
    "#0891B2",             // cyan
    "#4F46E5",             // indigo
  ];

  const rows = tbody.querySelectorAll("[data-dup-group]");
  // 按 group key 分组
  const groups = new Map();
  rows.forEach((row) => {
    const key = row.dataset.dupGroup;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  groups.forEach((groupRows) => {
    const colorIdx = dupGroupColors.get(groupRows[0].dataset.dupGroup) % DUP_COLORS.length;
    const color = DUP_COLORS[colorIdx];
    groupRows.forEach((row) => {
      row.classList.add("data-table__row--dup-group");
      row.style.setProperty("--dup-group-color", color);
    });
  });
}

function applyVenvSubtabFilter(table) {
  const rows = table.querySelectorAll(".data-table__row--expandable");
  const dupEmpty = document.getElementById("venv-empty-duplicates");

  if (currentVenvSubtab === "duplicates") {
    let visibleCount = 0;
    rows.forEach((row) => {
      if (row.dataset.dupGroup) {
        row.style.display = "";
        visibleCount++;
      } else {
        row.style.display = "none";
      }
    });
    if (visibleCount === 0) {
      if (dupEmpty) dupEmpty.hidden = false;
      table.hidden = true;
    } else {
      if (dupEmpty) dupEmpty.hidden = true;
      table.hidden = false;
    }
  } else {
    // "全部" — 显示所有行
    rows.forEach((row) => { row.style.display = ""; });
    if (dupEmpty) dupEmpty.hidden = true;
    table.hidden = false;
  }
}

function _cleanupDuplicateGroup(groupKey, deletedPath) {
  // 从同组其他成员的 duplicate_group 中移除已删除的路径
  const siblings = [];
  for (let i = 0; i < allVenvsData.length; i++) {
    const v = allVenvsData[i];
    if (v.duplicate_group && getDuplicateGroupKey(v) === groupKey) {
      siblings.push(i);
    }
  }

  siblings.forEach((idx) => {
    const v = allVenvsData[idx];
    v.duplicate_group = v.duplicate_group.filter((p) => p !== deletedPath);
    if (v.duplicate_group.length === 0) {
      delete v.duplicate_group;
    }
  });

  // 同步 DOM：如果某行不再是重复环境，清除标记和样式
  if (siblings.length === 1) {
    // 只剩一个成员 → 不再是重复
    const remaining = allVenvsData[siblings[0]];
    if (!remaining.duplicate_group) {
      const row = document.querySelector(`#panel-venvs [data-venv-path="${remaining.path.replace(/\\/g, "\\\\")}"]`);
      if (row) {
        row.removeAttribute("data-dup-group");
        row.classList.remove("data-table__row--dup-group");
        row.style.removeProperty("--dup-group-color");
        // 移除重复徽章
        const badge = row.querySelector(".dup-badge");
        if (badge) badge.remove();
      }
    }
  } else if (siblings.length > 1) {
    // 更新剩余成员的重复徽章 tooltip
    siblings.forEach((idx) => {
      const v = allVenvsData[idx];
      if (!v.duplicate_group) return;
      const row = document.querySelector(`#panel-venvs [data-venv-path="${v.path.replace(/\\/g, "\\\\")}"]`);
      if (row) {
        const badge = row.querySelector(".dup-badge");
        if (badge) {
          badge.title = `可能存在重复环境：\n${v.duplicate_group.map((p) => escapeHtml(p)).join("\n")}`;
        }
      }
    });
  }
}

// ── Python ↔ Venv 双向关联辅助函数 ────────────────────────────────

function normalizePath(p) {
  return p.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "");
}

function getPythonDir(pythonPath) {
  const norm = pythonPath.replace(/\\/g, "/");
  const lastSep = norm.lastIndexOf("/");
  return lastSep > 0 ? norm.substring(0, lastSep) : norm;
}

function isRelatedPython(homePython, pythonExePath) {
  if (!homePython || !pythonExePath) return false;
  const home = normalizePath(homePython);
  const exeDir = normalizePath(getPythonDir(pythonExePath));
  if (home === exeDir) return true;
  if (exeDir.startsWith(home + "/")) return true;
  if (home.startsWith(exeDir + "/")) return true;
  return false;
}

function findMatchingVenvs(pythonPath) {
  return allVenvsData.filter((v) =>
    v.home_python && isRelatedPython(v.home_python, pythonPath)
  );
}

function findPythonByHome(homePython) {
  if (!homePython || !allPythonsData.length) return null;
  for (const py of allPythonsData) {
    if (isRelatedPython(homePython, py.path)) {
      return py.path;
    }
  }
  return null;
}

function renderHomePythonCell(homePython) {
  if (!homePython) {
    return `<span class="home-python-unknown">未知</span>`;
  }
  const matchingPyPath = findPythonByHome(homePython);
  if (matchingPyPath) {
    return `<span class="home-python-link" data-navigate-to="${escapeHtml(matchingPyPath)}" title="点击跳转到对应 Python 安装">${escapeHtml(homePython)}</span>`;
  }
  return `<span class="home-python-unknown">${escapeHtml(homePython)}</span>`;
}

function toggleLinkedVenvs(pythonPath, badgeElement) {
  const row = badgeElement.closest("tr");
  if (!row) return;

  // If already expanded, collapse
  if (expandedLinkedPythonPath === pythonPath) {
    collapseLinkedVenvs();
    return;
  }

  // Collapse any existing expanded row
  collapseLinkedVenvs();

  // Expand
  expandedLinkedPythonPath = pythonPath;
  badgeElement.classList.add("linked-venv-count--expanded");
  const arrow = badgeElement.querySelector(".linked-venv-count__arrow");
  if (arrow) arrow.textContent = "▾";

  const venvs = findMatchingVenvs(pythonPath);
  const subRow = createLinkedVenvRow(venvs);
  row.after(subRow);
}

function collapseLinkedVenvs() {
  if (!expandedLinkedPythonPath) return;

  // Remove sub-row
  const subRow = document.querySelector("#panel-pythons .linked-venv-row");
  if (subRow) subRow.remove();

  // Reset badge
  const badge = document.querySelector("#panel-pythons .linked-venv-count--expanded");
  if (badge) {
    badge.classList.remove("linked-venv-count--expanded");
    const arrow = badge.querySelector(".linked-venv-count__arrow");
    if (arrow) arrow.textContent = "▸";
  }

  expandedLinkedPythonPath = null;
}

function createLinkedVenvRow(venvs) {
  const tr = document.createElement("tr");
  tr.className = "linked-venv-row";
  tr.innerHTML = `
    <td colspan="7">
      <div class="linked-venv-container">
        <table class="data-table sub-table">
          <thead>
            <tr>
              <th>路径</th>
              <th>版本</th>
              <th>大小</th>
              <th>包数量</th>
              <th>最后修改</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${venvs.map((v) => `
              <tr class="sub-table__row" data-venv-path="${escapeHtml(v.path)}" style="cursor:pointer" title="点击跳转到虚拟环境标签页">
                <td><code class="path">${escapeHtml(v.path)}</code></td>
                <td><span class="version">${escapeHtml(v.python_version)}</span></td>
                <td>${formatSize(v.total_size_mb)}</td>
                <td>${v.package_count}</td>
                <td><span style="font-size:11px;color:var(--text-muted)">${formatDate(v.last_modified)}</span></td>
                <td>
                  <button class="btn btn--ghost btn--sm btn-open-folder" data-path="${escapeHtml(v.path)}" title="在文件管理器中打开"></button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </td>
  `;
  return tr;
}

function navigateToPythonTab(pythonPath) {
  // Switch to Python tab
  const pyTab = tabBar.querySelector('[data-tab="pythons"]');
  if (pyTab) pyTab.click();

  // Find and highlight the row
  setTimeout(() => {
    const rows = document.querySelectorAll("#panel-pythons .data-table__row--expandable");
    for (const row of rows) {
      if (row.dataset.pythonPath === pythonPath) {
        row.classList.add("data-table__row--highlight");
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => row.classList.remove("data-table__row--highlight"), 1500);
        break;
      }
    }
  }, 100);
}

function navigateToVenvTab(venvPath) {
  // Switch to venv tab
  const venvTab = tabBar.querySelector('[data-tab="venvs"]');
  if (venvTab) venvTab.click();

  // Find and highlight the row
  setTimeout(() => {
    const rows = document.querySelectorAll("#panel-venvs .data-table__row--expandable");
    for (const row of rows) {
      if (row.dataset.venvPath === venvPath) {
        row.classList.add("data-table__row--highlight");
        row.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => row.classList.remove("data-table__row--highlight"), 1500);
        break;
      }
    }
  }, 100);
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

  // 清理旧的缓存图表（可能有多个残留，用 querySelectorAll 全部移除）
  panel.querySelectorAll(".cache-chart").forEach((el) => el.remove());

  if (!pipCache.categories || !pipCache.categories.length) {
    if (empty) {
      empty.innerHTML = `
        <div class="empty-state__icon"></div>
        <p class="empty-state__text">未发现 pip 缓存</p>
        <p class="empty-state__hint">当前 pip 缓存为空，或者缓存目录不存在。</p>`;
      empty.hidden = false;
    }
    return;
  }

  if (empty) empty.hidden = true;

  const maxSize = Math.max(...pipCache.categories.map((c) => c.size_mb), 1);

  const html = `
    <div class="cache-chart">
      <div class="cache-chart__summary">
        <span>缓存路径: <code>${escapeHtml(pipCache.path)}</code></span>
        <span style="display:flex;align-items:center;gap:12px">
          <span style="font-weight:700;color:var(--accent)">总计 ${formatSize(pipCache.total_size_mb)}</span>
          <button class="btn btn--danger btn--sm btn-clear-all-cache"
            ${pipCache.total_size_mb === 0 ? "disabled" : ""}>清理全部缓存</button>
        </span>
      </div>
      <div class="cache-chart__bars">
        ${pipCache.categories
          .map(
            (c) => `
          <div class="cache-bar-row">
            <div class="cache-bar-row__label">
              <span>${escapeHtml(c.name)}</span>
              <span style="display:flex;align-items:center;gap:10px">
                <span style="color:var(--text-muted);font-size:11px">${formatSize(c.size_mb)} · ${c.file_count} 个文件</span>
                <button class="btn btn--ghost btn--sm btn-clear-cache"
                  data-category-path="${escapeHtml(c.path)}"
                  data-category-name="${escapeHtml(c.name)}"
                  ${c.size_mb === 0 ? "disabled" : ""}>清理</button>
              </span>
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

function showScanSummary(summary) {
  const el = document.getElementById("scan-summary");
  document.getElementById("summary-drives").textContent =
    (summary.drives_scanned && summary.drives_scanned.length)
      ? summary.drives_scanned.join(" ") : "—";
  document.getElementById("summary-files").textContent =
    summary.files_checked ?? "—";
  document.getElementById("summary-duration").textContent =
    summary.duration_seconds ?? "—";
  el.hidden = false;
}

function hideScanSummary() {
  document.getElementById("scan-summary").hidden = true;
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
        const deletedDupGroup = row.dataset.dupGroup;

        row.remove();
        const venvCount = document.querySelectorAll("#panel-venvs .data-table__row--expandable").length;
        updateStatCard("venvs", venvCount);

        // 更新 allVenvsData
        allVenvsData = allVenvsData.filter((v) => v.path !== path);

        // 清理同组其他成员的 duplicate_group 引用
        if (deletedDupGroup) {
          _cleanupDuplicateGroup(deletedDupGroup, path);
        }

        // 更新子标签栏重复计数
        const dupCount = allVenvsData.filter((v) => v.duplicate_group).length;
        const dupCountEl = document.getElementById("subtab-dup-count");
        if (dupCountEl) dupCountEl.textContent = dupCount;

        // 重新应用过滤器（删除后可能触发空状态）
        const table = document.querySelector("#panel-venvs .data-table");
        if (table) applyVenvSubtabFilter(table);
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
let cacheClearContext = null;  // { categoryPath, categoryName, clearAll }

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

  // 4) 缓存清理按钮（单个分类）
  const clearCacheBtn = e.target.closest(".btn-clear-cache");
  if (clearCacheBtn && !clearCacheBtn.disabled) {
    e.stopPropagation();
    const catPath = clearCacheBtn.dataset.categoryPath;
    const catName = clearCacheBtn.dataset.categoryName;
    cacheClearContext = { categoryPath: catPath, categoryName: catName, clearAll: false };
    startCacheClearFlow();
    return;
  }

  // 5) 清理全部缓存按钮
  const clearAllBtn = e.target.closest(".btn-clear-all-cache");
  if (clearAllBtn && !clearAllBtn.disabled) {
    e.stopPropagation();
    cacheClearContext = { clearAll: true };
    startCacheClearFlow();
    return;
  }

  // 6) 关联 venv 数量徽章 — 展开/收起子列表
  const linkedBadge = e.target.closest(".linked-venv-count");
  if (linkedBadge) {
    e.stopPropagation();
    toggleLinkedVenvs(linkedBadge.dataset.pythonPath, linkedBadge);
    return;
  }

  // 7) 来源 Python 链接 — 跳转到 Python 标签页
  const homeLink = e.target.closest(".home-python-link");
  if (homeLink) {
    e.stopPropagation();
    navigateToPythonTab(homeLink.dataset.navigateTo);
    return;
  }

  // 8) 关联 venv 子列表中的行 — 跳转到虚拟环境标签页
  const linkedVenvRow = e.target.closest(".linked-venv-row .sub-table__row");
  if (linkedVenvRow && !e.target.closest("button")) {
    e.stopPropagation();
    navigateToVenvTab(linkedVenvRow.dataset.venvPath);
    return;
  }

  // 9) 可展开行 — 跳转到包列表标签页
  const row = e.target.closest(".data-table__row--expandable");
  if (row && !e.target.closest("button") && !e.target.closest(".linked-venv-count") && !e.target.closest(".home-python-link")) {
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
    if (onboardingActive) { hideOnboarding(); return; }
    if (!welcomeModal.hidden) { welcomeModal.hidden = true; return; }
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
  cacheClearContext = null;
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

// ── 缓存清理流程 ─────────────────────────────────────────────────────

async function startCacheClearFlow() {
  if (!cacheClearContext) return;

  // 显示 loading 弹窗
  document.getElementById("modal-icon").textContent = "";
  document.getElementById("modal-title").textContent = "正在检查…";
  document.getElementById("modal-body").innerHTML = `<p>正在分析缓存内容…</p>`;
  document.getElementById("modal-footer").innerHTML = "";
  uninstallModal.hidden = false;

  try {
    const body = cacheClearContext.clearAll
      ? { all: true }
      : { category_path: cacheClearContext.categoryPath, category_name: cacheClearContext.categoryName };

    const resp = await fetch("/api/cache/clear/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();

    if (data.error) {
      closeModal();
      showToast(data.error, "error");
      return;
    }

    showCacheClearModal(data);
  } catch (err) {
    closeModal();
    showToast(`检查失败: ${err.message}`, "error");
  }
}

function showCacheClearModal(data) {
  document.getElementById("modal-icon").textContent = "";
  document.getElementById("modal-title").textContent = "确认清理缓存";

  if (data.all) {
    const catList = (data.categories || []).map((n) => `<span class="dep-tag">${escapeHtml(n)}</span>`).join("");
    document.getElementById("modal-body").innerHTML = `
      <p>${escapeHtml(data.message)}</p>
      ${catList ? `<div class="dep-list">${catList}</div>` : ""}
      ${data.risk ? `<p style="margin-top:12px;color:var(--yellow)"> ${escapeHtml(data.risk)}</p>` : ""}
      <p style="margin-top:12px;color:var(--text-muted)">共 ${data.file_count} 个文件，${formatSize(data.size_mb)}。</p>
    `;
  } else {
    document.getElementById("modal-body").innerHTML = `
      <p>确定要清理 <code>${escapeHtml(data.name)}</code> 吗？</p>
      <p>${escapeHtml(data.message)}</p>
      ${data.risk ? `<p style="margin-top:8px;color:var(--yellow)"> ${escapeHtml(data.risk)}</p>` : ""}
    `;
  }

  document.getElementById("modal-footer").innerHTML = `
    <button class="btn btn--ghost" onclick="closeModal()">取消</button>
    <button class="btn btn--danger" id="btn-confirm-cache-clear">确认清理</button>
  `;
  uninstallModal.hidden = false;

  document.getElementById("btn-confirm-cache-clear").onclick = () => {
    executeCacheClear();
  };
}

async function executeCacheClear() {
  if (!cacheClearContext) return;

  const confirmBtn = document.getElementById("btn-confirm-cache-clear");
  if (confirmBtn) confirmBtn.disabled = true;

  try {
    const body = cacheClearContext.clearAll
      ? { all: true, confirm: true }
      : { category_path: cacheClearContext.categoryPath, confirm: true };

    const resp = await fetch("/api/cache/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();

    if (data.ok) {
      closeModal();
      showToast(data.message, "success");
      refreshPipCacheTab();
    } else {
      closeModal();
      showToast(data.message || "清理失败", "error");
    }
  } catch (err) {
    closeModal();
    showToast(`请求失败: ${err.message}`, "error");
  }
}

async function refreshPipCacheTab() {
  try {
    const resp = await fetch("/api/pip-cache");
    const data = await resp.json();
    if (data.error) {
      showToast(data.error, "error");
      return;
    }
    renderPipCacheTab(data);
    updateStatCard("pip-cache", formatSize(data.total_size_mb));
  } catch (err) {
    showToast(`刷新缓存数据失败: ${err.message}`, "error");
  }
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

// ── 「?」帮助按钮 — 重新进入教程（从 Step 1 开始）────────────────

const btnHelp = document.getElementById("btn-help");
if (btnHelp) {
  btnHelp.addEventListener("click", () => {
    if (onboardingActive) return;
    // 检查是否有数据可展示
    const hasData = document.querySelector("#panel-pythons .data-table") &&
                    !document.querySelector("#panel-pythons .data-table").hidden;
    if (!hasData) {
      showToast("请先完成一次扫描", "error");
      return;
    }
    onboardingActive = true;
    showOnboardingStep(0);
  });
}
