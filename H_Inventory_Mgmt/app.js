/* H.PLACE 재고 관리
   ─────────────────────────────────────────────
   모든 데이터는 브라우저의 localStorage 에 저장됩니다.
   재고 수량은 따로 저장하지 않고 거래 내역(입고·출고·이동·조정)을 모두 더해서 계산합니다.
   그래서 거래 내역만 맞으면 재고는 항상 맞습니다. */

const STORE_KEY = "hplace-inventory-v1";

const CATEGORIES = ["염모제", "펌제", "샴푸 · 트리트먼트", "스타일링", "소모품", "기타"];

const TYPE_LABEL = { in: "입고", out: "출고 · 사용", transfer: "지점 이동", adjust: "실사 조정" };
const TYPE_BADGE = { in: "in", out: "use", transfer: "transfer", adjust: "adjust" };

/* ── 유틸 ───────────────────────────────────── */
const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Number(n || 0).toLocaleString("ko-KR");
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => toDateStr(new Date());
function toDateStr(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("error", isError);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

/* ── 예시 데이터 ────────────────────────────── */
function sampleData() {
  const branches = ["서초아크로비스타점", "서초교대점", "송파헬리오시티점", "잠실학원사거리점", "정자역점"]
    .map((name) => ({ id: uid(), name }));

  const products = [
    ["CL-001", "로레알 마지렐 6.1 애쉬브라운", "염모제", "통", 10, 12000, "로레알 코리아"],
    ["CL-002", "로레알 마지렐 7.0 내추럴", "염모제", "통", 10, 12000, "로레알 코리아"],
    ["CL-010", "산화제 6% 1L", "염모제", "병", 6, 9000, "로레알 코리아"],
    ["PM-001", "볼륨매직 1제 500ml", "펌제", "통", 5, 18000, "아모스프로페셔널"],
    ["PM-002", "셋팅펌 2제 1L", "펌제", "통", 5, 15000, "아모스프로페셔널"],
    ["SH-001", "업소용 샴푸 1500ml", "샴푸 · 트리트먼트", "통", 4, 22000, "케라스타즈"],
    ["SH-002", "업소용 트리트먼트 1000ml", "샴푸 · 트리트먼트", "통", 4, 26000, "케라스타즈"],
    ["ST-001", "헤어 에센스 100ml", "스타일링", "개", 8, 14000, "아모스프로페셔널"],
    ["SU-001", "염색 장갑 (100매)", "소모품", "박스", 3, 7000, "미용재료상사"],
    ["SU-002", "호일 페이퍼", "소모품", "롤", 5, 4500, "미용재료상사"],
    ["SU-003", "일회용 가운", "소모품", "팩", 4, 11000, "미용재료상사"],
    ["SU-004", "타월 (40장)", "소모품", "묶음", 2, 32000, "미용재료상사"]
  ].map(([sku, name, category, unit, minStock, price, supplier]) =>
    ({ id: uid(), sku, name, category, unit, minStock, price, supplier }));

  // 매번 같은 예시가 나오도록 간단한 난수 생성기를 씁니다
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toDateStr(d); };

  const transactions = [];
  const held = {};
  const key = (b, p) => b.id + p.id;
  let t = Date.now() - 40 * 864e5;
  for (const b of branches) {
    for (const p of products) {
      const qty = p.minStock * 2 + Math.floor(rand() * 6);
      held[key(b, p)] = qty;
      transactions.push({ id: uid(), type: "in", date: daysAgo(30), branchId: b.id, productId: p.id,
        qty, note: "초기 재고", createdAt: t++ });
    }
  }
  for (let day = 28; day >= 0; day--) {
    for (let k = 0; k < 4; k++) {
      const b = branches[Math.floor(rand() * branches.length)];
      const p = products[Math.floor(rand() * products.length)];
      const qty = Math.min(1 + Math.floor(rand() * 3), held[key(b, p)]);
      if (!qty) continue;
      held[key(b, p)] -= qty;
      transactions.push({ id: uid(), type: "out", date: daysAgo(day), branchId: b.id, productId: p.id,
        qty, note: "시술 사용", createdAt: t++ });
    }
    if (day % 7 === 3) {
      const b = branches[Math.floor(rand() * branches.length)];
      for (const p of products.slice(0, 5)) {
        held[key(b, p)] += 5;
        transactions.push({ id: uid(), type: "in", date: daysAgo(day), branchId: b.id, productId: p.id,
          qty: 5, note: "정기 발주", createdAt: t++ });
      }
    }
  }
  transactions.push({ id: uid(), type: "transfer", date: daysAgo(2), branchId: branches[0].id, toBranchId: branches[1].id,
    productId: products[5].id, qty: 2, note: "교대점 샴푸 부족분 지원", createdAt: t++ });

  const state = { branches, products, transactions };

  // 예시 화면에 부족 재고가 보이도록 일부를 거의 다 쓴 상태로 만듭니다
  const stock = computeStock(state);
  [[1, 3], [2, 8], [4, 1]].forEach(([bi, pi]) => {
    const b = branches[bi], p = products[pi];
    const cur = stock[b.id]?.[p.id] || 0;
    const target = Math.max(0, p.minStock - 2 - bi);
    if (cur > target) transactions.push({ id: uid(), type: "out", date: daysAgo(0), branchId: b.id, productId: p.id,
      qty: cur - target, note: "시술 사용", createdAt: t++ });
  });
  return state;
}

/* ── 저장 · 불러오기 ────────────────────────── */
let state;

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (isValidState(data)) return data;
    }
  } catch (e) { console.warn("저장된 데이터를 읽지 못했습니다", e); }
  return sampleData();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast("저장하지 못했습니다. 브라우저 저장 공간을 확인하세요.", true); }
}
function isValidState(d) {
  return d && Array.isArray(d.branches) && Array.isArray(d.products) && Array.isArray(d.transactions);
}

/* ── 계산 ───────────────────────────────────── */
function computeStock(s = state) {
  const stock = {};
  const add = (b, p, n) => {
    stock[b] ??= {};
    stock[b][p] = (stock[b][p] || 0) + n;
  };
  for (const t of s.transactions) {
    if (t.type === "in") add(t.branchId, t.productId, t.qty);
    else if (t.type === "out") add(t.branchId, t.productId, -t.qty);
    else if (t.type === "adjust") add(t.branchId, t.productId, t.qty);
    else if (t.type === "transfer") { add(t.branchId, t.productId, -t.qty); add(t.toBranchId, t.productId, t.qty); }
  }
  return stock;
}
const qtyOf = (stock, bId, pId) => stock[bId]?.[pId] || 0;
function status(qty, min) {
  if (qty <= 0) return { cls: "out", label: "품절" };
  if (qty < min) return { cls: "low", label: "부족" };
  return { cls: "ok", label: "정상" };
}
const branchName = (id) => state.branches.find((b) => b.id === id)?.name ?? "(삭제된 지점)";
const productOf = (id) => state.products.find((p) => p.id === id);
const scopeBranches = () => {
  const f = $("#branchFilter").value;
  return f ? state.branches.filter((b) => b.id === f) : state.branches;
};

/* ── 화면: 대시보드 ─────────────────────────── */
function renderDashboard() {
  const stock = computeStock();
  const branches = scopeBranches();
  const ids = new Set(branches.map((b) => b.id));

  let value = 0;
  const low = [];
  for (const b of branches) {
    for (const p of state.products) {
      const q = qtyOf(stock, b.id, p.id);
      value += Math.max(q, 0) * (p.price || 0);
      if (q < p.minStock) low.push({ b, p, q });
    }
  }
  low.sort((a, c) => a.q / (a.p.minStock || 1) - c.q / (c.p.minStock || 1));

  const t = today();
  const monthPrefix = t.slice(0, 7);
  const touches = (x) => ids.has(x.branchId) || ids.has(x.toBranchId);
  const todayIn = state.transactions.filter((x) => x.date === t && x.type === "in" && ids.has(x.branchId)).length;
  const monthOut = state.transactions
    .filter((x) => x.date.startsWith(monthPrefix) && x.type === "out" && ids.has(x.branchId))
    .reduce((sum, x) => sum + x.qty * (productOf(x.productId)?.price || 0), 0);

  $("#kpis").innerHTML = `
    <div class="kpi"><div class="label">재고 금액</div><div class="value">${fmt(value)}<small>원</small></div></div>
    <div class="kpi ${low.length ? "alert" : ""}"><div class="label">부족 · 품절</div><div class="value">${low.length}<small>건</small></div></div>
    <div class="kpi"><div class="label">오늘 입고</div><div class="value">${todayIn}<small>건</small></div></div>
    <div class="kpi"><div class="label">이번 달 사용 금액</div><div class="value">${fmt(monthOut)}<small>원</small></div></div>`;

  $("#lowCount").textContent = low.length ? `${low.length}건` : "";
  $("#lowList").innerHTML = low.length
    ? `<ul class="rows">${low.slice(0, 10).map(({ b, p, q }) => {
        const s = status(q, p.minStock);
        return `<li><div>${esc(p.name)}<div class="sub">${esc(b.name)} · 최소 ${fmt(p.minStock)}${esc(p.unit)}</div></div>
          <div><b>${fmt(q)}</b> ${esc(p.unit)} <span class="badge ${s.cls}">${s.label}</span></div></li>`;
      }).join("")}</ul>${low.length > 10 ? `<p class="muted">외 ${low.length - 10}건은 재고 현황에서 확인하세요.</p>` : ""}`
    : `<p class="empty">부족한 재고가 없습니다.</p>`;

  const recent = [...state.transactions].filter(touches).sort(byNewest).slice(0, 8);
  $("#recentList").innerHTML = recent.length
    ? `<ul class="rows">${recent.map((x) => {
        const p = productOf(x.productId);
        return `<li><div>${esc(p?.name ?? "(삭제된 품목)")}<div class="sub">${esc(x.date)} · ${esc(branchName(x.branchId))}${x.type === "transfer" ? " → " + esc(branchName(x.toBranchId)) : ""}</div></div>
          <div>${signedQty(x)} <span class="badge ${TYPE_BADGE[x.type]}">${TYPE_LABEL[x.type]}</span></div></li>`;
      }).join("")}</ul>`
    : `<p class="empty">아직 입출고 기록이 없습니다.</p>`;
}
const byNewest = (a, b) => (b.date.localeCompare(a.date)) || (b.createdAt - a.createdAt);
function signedQty(x) {
  if (x.type === "in") return `<b class="plus">+${fmt(x.qty)}</b>`;
  if (x.type === "out") return `<b class="minus">−${fmt(x.qty)}</b>`;
  if (x.type === "adjust") return `<b class="${x.qty >= 0 ? "plus" : "minus"}">${x.qty >= 0 ? "+" : "−"}${fmt(Math.abs(x.qty))}</b>`;
  return `<b>${fmt(x.qty)}</b>`;
}

/* ── 화면: 재고 현황 ────────────────────────── */
function filteredProducts(query, category) {
  const q = query.trim().toLowerCase();
  return state.products.filter((p) =>
    (!category || p.category === category) &&
    (!q || [p.name, p.sku, p.supplier].some((v) => String(v || "").toLowerCase().includes(q))));
}

function renderStock() {
  const stock = computeStock();
  const branches = scopeBranches();
  const lowOnly = $("#stockLowOnly").checked;
  let products = filteredProducts($("#stockSearch").value, $("#stockCategory").value);
  if (lowOnly) products = products.filter((p) => branches.some((b) => qtyOf(stock, b.id, p.id) < p.minStock));

  const table = $("#stockTable");
  if (!products.length) { table.innerHTML = `<tbody><tr><td class="empty">조건에 맞는 품목이 없습니다.</td></tr></tbody>`; return; }

  if (branches.length === 1) {
    const b = branches[0];
    table.innerHTML = `<thead><tr><th>품목</th><th>분류</th><th class="num">현재 재고</th><th class="num">최소 재고</th><th>상태</th><th class="num">재고 금액</th><th></th></tr></thead>
      <tbody>${products.map((p) => {
        const q = qtyOf(stock, b.id, p.id);
        const s = status(q, p.minStock);
        return `<tr><td class="name">${esc(p.name)}<span class="sub">${esc(p.sku)}</span></td><td>${esc(p.category)}</td>
          <td class="num"><b>${fmt(q)}</b> ${esc(p.unit)}</td><td class="num">${fmt(p.minStock)}</td>
          <td><span class="badge ${s.cls}">${s.label}</span></td><td class="num">${fmt(Math.max(q, 0) * (p.price || 0))}</td>
          <td class="actions"><button class="btn sm" data-quick="in" data-p="${p.id}" data-b="${b.id}">입고</button><button class="btn sm" data-quick="out" data-p="${p.id}" data-b="${b.id}">사용</button></td></tr>`;
      }).join("")}</tbody>`;
  } else {
    table.innerHTML = `<thead><tr><th>품목</th><th class="num">최소</th>${branches.map((b) => `<th class="num">${esc(b.name)}</th>`).join("")}<th class="num">합계</th></tr></thead>
      <tbody>${products.map((p) => {
        let total = 0;
        const cells = branches.map((b) => {
          const q = qtyOf(stock, b.id, p.id);
          total += q;
          const s = status(q, p.minStock);
          return `<td class="num">${s.cls === "ok" ? fmt(q) : `<span class="badge ${s.cls}">${fmt(q)}</span>`}</td>`;
        }).join("");
        return `<tr><td class="name">${esc(p.name)}<span class="sub">${esc(p.sku)} · ${esc(p.unit)}</span></td><td class="num">${fmt(p.minStock)}</td>${cells}<td class="num"><b>${fmt(total)}</b></td></tr>`;
      }).join("")}</tbody>`;
  }
}

/* ── 화면: 입출고 등록 ──────────────────────── */
let moveType = "in";

function fillMoveSelects() {
  const branchOpts = state.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("");
  const keepB = $("#moveBranch").value, keepT = $("#moveTo").value, keepP = $("#moveProduct").value;
  $("#moveBranch").innerHTML = branchOpts;
  $("#moveTo").innerHTML = branchOpts;
  $("#moveProduct").innerHTML = CATEGORIES.map((c) => {
    const items = state.products.filter((p) => p.category === c);
    return items.length ? `<optgroup label="${esc(c)}">${items.map((p) => `<option value="${p.id}">${esc(p.name)} (${esc(p.sku)})</option>`).join("")}</optgroup>` : "";
  }).join("");
  if (keepB) $("#moveBranch").value = keepB;
  else if ($("#branchFilter").value) $("#moveBranch").value = $("#branchFilter").value;
  if (keepT) $("#moveTo").value = keepT;
  if (keepP) $("#moveProduct").value = keepP;
  if (!$("#moveDate").value) $("#moveDate").value = today();
  updateMoveHint();
}

function setMoveType(type) {
  moveType = type;
  document.querySelectorAll("#moveType button").forEach((b) => b.classList.toggle("on", b.dataset.type === type));
  $("#moveToWrap").hidden = type !== "transfer";
  if (type === "transfer" && $("#moveTo").value === $("#moveBranch").value) {
    const other = state.branches.find((b) => b.id !== $("#moveBranch").value);
    if (other) $("#moveTo").value = other.id;
  }
  $("#moveQtyLabel").textContent = type === "adjust" ? "실제로 센 수량" : "수량";
  $("#moveQty").min = type === "adjust" ? "0" : "1";
  updateMoveHint();
}

function updateMoveHint() {
  const p = productOf($("#moveProduct").value);
  const bId = $("#moveBranch").value;
  if (!p || !bId) { $("#moveStockHint").textContent = ""; return; }
  const q = qtyOf(computeStock(), bId, p.id);
  $("#moveStockHint").textContent = `현재 ${branchName(bId)} 재고: ${fmt(q)}${p.unit} (최소 ${fmt(p.minStock)}${p.unit})`;
}

function submitMove(e) {
  e.preventDefault();
  const branchId = $("#moveBranch").value;
  const productId = $("#moveProduct").value;
  const qty = Number($("#moveQty").value);
  const date = $("#moveDate").value;
  const note = $("#moveNote").value.trim();
  const p = productOf(productId);
  if (!p || !branchId) return toast("지점과 품목을 골라 주세요.", true);
  if (!Number.isInteger(qty) || qty < 0 || (moveType !== "adjust" && qty === 0)) return toast("수량을 올바르게 넣어 주세요.", true);

  const cur = qtyOf(computeStock(), branchId, productId);
  const tx = { id: uid(), type: moveType, date, branchId, productId, qty, note, createdAt: Date.now() };

  if (moveType === "out" || moveType === "transfer") {
    if (qty > cur) return toast(`재고가 부족합니다. 현재 ${fmt(cur)}${p.unit} 있습니다.`, true);
  }
  if (moveType === "transfer") {
    tx.toBranchId = $("#moveTo").value;
    if (tx.toBranchId === branchId) return toast("보내는 지점과 받는 지점이 같습니다.", true);
  }
  if (moveType === "adjust") {
    tx.qty = qty - cur;
    if (tx.qty === 0) return toast("현재 재고와 같아서 조정할 내용이 없습니다.");
    tx.note = note || `실사 ${fmt(qty)}${p.unit} (기존 ${fmt(cur)})`;
  }

  state.transactions.push(tx);
  save();
  $("#moveQty").value = "";
  $("#moveNote").value = "";
  updateMoveHint();
  toast(`${TYPE_LABEL[moveType]} 저장: ${p.name}`);
}

/* ── 화면: 품목 관리 ────────────────────────── */
let editingId = null;

function renderProducts() {
  const products = filteredProducts($("#productSearch").value, "");
  $("#productTable").innerHTML = products.length
    ? `<thead><tr><th>코드</th><th>품목명</th><th>분류</th><th>단위</th><th class="num">최소 재고</th><th class="num">단가</th><th>거래처</th><th></th></tr></thead>
      <tbody>${products.map((p) => `<tr><td>${esc(p.sku)}</td><td class="name">${esc(p.name)}</td><td>${esc(p.category)}</td><td>${esc(p.unit)}</td>
        <td class="num">${fmt(p.minStock)}</td><td class="num">${fmt(p.price)}</td><td>${esc(p.supplier)}</td>
        <td class="actions"><button class="btn sm" data-edit="${p.id}">수정</button><button class="btn sm" data-del="${p.id}">삭제</button></td></tr>`).join("")}</tbody>`
    : `<tbody><tr><td class="empty">품목이 없습니다. 오른쪽 위 ‘품목 추가’를 눌러 주세요.</td></tr></tbody>`;
}

function openProduct(id = null) {
  editingId = id;
  const p = id ? productOf(id) : { sku: "", name: "", category: CATEGORIES[0], unit: "개", minStock: 5, price: "", supplier: "" };
  $("#productDialogTitle").textContent = id ? "품목 수정" : "품목 추가";
  $("#pSku").value = p.sku; $("#pName").value = p.name; $("#pCategory").value = p.category;
  $("#pUnit").value = p.unit; $("#pMin").value = p.minStock; $("#pPrice").value = p.price; $("#pSupplier").value = p.supplier;
  $("#productDialog").showModal();
}

function submitProduct(e) {
  e.preventDefault();
  const data = {
    sku: $("#pSku").value.trim(), name: $("#pName").value.trim(), category: $("#pCategory").value,
    unit: $("#pUnit").value.trim(), minStock: Math.max(0, Math.floor(Number($("#pMin").value) || 0)),
    price: Math.max(0, Math.floor(Number($("#pPrice").value) || 0)), supplier: $("#pSupplier").value.trim()
  };
  if (!data.sku || !data.name || !data.unit) return toast("코드, 품목명, 단위는 꼭 넣어 주세요.", true);
  if (state.products.some((p) => p.sku.toLowerCase() === data.sku.toLowerCase() && p.id !== editingId))
    return toast("같은 품목 코드가 이미 있습니다.", true);

  if (editingId) Object.assign(productOf(editingId), data);
  else state.products.push({ id: uid(), ...data });
  save();
  $("#productDialog").close();
  toast(editingId ? "품목을 수정했습니다." : "품목을 추가했습니다.");
  refresh();
}

function deleteProduct(id) {
  const p = productOf(id);
  const n = state.transactions.filter((t) => t.productId === id).length;
  const msg = n ? `‘${p.name}’을(를) 삭제하면 이 품목의 거래 내역 ${n}건도 함께 지워집니다. 삭제할까요?` : `‘${p.name}’을(를) 삭제할까요?`;
  if (!confirm(msg)) return;
  state.products = state.products.filter((x) => x.id !== id);
  state.transactions = state.transactions.filter((t) => t.productId !== id);
  save();
  toast("품목을 삭제했습니다.");
  refresh();
}

/* ── 화면: 거래 내역 ────────────────────────── */
function filteredHistory() {
  const ids = new Set(scopeBranches().map((b) => b.id));
  const type = $("#histType").value, from = $("#histFrom").value, to = $("#histTo").value;
  return state.transactions
    .filter((x) => (ids.has(x.branchId) || ids.has(x.toBranchId)) && (!type || x.type === type) &&
      (!from || x.date >= from) && (!to || x.date <= to))
    .sort(byNewest);
}

function renderHistory() {
  const rows = filteredHistory();
  const shown = rows.slice(0, 300);
  $("#histTable").innerHTML = rows.length
    ? `<thead><tr><th>날짜</th><th>유형</th><th>지점</th><th>품목</th><th class="num">수량</th><th>메모</th><th></th></tr></thead>
      <tbody>${shown.map((x) => {
        const p = productOf(x.productId);
        return `<tr><td>${esc(x.date)}</td><td><span class="badge ${TYPE_BADGE[x.type]}">${TYPE_LABEL[x.type]}</span></td>
          <td>${esc(branchName(x.branchId))}${x.type === "transfer" ? " → " + esc(branchName(x.toBranchId)) : ""}</td>
          <td class="name">${esc(p?.name ?? "(삭제된 품목)")}</td><td class="num">${signedQty(x)} ${esc(p?.unit ?? "")}</td>
          <td class="name">${esc(x.note)}</td><td class="actions"><button class="btn sm" data-undo="${x.id}">취소</button></td></tr>`;
      }).join("")}${rows.length > shown.length ? `<tr><td colspan="7" class="empty">최근 ${shown.length}건만 보입니다. 전체는 CSV로 내보내세요.</td></tr>` : ""}</tbody>`
    : `<tbody><tr><td class="empty">조건에 맞는 내역이 없습니다.</td></tr></tbody>`;
}

function undoTransaction(id) {
  const tx = state.transactions.find((t) => t.id === id);
  if (!tx || !confirm("이 기록을 취소(삭제)할까요? 재고 수량이 다시 계산됩니다.")) return;
  const next = { ...state, transactions: state.transactions.filter((t) => t.id !== id) };
  const stock = computeStock(next);
  const negative = [tx.branchId, tx.toBranchId].filter(Boolean).some((b) => qtyOf(stock, b, tx.productId) < 0);
  if (negative) return toast("이 기록을 지우면 재고가 마이너스가 됩니다. 이후 출고 기록을 먼저 확인하세요.", true);
  state.transactions = next.transactions;
  save();
  toast("기록을 취소했습니다.");
  refresh();
}

function exportCsv() {
  const rows = filteredHistory();
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["날짜", "유형", "지점", "받는 지점", "품목 코드", "품목명", "수량", "단위", "메모"].map(cell).join(",")];
  for (const x of rows) {
    const p = productOf(x.productId);
    const signed = x.type === "out" ? -x.qty : x.qty;
    lines.push([x.date, TYPE_LABEL[x.type], branchName(x.branchId), x.toBranchId ? branchName(x.toBranchId) : "",
      p?.sku, p?.name, signed, p?.unit, x.note].map(cell).join(","));
  }
  // 엑셀에서 한글이 깨지지 않도록 BOM 을 붙입니다
  download(`재고거래내역_${today()}.csv`, "﻿" + lines.join("\r\n"), "text/csv;charset=utf-8");
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── 화면: 설정 ─────────────────────────────── */
function renderSettings() {
  $("#branchList").innerHTML = state.branches.map((b) =>
    `<li><span>${esc(b.name)}</span><span><button class="btn sm" data-rename="${b.id}">이름 변경</button> <button class="btn sm" data-bdel="${b.id}">삭제</button></span></li>`).join("");
}

function addBranch(e) {
  e.preventDefault();
  const name = $("#branchName").value.trim();
  if (!name) return;
  if (state.branches.some((b) => b.name === name)) return toast("같은 이름의 지점이 이미 있습니다.", true);
  state.branches.push({ id: uid(), name });
  save();
  $("#branchName").value = "";
  toast(`${name}을(를) 추가했습니다.`);
  refresh();
}

function renameBranch(id) {
  const b = state.branches.find((x) => x.id === id);
  const name = prompt("새 지점 이름", b.name)?.trim();
  if (!name || name === b.name) return;
  if (state.branches.some((x) => x.name === name)) return toast("같은 이름의 지점이 이미 있습니다.", true);
  b.name = name;
  save();
  refresh();
}

function deleteBranch(id) {
  const b = state.branches.find((x) => x.id === id);
  if (state.transactions.some((t) => t.branchId === id || t.toBranchId === id))
    return toast(`${b.name}에는 거래 기록이 있어 삭제할 수 없습니다.`, true);
  if (!confirm(`${b.name}을(를) 삭제할까요?`)) return;
  state.branches = state.branches.filter((x) => x.id !== id);
  save();
  refresh();
}

function restore(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!isValidState(data)) throw new Error("형식 오류");
      if (!confirm("지금 데이터를 백업 파일 내용으로 바꿀까요? 되돌릴 수 없습니다.")) return;
      state = data;
      save();
      toast("복원했습니다.");
      refresh();
    } catch { toast("백업 파일을 읽지 못했습니다. 이 시스템에서 받은 .json 파일인지 확인하세요.", true); }
  };
  reader.readAsText(file);
}

/* ── 공통 ───────────────────────────────────── */
function fillBranchFilter() {
  const sel = $("#branchFilter");
  const keep = sel.value;
  sel.innerHTML = `<option value="">전체 지점</option>` + state.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("");
  sel.value = state.branches.some((b) => b.id === keep) ? keep : "";
}

function refresh() {
  fillBranchFilter();
  fillMoveSelects();
  renderDashboard();
  renderStock();
  renderProducts();
  renderHistory();
  renderSettings();
}

function showView(name) {
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("on", v.id === "view-" + name));
  try { sessionStorage.setItem("hplace-inv-view", name); } catch {}
}

function init() {
  state = load();
  save();

  const catOpts = CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join("");
  $("#stockCategory").innerHTML = `<option value="">전체 분류</option>` + catOpts;
  $("#pCategory").innerHTML = catOpts;

  $("#tabs").addEventListener("click", (e) => { if (e.target.dataset.view) showView(e.target.dataset.view); });
  $("#branchFilter").addEventListener("change", () => { renderDashboard(); renderStock(); renderHistory(); });

  ["#stockSearch", "#stockCategory", "#stockLowOnly"].forEach((s) => $(s).addEventListener("input", renderStock));
  $("#stockTable").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-quick]");
    if (!btn) return;
    $("#moveBranch").value = btn.dataset.b;
    $("#moveProduct").value = btn.dataset.p;
    setMoveType(btn.dataset.quick);
    showView("move");
    $("#moveQty").focus();
  });

  $("#moveType").addEventListener("click", (e) => { if (e.target.dataset.type) setMoveType(e.target.dataset.type); });
  $("#moveBranch").addEventListener("change", updateMoveHint);
  $("#moveProduct").addEventListener("change", updateMoveHint);
  $("#moveForm").addEventListener("submit", (e) => { submitMove(e); refreshAfterMove(); });

  $("#productSearch").addEventListener("input", renderProducts);
  $("#addProduct").addEventListener("click", () => openProduct());
  $("#productCancel").addEventListener("click", () => $("#productDialog").close());
  $("#productForm").addEventListener("submit", submitProduct);
  $("#productTable").addEventListener("click", (e) => {
    const t = e.target;
    if (t.dataset.edit) openProduct(t.dataset.edit);
    if (t.dataset.del) deleteProduct(t.dataset.del);
  });

  ["#histType", "#histFrom", "#histTo"].forEach((s) => $(s).addEventListener("input", renderHistory));
  $("#histTable").addEventListener("click", (e) => { if (e.target.dataset.undo) undoTransaction(e.target.dataset.undo); });
  $("#exportCsv").addEventListener("click", exportCsv);

  $("#branchForm").addEventListener("submit", addBranch);
  $("#branchList").addEventListener("click", (e) => {
    if (e.target.dataset.rename) renameBranch(e.target.dataset.rename);
    if (e.target.dataset.bdel) deleteBranch(e.target.dataset.bdel);
  });
  $("#backup").addEventListener("click", () =>
    download(`재고백업_${today()}.json`, JSON.stringify(state, null, 2), "application/json"));
  $("#restore").addEventListener("change", restore);
  $("#reset").addEventListener("click", () => {
    if (!confirm("모든 데이터를 지우고 예시 데이터로 되돌릴까요? 먼저 백업하시길 권합니다.")) return;
    state = sampleData();
    save();
    toast("예시 데이터로 초기화했습니다.");
    refresh();
  });

  refresh();
  let view = "dashboard";
  try { view = sessionStorage.getItem("hplace-inv-view") || view; } catch {}
  if (document.getElementById("view-" + view)) showView(view);
}

function refreshAfterMove() {
  renderDashboard();
  renderStock();
  renderHistory();
}

document.addEventListener("DOMContentLoaded", init);
