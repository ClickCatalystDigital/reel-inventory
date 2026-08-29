// public/js/app.js
// ========== API HELPER ==========
async function api(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  } catch (err) {
    showToast(err.message, 'error');
    throw err;
  }
}

// ========== TOAST NOTIFICATIONS ==========
function showToast(message, type = 'success') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.background = type === 'error' ? '#dc2626' : '#1a1a18';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 5000);
}

// ========== DATE FORMATTING ==========
function formatDate(dateStr) {
  if (!dateStr) return '—';
  // SQLite returns naive string — treat as IST directly
  const d = new Date(dateStr.replace(' ', 'T') + '+05:30');
  return d.toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr.replace(' ', 'T') + '+05:30');
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: true
  });
}

// ========== STATUS BADGE ==========
function statusBadge(status) {
  const map = { 'In Stock': 'badge-success', 'Outwarded': 'badge-danger', 'Partial': 'badge-warning', 'Deleted': 'badge-danger' };
  return `<span class="badge ${map[status] || 'badge-warning'}">${status}</span>`;
}

// ========== NUMBER FORMATTING ==========
function formatQty(n) {
  return (n || 0).toLocaleString('en-IN');
}

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ========== NAVBAR ACTIVE STATE ==========
document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;
  document.querySelectorAll('.nav-links a').forEach(a => {
    if (a.getAttribute('href') === path) a.classList.add('active');
  });
  injectNavExtras();
});

// ========== STORE SELECTOR (view filter: Primary/Secondary/All) ==========
function getSelectedStore() {
  return localStorage.getItem('selectedStore') || 'all';
}

function storeQueryParam() {
  const s = getSelectedStore();
  return s === 'all' ? '' : `store=${encodeURIComponent(s)}`;
}

function setSelectedStore(code) {
  localStorage.setItem('selectedStore', code);
  window.dispatchEvent(new CustomEvent('storechange', { detail: { store: code } }));
}

async function injectStoreSelector() {
  if (document.getElementById('storeSelect')) return;
  let stores;
  try {
    stores = await fetch('/api/stores').then(r => r.json());
  } catch (e) { return; }
  if (!stores || !stores.length) return;

  const current = getSelectedStore();
  const optionsHTML = `<option value="all">All Stores</option>` +
    stores.map(s => `<option value="${s.code}">${esc(s.name)}</option>`).join('');

  const navLinks = document.querySelector('.nav-links');
  if (navLinks) {
    const select = document.createElement('select');
    select.id = 'storeSelect';
    select.className = 'store-select';
    select.title = 'Viewing store';
    select.innerHTML = optionsHTML;
    select.value = current;
    select.addEventListener('change', () => setSelectedStore(select.value));
    navLinks.prepend(select);
  }

  const cogDropdown = document.getElementById('cogDropdown');
  if (cogDropdown && !document.getElementById('storeSelectMobile')) {
    const wrap = document.createElement('div');
    wrap.style.padding = '.5rem .75rem';
    wrap.innerHTML = `<select id="storeSelectMobile" class="store-select" style="width:100%">${optionsHTML}</select>`;
    cogDropdown.insertAdjacentElement('afterbegin', wrap);
    const mobileSelect = document.getElementById('storeSelectMobile');
    mobileSelect.value = current;
    mobileSelect.addEventListener('change', () => setSelectedStore(mobileSelect.value));
  }
}

document.addEventListener('DOMContentLoaded', injectStoreSelector);

// ========== NAV EXTRAS (bell + cog role-aware options) ==========
async function injectNavExtras() {
  try {
    const user = await fetch('/api/auth/me').then(r => r.json()).catch(() => null);
    if (!user) return;

    // --- WELCOME TOAST (Only runs once per session) ---
    if (!sessionStorage.getItem('hasWelcomed')) {
      const name = user.username.charAt(0).toUpperCase() + user.username.slice(1);
      const hour = new Date().getHours();
      let greeting = 'Good evening';
      
      if (hour < 12) greeting = 'Good morning';
      else if (hour < 17) greeting = 'Good afternoon';

      showToast(`${greeting}, ${name}!`);
      sessionStorage.setItem('hasWelcomed', 'true');
    }
    // --------------------------------------------------

    const isApprover = ['admin', 'manager'].includes(user.role);
    const navLinks = document.querySelector('.nav-links');
    const cogDropdown = document.getElementById('cogDropdown');

    // --- Bell icon (approvers only) ---
    if (isApprover && navLinks && !document.getElementById('bellBtn')) {
      const bell = document.createElement('button');
      bell.id = 'bellBtn';
      bell.className = 'theme-toggle';
      bell.title = 'Pending Approvals';
      bell.style.position = 'relative';
      bell.onclick = () => window.location.href = '/requests';
      bell.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round"
            d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"/>
        </svg>
        <span id="bellCount" style="
          display:none; position:absolute; top:-4px; right:-4px;
          background:var(--danger); color:#fff; font-size:9px; font-weight:700;
          min-width:16px; height:16px; border-radius:8px;
          align-items:center; justify-content:center; padding:0 3px;
        ">0</span>
      `;
      // Insert before theme toggle
      const themeBtn = navLinks.querySelector('.theme-toggle');
      if (themeBtn) navLinks.insertBefore(bell, themeBtn);
      else navLinks.prepend(bell);
    }

    // --- Cog dropdown: move dark mode + logout into cog on desktop ---
    // Already exists in mobile cog. For desktop, rebuild cog dropdown with role-aware items.
    if (cogDropdown && !cogDropdown.dataset.injected) {
      cogDropdown.dataset.injected = 'true';

      let extraLinks = '';
      if (isApprover) {
        extraLinks += `
          <a href="/requests">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z"/>
            </svg>
            Pending Requests
          </a>
        `;
      }
      if (['admin', 'manager'].includes(user.role)) {
        extraLinks += `
          <a href="/settings">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round"
                d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 0 1 1.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.559.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.894.149c-.424.07-.764.383-.929.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 0 1-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.398.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 0 1-.12-1.45l.527-.737c.25-.35.272-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.764-.383.929-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 0 1 .12-1.45l.773-.773a1.125 1.125 0 0 1 1.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894Z"/>
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/>
            </svg>
            Settings
          </a>
        `;
      }

      // Prepend extra links before existing dark mode button
      if (extraLinks) {
        cogDropdown.insertAdjacentHTML('afterbegin', extraLinks);
      }
    }

    // Start bell polling if approver
    if (isApprover) {
      refreshBellCount();
      setInterval(refreshBellCount, 30000);
    }

  } catch (e) {}
}

async function refreshBellCount() {
  try {
    const data = await fetch('/api/requests/count').then(r => r.json());
    const bell = document.getElementById('bellCount');
    if (bell) {
      const count = data.count || 0;
      bell.textContent = count;
      bell.style.display = count > 0 ? 'flex' : 'none';
    }
  } catch (e) {}
}

// ========== DARK MODE ==========
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  // Desktop toggle icon
  const icon = document.getElementById('themeIcon');
  if (icon) {
    icon.innerHTML = theme === 'dark'
      ? '<path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75 9.75 9.75 0 0 1 8.25 6 9.72 9.72 0 0 1 9 2.252 9.75 9.75 0 0 0 3 12a9.75 9.75 0 0 0 9.75 9.75c2.385 0 4.575-.86 6.252-2.248Z"/>'
      : '<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"/>';
  }
  // Cog menu icon + label
  const cogIcon = document.getElementById('cogThemeIcon');
  const cogLabel = document.getElementById('cogThemeLabel');
  if (cogIcon) {
    cogIcon.innerHTML = theme === 'dark'
      ? '<path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75 9.75 9.75 0 0 1 8.25 6 9.72 9.72 0 0 1 9 2.252 9.75 9.75 0 0 0 3 12a9.75 9.75 0 0 0 9.75 9.75c2.385 0 4.575-.86 6.252-2.248Z"/>'
      : '<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"/>';
  }
  if (cogLabel) {
    cogLabel.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
  }
}

// Apply saved theme on every page load
(function() {
  const saved = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  document.addEventListener('DOMContentLoaded', () => updateThemeIcon(saved));
})();

// ========== COG MENU ==========
function toggleCogMenu() {
  const dropdown = document.getElementById('cogDropdown');
  if (dropdown) dropdown.classList.toggle('open');
}

// Close cog when tapping outside
document.addEventListener('click', (e) => {
  const menu = document.getElementById('cogMenu');
  if (menu && !menu.contains(e.target)) {
    const dropdown = document.getElementById('cogDropdown');
    if (dropdown) dropdown.classList.remove('open');
  }
});

// ========== REUSABLE PAGINATED TABLE ==========
class PaginatedTable {
  constructor({ containerId, titleText, columns, pageSize = 10, serverMode = false, onPageChange = null }) {
    this.containerId = containerId;
    this.titleText = titleText;
    this.columns = columns;
    this.pageSize = pageSize;
    this.currentPage = 1;
    this.data = [];
    this.serverMode = serverMode;
    this.onPageChange = onPageChange;
    this.totalCount = 0;
    this._inject();
  }

  _inject() {
    const container = document.getElementById(this.containerId);
    if (!container) return;
    const sizes = [5, 10, 20, 50, 100];
    container.innerHTML = `
      <div class="table-controls">
        <div class="card-title">${this.titleText}</div>
        <select class="page-size-select" id="${this.containerId}-size">
          ${sizes.map(s => `<option value="${s}" ${s === this.pageSize ? 'selected' : ''}>${s} / page</option>`).join('')}
        </select>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>${this.columns.map(c => `<th>${c.label}</th>`).join('')}</tr>
          </thead>
          <tbody id="${this.containerId}-tbody">
            <tr><td colspan="${this.columns.length}" style="text-align:center;color:var(--text-muted)">Loading...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="pagination-row">
        <span class="page-info" id="${this.containerId}-info"></span>
        <div class="pagination-btns" id="${this.containerId}-btns"></div>
      </div>
    `;
    document.getElementById(`${this.containerId}-size`).addEventListener('change', (e) => {
      this.pageSize = parseInt(e.target.value);
      this.currentPage = 1;
      if (this.serverMode) this.onPageChange(this.currentPage, this.pageSize);
      else this._render();
    });
  }

  load(data) {
    this.data = data;
    this.currentPage = 1;
    this._render();
  }

  // Server mode: caller fetches one page and hands it in via this, instead of load()
  loadServerPage(rows, totalCount) {
    this.data = rows;
    this.totalCount = totalCount;
    this._render();
  }

  _render() {
    const total = this.serverMode ? this.totalCount : this.data.length;
    const totalPages = Math.max(1, Math.ceil(total / this.pageSize));
    this.currentPage = Math.min(this.currentPage, totalPages);
    const start = (this.currentPage - 1) * this.pageSize;
    const slice = this.serverMode ? this.data : this.data.slice(start, start + this.pageSize);
    const tbody = document.getElementById(`${this.containerId}-tbody`);

    if (!total) {
      tbody.innerHTML = `<tr><td colspan="${this.columns.length}" style="text-align:center;color:var(--text-muted)">No data</td></tr>`;
    } else {
      tbody.innerHTML = slice.map(row =>
        `<tr>${this.columns.map(c => `<td>${c.render(row)}</td>`).join('')}</tr>`
      ).join('');
    }

    const from = total ? start + 1 : 0;
    const to = Math.min(start + this.pageSize, total);
    document.getElementById(`${this.containerId}-info`).textContent =
      total ? `${from}–${to} of ${total}` : '0 results';

    const btnsEl = document.getElementById(`${this.containerId}-btns`);
    let btns = `<button ${this.currentPage === 1 ? 'disabled' : ''} data-page="${this.currentPage - 1}">←</button>`;
    for (const p of this._pageRange(this.currentPage, totalPages)) {
      btns += p === '…'
        ? `<button disabled>…</button>`
        : `<button class="${p === this.currentPage ? 'active-page' : ''}" data-page="${p}">${p}</button>`;
    }
    btns += `<button ${this.currentPage === totalPages ? 'disabled' : ''} data-page="${this.currentPage + 1}">→</button>`;
    btnsEl.innerHTML = btns;

    btnsEl.querySelectorAll('button[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentPage = parseInt(btn.dataset.page);
        if (this.serverMode) this.onPageChange(this.currentPage, this.pageSize);
        else this._render();
      });
    });

    // Hide pagination row if all data fits on one page
    btnsEl.closest('.pagination-row').style.display = totalPages <= 1 ? 'none' : 'flex';

    // Hide/show dropdown based on data size
    const sizeEl = document.getElementById(`${this.containerId}-size`);
    sizeEl.style.display = total <= 10 ? 'none' : '';
    sizeEl.querySelectorAll('option').forEach(opt => {
      opt.disabled = parseInt(opt.value) >= total && parseInt(opt.value) !== this.pageSize;
    });
  }

  _pageRange(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (current <= 4) return [1, 2, 3, 4, 5, '…', total];
    if (current >= total - 3) return [1, '…', total-4, total-3, total-2, total-1, total];
    return [1, '…', current - 1, current, current + 1, '…', total];
  }
}