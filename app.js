/* ====================================================
   Simplifica — Gestão de Clientes
   Application Logic (app.js)
   ==================================================== */

// ---- Constants ----
const MEETING_LABELS = [
  'Onboarding',
  'Kick Off',
  'Apresentação do Projeto',
  'Apresentação da Implementação',
  'Treinamento',
  'Tira Dúvidas',
  'Acompanhamento',
  'Reunião de Finalização'
];

const STORAGE_KEY = 'simplifica_clientes';
const CLOSERS_KEY = 'simplifica_closers';
const DEFAULT_CLOSERS = ['Leonardo', 'Gustavo', 'Thiago'];

// Gradient pairs cycled by position in the closers list
const CLOSER_PALETTE = [
  ['#6a5cff', '#3a8bff'],
  ['#ff8c42', '#ff5e7e'],
  ['#22c993', '#00d4ff'],
  ['#e052ff', '#7b5cff'],
  ['#ffd166', '#ff8c42'],
  ['#00d4ff', '#1e56ff'],
  ['#ff5e7e', '#ff3b3b'],
  ['#7ee787', '#22c993']
];

// ---- Utility Functions ----

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxx-xxxx-xxxx'.replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  );
}

const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function dateChipHTML(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `<span class="date-chip"><span class="date-chip-day">${d}</span><span class="date-chip-month">${MESES_ABREV[parseInt(m, 10) - 1]}</span></span>`;
}

function getWeekdayFull(dateStr) {
  const dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  return dias[new Date(dateStr + 'T12:00:00').getDay()];
}

function addDays(dateStr, days) {
  const date = new Date(dateStr + 'T12:00:00');
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) d.setDate(0); // clamp em meses mais curtos (ex.: 31 → 30/28)
  return d.toISOString().split('T')[0];
}

function getToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getMeetingStatus(meetingDate) {
  const today = getToday();
  if (meetingDate < today) return 'passada';
  if (meetingDate === today) return 'hoje';
  return 'futura';
}

function getCardStatus(reunioes) {
  const lastMeeting = reunioes[reunioes.length - 1];
  if (getMeetingStatus(lastMeeting.data) === 'passada') return 'finalizado';
  return 'em_andamento';
}

function generateMeetings(dataInicial) {
  return MEETING_LABELS.map((label, i) => ({
    data: addDays(dataInicial, i * 7),
    label: label,
    status: '' // will be computed dynamically
  }));
}

// Gera as reuniões conforme o tipo de evento:
// padrão (8 reuniões fixas), personalizado (nomes livres, semanais)
// ou personalizado recorrente (mesmo evento repetido por 6 meses)
function buildMeetings(dataInicial, opts) {
  if (!opts || !opts.custom) return generateMeetings(dataInicial);
  const nomes = opts.nomes.length ? opts.nomes : ['Reunião'];
  if (opts.recorrente) {
    const nome = nomes[0];
    const limite = addMonths(dataInicial, 6);
    const stepDays = opts.frequencia === 'quinzenal' ? 14 : 7;
    const list = [];
    let i = 0;
    let d = dataInicial;
    while (d <= limite) {
      list.push({ data: d, label: nome, status: '' });
      i++;
      d = opts.frequencia === 'mensal' ? addMonths(dataInicial, i) : addDays(dataInicial, i * stepDays);
    }
    return list;
  }
  return nomes.map((n, i) => ({ data: addDays(dataInicial, i * 7), label: n, status: '' }));
}

function getNextMeetingDate(client) {
  const today = getToday();
  for (const r of client.reunioes) {
    if (r.data >= today) return r.data;
  }
  return '9999-99-99'; // all past → sort to end
}

function getCloserInitials(name) {
  return name.charAt(0).toUpperCase();
}

function closerColors(name) {
  const idx = closers.indexOf(name);
  return CLOSER_PALETTE[(idx >= 0 ? idx : name.length) % CLOSER_PALETTE.length];
}

function closerGradient(name) {
  const [a, b] = closerColors(name);
  return `linear-gradient(135deg, ${a}, ${b})`;
}

const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

function daysUntil(dateStr) {
  const MS_DAY = 86400000;
  const today = new Date(getToday() + 'T12:00:00');
  const target = new Date(dateStr + 'T12:00:00');
  return Math.round((target - today) / MS_DAY);
}

function relativeDateLabel(dateStr) {
  const diff = daysUntil(dateStr);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanhã';
  if (diff === -1) return 'ontem';
  if (diff > 1) return `em ${diff} dias`;
  return `há ${Math.abs(diff)} dias`;
}


// ---- Data Layer ----
// Dados compartilhados via API do servidor (todos veem os mesmos clientes).
// Fallback para localStorage quando não há servidor (ex.: arquivo aberto direto).

let remoteMode = false;

function loadLocalClients() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function loadLocalClosers() {
  try {
    const raw = localStorage.getItem(CLOSERS_KEY);
    const arr = raw ? JSON.parse(raw) : null;
    return Array.isArray(arr) && arr.length ? arr : [...DEFAULT_CLOSERS];
  } catch {
    return [...DEFAULT_CLOSERS];
  }
}

function persist(endpoint, payload, localKey) {
  if (remoteMode) {
    fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(res => {
      if (!res.ok) throw new Error(res.status);
    }).catch(() => {
      showToast('Falha ao salvar no servidor. Verifique a conexão.', 'error');
    });
  } else {
    localStorage.setItem(localKey, JSON.stringify(payload));
  }
}

function saveClients() {
  persist('/api/clients', clients, STORAGE_KEY);
}

function saveClosers() {
  persist('/api/closers', closers, CLOSERS_KEY);
}

async function loadData() {
  try {
    const res = await fetch('/api/data', { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    remoteMode = true;
    clients = Array.isArray(data.clients) ? data.clients : [];
    closers = Array.isArray(data.closers) && data.closers.length ? data.closers : [...DEFAULT_CLOSERS];
    // Migração única: servidor vazio + dados locais antigos → envia para o servidor
    if (clients.length === 0) {
      const localClients = loadLocalClients();
      if (localClients.length > 0) {
        clients = localClients;
        saveClients();
      }
    }
  } catch {
    remoteMode = false;
    clients = loadLocalClients();
    closers = loadLocalClosers();
  }
}

// ---- State ----

let clients = [];
let closers = [...DEFAULT_CLOSERS];
let editingClientId = null;
let searchQuery = '';

// Preferência de filtro é individual (fica no navegador de cada usuário)
const FILTER_KEY = 'simplifica_filtro';
let activeFilter = localStorage.getItem(FILTER_KEY) || 'todos';

function isValidFilter(filter) {
  return ['todos', 'em_andamento', 'finalizados'].includes(filter) || closers.includes(filter);
}

// Recompute meeting + card statuses for the whole dataset (single pass).
function recomputeStatuses() {
  clients.forEach(c => {
    c.reunioes.forEach(r => { r.status = getMeetingStatus(r.data); });
    c.cardStatus = getCardStatus(c.reunioes);
  });
}

// ---- DOM Elements ----

const $cardsGrid = document.getElementById('cardsGrid');
const $modalOverlay = document.getElementById('modalOverlay');
const $modalTitle = document.getElementById('modalTitle');
const $btnNewClient = document.getElementById('btnNewClient');
const $btnCancel = document.getElementById('btnCancel');
const $btnSave = document.getElementById('btnSave');
const $modalClose = document.getElementById('modalClose');
const $formClientName = document.getElementById('formClientName');
const $formProjectName = document.getElementById('formProjectName');
const $formDate = document.getElementById('formDate');
const $formCloser = document.getElementById('formCloser');
const $formObs = document.getElementById('formObs');
const $meetingsPreview = document.getElementById('meetingsPreview');
const $toggleCustom = document.getElementById('toggleCustom');
const $toggleRecurring = document.getElementById('toggleRecurring');
const $customEventArea = document.getElementById('customEventArea');
const $recurringGroup = document.getElementById('recurringGroup');
const $customNamesList = document.getElementById('customNamesList');
const $customNamesLabel = document.getElementById('customNamesLabel');
const $btnAddCustomName = document.getElementById('btnAddCustomName');
const $formFreq = document.getElementById('formFreq');
const $formDateLabelText = document.getElementById('formDateLabelText');
const $deleteOverlay = document.getElementById('deleteOverlay');
const $closersOverlay = document.getElementById('closersOverlay');
const $closersList = document.getElementById('closersList');
const $closerFilters = document.getElementById('closerFilters');
const $newCloserName = document.getElementById('newCloserName');
const $toastContainer = document.getElementById('toastContainer');
const $headerDateDay = document.getElementById('headerDateDay');
const $headerDateFull = document.getElementById('headerDateFull');
const $statActive = document.getElementById('statActive');
const $statDone = document.getElementById('statDone');

// ---- Header Date ----

function updateHeaderDate() {
  const now = new Date();
  const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  $headerDateDay.textContent = dias[now.getDay()];
  $headerDateFull.textContent = `${now.getDate()} de ${meses[now.getMonth()]} de ${now.getFullYear()}`;
}

// ---- Toast Notification ----

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? '✓' : '✕';
  toast.innerHTML = `<span class="toast-icon">${icon}</span>${message}`;
  $toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-leaving');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ---- Filters ----

function updateFilterActive() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === activeFilter);
  });
}

function setFilter(filter) {
  activeFilter = filter;
  localStorage.setItem(FILTER_KEY, filter);
  updateFilterActive();
  renderCards();
}

function renderCloserFilters() {
  $closerFilters.innerHTML = closers.map(name => {
    const [a] = closerColors(name);
    return `
      <button class="filter-btn" data-filter="${escapeHtml(name)}">
        <span class="closer-dot" style="background: ${a}; box-shadow: 0 0 6px ${a}99;"></span>${escapeHtml(name)}
      </button>
    `;
  }).join('');
  updateFilterActive();
}

function filterClients() {
  let filtered = [...clients];

  if (activeFilter === 'em_andamento') {
    filtered = filtered.filter(c => c.cardStatus === 'em_andamento');
  } else if (activeFilter === 'finalizados') {
    filtered = filtered.filter(c => c.cardStatus === 'finalizado');
  } else if (activeFilter !== 'todos') {
    filtered = filtered.filter(c => c.responsavel === activeFilter);
  }

  // Text search across client, project and responsible
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(c =>
      c.nomeCliente.toLowerCase().includes(q) ||
      c.nomeProjeto.toLowerCase().includes(q) ||
      c.responsavel.toLowerCase().includes(q)
    );
  }

  // Sort: closest upcoming meeting first
  filtered.sort((a, b) => {
    const dateA = getNextMeetingDate(a);
    const dateB = getNextMeetingDate(b);
    if (dateA === dateB) return a.nomeCliente.localeCompare(b.nomeCliente);
    return dateA < dateB ? -1 : 1;
  });

  return filtered;
}

function updateStats() {
  let active = 0;
  let done = 0;
  clients.forEach(c => {
    if (c.cardStatus === 'em_andamento') active++;
    else done++;
  });
  $statActive.textContent = active;
  $statDone.textContent = done;
}

// ---- Render Cards ----

function renderCards() {
  recomputeStatuses();
  const filtered = filterClients();
  updateStats();

  if (filtered.length === 0) {
    const hasClients = clients.length > 0;
    let title, message, cta;
    if (!hasClients) {
      title = 'Nenhum cliente cadastrado';
      message = 'Adicione seu primeiro cliente e as reuniões serão agendadas automaticamente.';
      cta = `<button class="empty-state-btn" onclick="openModal()">+ Novo Cliente</button>`;
    } else if (searchQuery) {
      title = 'Nenhum resultado para a busca';
      message = `Nada encontrado para "${escapeHtml(searchQuery)}". Tente outro termo.`;
      cta = '';
    } else {
      title = 'Nenhum cliente encontrado';
      message = 'Tente ajustar os filtros para ver mais resultados.';
      cta = '';
    }
    $cardsGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="17" rx="3"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
            <path d="M9 15.5l2 2 4-4"/>
          </svg>
        </div>
        <h3>${title}</h3>
        <p>${message}</p>
        ${cta}
      </div>
    `;
    return;
  }

  $cardsGrid.innerHTML = filtered.map((client, idx) => {
    const isFinalizado = client.cardStatus === 'finalizado';
    const statusBadgeClass = isFinalizado ? 'finalizado' : 'em-andamento';
    const statusBadgeText = isFinalizado ? 'Projeto Finalizado' : 'Em andamento';

    const done = client.reunioes.filter(r => getMeetingStatus(r.data) === 'passada').length;
    const total = client.reunioes.length;
    const pct = Math.round((done / total) * 100);

    const meetingsHTML = client.reunioes.map(r => {
      const status = getMeetingStatus(r.data);
      const marker = status === 'passada' ? ICON_CHECK : '';
      let side = '';
      if (status === 'hoje') {
        side = '<span class="meeting-badge">Hoje</span>';
      } else if (status === 'futura') {
        side = `<span class="meeting-rel">${relativeDateLabel(r.data)}</span>`;
      }
      return `
        <div class="timeline-item ${status}">
          <div class="timeline-marker">${marker}</div>
          ${dateChipHTML(r.data)}
          <div class="timeline-body">
            <span class="meeting-label">${r.label}</span>
            <span class="meeting-date">${getWeekdayFull(r.data)}</span>
          </div>
          ${side}
        </div>
      `;
    }).join('');

    const obsHTML = client.observacoes ? `
      <div class="card-obs">
        <div class="card-obs-text">${escapeHtml(client.observacoes)}</div>
      </div>
    ` : '';

    return `
      <article class="client-card ${isFinalizado ? 'finalizado' : ''}" style="animation-delay: ${idx * 0.06}s" data-id="${client.id}">
        <div class="card-header">
          <div class="card-header-left">
            <div class="card-client-name">${escapeHtml(client.nomeCliente)}</div>
            <div class="card-project-name">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              <span>${escapeHtml(client.nomeProjeto)}</span>
            </div>
          </div>
          <div class="card-header-right">
            <button class="card-action-btn edit" onclick="editClient('${client.id}')" title="Editar" aria-label="Editar ${escapeHtml(client.nomeCliente)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="card-action-btn delete" onclick="confirmDelete('${client.id}')" title="Excluir" aria-label="Excluir ${escapeHtml(client.nomeCliente)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                <line x1="10" y1="11" x2="10" y2="17"/>
                <line x1="14" y1="11" x2="14" y2="17"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="card-meta">
          <div class="card-closer">
            <span class="closer-avatar" style="background: ${closerGradient(client.responsavel)};">${getCloserInitials(client.responsavel)}</span>
            <span class="closer-name">${escapeHtml(client.responsavel)}</span>
          </div>
          <span class="status-badge ${statusBadgeClass}">${statusBadgeText}</span>
        </div>
        <div class="card-progress-row">
          <div class="progress-track"><div class="progress-fill" style="width: ${pct}%"></div></div>
          <span class="progress-text">${done} de ${total}</span>
        </div>
        <div class="card-timeline">
          <div class="timeline-track">
            ${meetingsHTML}
          </div>
        </div>
        ${obsHTML}
      </article>
    `;
  }).join('');
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- Modal ----

let lastFocused = null;

function syncScrollLock() {
  const anyOpen = $modalOverlay.classList.contains('active') ||
    $deleteOverlay.classList.contains('active') ||
    $closersOverlay.classList.contains('active');
  document.body.classList.toggle('modal-open', anyOpen);
}

// ---- Custom Event Form ----

function addCustomNameRow(value = '') {
  const row = document.createElement('div');
  row.className = 'custom-name-row';
  row.innerHTML = `
    <input type="text" class="form-input" placeholder="Ex: Reunião de Alinhamento" value="${escapeHtml(value)}" maxlength="60" autocomplete="off">
    <button type="button" class="btn-remove-name" title="Remover" aria-label="Remover reunião">✕</button>
  `;
  $customNamesList.appendChild(row);
}

function getCustomNames() {
  return [...$customNamesList.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean);
}

function getFormMeetingOptions() {
  return {
    custom: $toggleCustom.checked,
    nomes: getCustomNames(),
    recorrente: $toggleCustom.checked && $toggleRecurring.checked,
    frequencia: $formFreq.value
  };
}

function updateCustomUI() {
  const custom = $toggleCustom.checked;
  const rec = custom && $toggleRecurring.checked;
  $customEventArea.style.display = custom ? 'block' : 'none';
  $formDateLabelText.textContent = custom ? 'Data da 1ª Reunião' : 'Data da 1ª Reunião (Onboarding)';
  $recurringGroup.style.display = rec ? 'block' : 'none';
  $customNamesLabel.textContent = rec ? 'Nome do evento recorrente' : 'Reuniões personalizadas';
  $btnAddCustomName.style.display = rec ? 'none' : 'inline-flex';
  if (rec) {
    [...$customNamesList.querySelectorAll('.custom-name-row')].slice(1).forEach(r => r.remove());
  }
  if ($customNamesList.children.length === 0) addCustomNameRow();
  updateMeetingsPreview();
}

function resetCustomForm(client = null) {
  $toggleCustom.checked = client ? client.tipoEvento === 'personalizado' : false;
  $toggleRecurring.checked = client ? !!client.recorrente : false;
  $formFreq.value = (client && client.frequencia) || 'semanal';
  $customNamesList.innerHTML = '';
  const nomes = (client && client.eventosPersonalizados) || [];
  nomes.forEach(n => addCustomNameRow(n));
  updateCustomUI();
}

function renderCloserOptions(selected = '') {
  // Keep an option for a closer that was removed but is still assigned
  const names = selected && !closers.includes(selected) ? [...closers, selected] : closers;
  $formCloser.innerHTML =
    `<option value="" disabled${!selected ? ' selected' : ''}>Selecione o responsável</option>` +
    names.map(n => `<option value="${escapeHtml(n)}"${n === selected ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('');
}

function openModal(clientId = null) {
  lastFocused = document.activeElement;
  editingClientId = clientId;

  if (clientId) {
    const client = clients.find(c => c.id === clientId);
    if (!client) return;
    $modalTitle.textContent = 'Editar Cliente';
    $formClientName.value = client.nomeCliente;
    $formProjectName.value = client.nomeProjeto;
    $formDate.value = client.dataInicial;
    renderCloserOptions(client.responsavel);
    $formObs.value = client.observacoes || '';
    resetCustomForm(client);
  } else {
    $modalTitle.textContent = 'Novo Cliente';
    $formClientName.value = '';
    $formProjectName.value = '';
    $formDate.value = '';
    renderCloserOptions();
    $formObs.value = '';
    resetCustomForm();
  }

  $modalOverlay.classList.add('active');
  syncScrollLock();
  setTimeout(() => $formClientName.focus(), 300);
}

function closeModal() {
  $modalOverlay.classList.remove('active');
  editingClientId = null;
  syncScrollLock();
  if (lastFocused && lastFocused.focus) lastFocused.focus();
}

function updateMeetingsPreview() {
  const dateVal = $formDate.value;
  if (!dateVal) {
    $meetingsPreview.style.display = 'none';
    return;
  }

  const meetings = buildMeetings(dateVal, getFormMeetingOptions());
  $meetingsPreview.style.display = 'block';
  $meetingsPreview.innerHTML = `
    <div class="form-preview-title">Reuniões que serão geradas (${meetings.length})</div>
    ${meetings.map(m => `
      <div class="preview-meeting">
        ${dateChipHTML(m.data)}
        <div class="preview-meeting-info">
          <span class="preview-meeting-label">${m.label}</span>
          <span class="preview-meeting-weekday">${getWeekdayFull(m.data)}</span>
        </div>
      </div>
    `).join('')}
  `;
}

function saveClient() {
  const nomeCliente = $formClientName.value.trim();
  const nomeProjeto = $formProjectName.value.trim();
  const dataInicial = $formDate.value;
  const responsavel = $formCloser.value;
  const observacoes = $formObs.value.trim();

  if (!nomeCliente || !nomeProjeto || !dataInicial || !responsavel) {
    showToast('Preencha todos os campos obrigatórios.', 'error');
    return;
  }

  const opts = getFormMeetingOptions();
  if (opts.custom && opts.nomes.length === 0) {
    showToast('Adicione pelo menos uma reunião personalizada.', 'error');
    return;
  }

  const reunioes = buildMeetings(dataInicial, opts);
  const eventFields = {
    tipoEvento: opts.custom ? 'personalizado' : 'padrao',
    eventosPersonalizados: opts.custom ? opts.nomes : [],
    recorrente: opts.recorrente,
    frequencia: opts.recorrente ? opts.frequencia : ''
  };

  if (editingClientId) {
    const idx = clients.findIndex(c => c.id === editingClientId);
    if (idx !== -1) {
      clients[idx] = {
        ...clients[idx],
        nomeCliente,
        nomeProjeto,
        dataInicial,
        responsavel,
        reunioes,
        observacoes,
        ...eventFields
      };
      showToast('Cliente atualizado com sucesso!');
    }
  } else {
    clients.push({
      id: generateId(),
      nomeCliente,
      nomeProjeto,
      responsavel,
      dataInicial,
      reunioes,
      observacoes,
      cardStatus: 'em_andamento',
      ...eventFields
    });
    showToast('Cliente cadastrado com sucesso!');
  }

  saveClients();
  closeModal();
  renderCards();
}

// ---- Closers (Responsáveis) ----

function renderClosersList() {
  $closersList.innerHTML = closers.map(name => {
    const count = clients.filter(c => c.responsavel === name).length;
    const countLabel = count === 0 ? 'Nenhum cliente' : count === 1 ? '1 cliente' : `${count} clientes`;
    return `
      <div class="closer-row">
        <span class="closer-avatar" style="background: ${closerGradient(name)};">${getCloserInitials(name)}</span>
        <div class="closer-row-info">
          <span class="closer-row-name">${escapeHtml(name)}</span>
          <span class="closer-row-count">${countLabel}</span>
        </div>
        <button class="card-action-btn delete" data-name="${escapeHtml(name)}" title="Remover" aria-label="Remover ${escapeHtml(name)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            <line x1="10" y1="11" x2="10" y2="17"/>
            <line x1="14" y1="11" x2="14" y2="17"/>
          </svg>
        </button>
      </div>
    `;
  }).join('');
}

function openClosersModal() {
  lastFocused = document.activeElement;
  renderClosersList();
  $newCloserName.value = '';
  $closersOverlay.classList.add('active');
  syncScrollLock();
  setTimeout(() => $newCloserName.focus(), 300);
}

function closeClosersModal() {
  $closersOverlay.classList.remove('active');
  syncScrollLock();
  if (lastFocused && lastFocused.focus) lastFocused.focus();
}

function addCloser() {
  const name = $newCloserName.value.trim();
  if (!name) {
    showToast('Digite um nome para o responsável.', 'error');
    return;
  }
  if (closers.some(c => c.toLowerCase() === name.toLowerCase())) {
    showToast('Este responsável já existe.', 'error');
    return;
  }
  closers.push(name);
  saveClosers();
  renderCloserFilters();
  renderClosersList();
  renderCards();
  $newCloserName.value = '';
  $newCloserName.focus();
  showToast(`Responsável "${name}" adicionado!`);
}

function removeCloser(name) {
  const count = clients.filter(c => c.responsavel === name).length;
  if (count > 0) {
    showToast(`Não é possível remover: ${count === 1 ? '1 cliente está atribuído' : count + ' clientes estão atribuídos'} a ${name}.`, 'error');
    return;
  }
  closers = closers.filter(c => c !== name);
  saveClosers();
  if (activeFilter === name) activeFilter = 'todos';
  renderCloserFilters();
  renderClosersList();
  renderCards();
  showToast(`Responsável "${name}" removido.`);
}

// ---- Edit / Delete ----

function editClient(id) {
  openModal(id);
}

let deletingClientId = null;

function confirmDelete(id) {
  lastFocused = document.activeElement;
  deletingClientId = id;
  const client = clients.find(c => c.id === id);
  document.getElementById('deleteClientName').textContent = client ? client.nomeCliente : '';
  $deleteOverlay.classList.add('active');
  syncScrollLock();
  setTimeout(() => document.getElementById('btnDeleteCancel').focus(), 100);
}

function closeDeleteConfirm() {
  $deleteOverlay.classList.remove('active');
  deletingClientId = null;
  syncScrollLock();
  if (lastFocused && lastFocused.focus) lastFocused.focus();
}

function executeDelete() {
  if (!deletingClientId) return;
  clients = clients.filter(c => c.id !== deletingClientId);
  saveClients();
  closeDeleteConfirm();
  renderCards();
  showToast('Cliente removido com sucesso!');
}

// ---- Event Listeners ----

$btnNewClient.addEventListener('click', () => openModal());
$btnCancel.addEventListener('click', closeModal);
$modalClose.addEventListener('click', closeModal);
$btnSave.addEventListener('click', saveClient);
$formDate.addEventListener('change', updateMeetingsPreview);

// Evento personalizado / recorrente
$toggleCustom.addEventListener('change', updateCustomUI);
$toggleRecurring.addEventListener('change', updateCustomUI);
$formFreq.addEventListener('change', updateMeetingsPreview);
$btnAddCustomName.addEventListener('click', () => {
  addCustomNameRow();
  updateMeetingsPreview();
  const inputs = $customNamesList.querySelectorAll('input');
  inputs[inputs.length - 1].focus();
});
$customNamesList.addEventListener('input', updateMeetingsPreview);
$customNamesList.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-remove-name');
  if (!btn) return;
  const row = btn.closest('.custom-name-row');
  if ($customNamesList.children.length > 1) row.remove();
  else row.querySelector('input').value = '';
  updateMeetingsPreview();
});

// Enter saves the form (except inside the multiline textarea)
$modalOverlay.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
    saveClient();
  }
});

// Search
const $searchInput = document.getElementById('searchInput');
$searchInput.addEventListener('input', () => {
  searchQuery = $searchInput.value.trim();
  renderCards();
});

$modalOverlay.addEventListener('click', (e) => {
  if (e.target === $modalOverlay) closeModal();
});

$deleteOverlay.addEventListener('click', (e) => {
  if (e.target === $deleteOverlay) closeDeleteConfirm();
});

document.getElementById('btnDeleteConfirm').addEventListener('click', executeDelete);
document.getElementById('btnDeleteCancel').addEventListener('click', closeDeleteConfirm);
document.getElementById('deleteClose').addEventListener('click', closeDeleteConfirm);

// Filter buttons (delegated — closer filters are re-rendered dynamically)
document.getElementById('filtersBar').addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (btn && btn.dataset.filter) setFilter(btn.dataset.filter);
});

// Manage closers
document.getElementById('btnManageClosers').addEventListener('click', openClosersModal);
document.getElementById('closersClose').addEventListener('click', closeClosersModal);
document.getElementById('btnAddCloser').addEventListener('click', addCloser);

$newCloserName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addCloser();
  }
});

$closersOverlay.addEventListener('click', (e) => {
  if (e.target === $closersOverlay) closeClosersModal();
});

$closersList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-name]');
  if (btn) removeCloser(btn.dataset.name);
});

// Keyboard shortcut: Escape to close modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($deleteOverlay.classList.contains('active')) {
      closeDeleteConfirm();
    } else if ($closersOverlay.classList.contains('active')) {
      closeClosersModal();
    } else if ($modalOverlay.classList.contains('active')) {
      closeModal();
    }
  }
});

// ---- Initialize ----

async function init() {
  updateHeaderDate();
  $cardsGrid.innerHTML = '<div class="empty-state"><p>Carregando dados…</p></div>';
  await loadData();
  if (!isValidFilter(activeFilter)) activeFilter = 'todos';
  renderCloserFilters();
  renderCards();
}

// ---- Sync between users (shared server data) ----

// Ignore volatile computed fields (status/cardStatus) when comparing
function normalizeClients(list) {
  return JSON.stringify(list.map(c => ({
    id: c.id,
    nomeCliente: c.nomeCliente,
    nomeProjeto: c.nomeProjeto,
    responsavel: c.responsavel,
    dataInicial: c.dataInicial,
    observacoes: c.observacoes,
    reunioes: (c.reunioes || []).map(r => ({ data: r.data, label: r.label }))
  })));
}

async function syncFromServer() {
  if (!remoteMode || document.hidden) return;
  // Don't replace data while the user is editing in a modal
  if (document.body.classList.contains('modal-open')) return;
  try {
    const res = await fetch('/api/data', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const remoteClients = Array.isArray(data.clients) ? data.clients : [];
    const remoteClosers = Array.isArray(data.closers) && data.closers.length ? data.closers : [...DEFAULT_CLOSERS];
    const changed = normalizeClients(remoteClients) !== normalizeClients(clients) ||
      JSON.stringify(remoteClosers) !== JSON.stringify(closers);
    if (changed) {
      clients = remoteClients;
      closers = remoteClosers;
      if (!isValidFilter(activeFilter)) activeFilter = 'todos';
      renderCloserFilters();
      renderCards();
    }
  } catch {
    // Offline momentâneo — tenta no próximo ciclo
  }
}

setInterval(syncFromServer, 15 * 1000);

// Keep statuses fresh: re-render when the calendar day changes
// (page left open past midnight) or when the tab regains focus.
let currentDay = getToday();

function refreshIfDayChanged() {
  const today = getToday();
  if (today !== currentDay) {
    currentDay = today;
    updateHeaderDate();
    renderCards();
  }
}

setInterval(refreshIfDayChanged, 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    refreshIfDayChanged();
    syncFromServer();
  }
});

init();
