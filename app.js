/* ====================================================
   Simplifica — Gestão de Clientes
   Application Logic (app.js)
   ==================================================== */

// ---- Constants ----
const MEETING_LABELS = [
  'Onboarding',
  'Apresentação do Projeto',
  'Apresentação da Implementação',
  'Treinamento',
  'Tira Dúvidas',
  'Acompanhamento',
  'Reunião de Finalização'
];

// Descrições padrão (checklist) por tipo de reunião do projeto base.
// Aparecem ao passar o mouse sobre o item e ficam pré-preenchidas na edição.
const MEETING_DESCRICOES = {
  'Onboarding': 'Reunião de kickoff feita\nAcessos recebidos\nAnálise de atendimento realizada',
  'Apresentação do Projeto': 'Etapas do funil definidas\nPlanejamento de CRM\nPlanejamento de automações',
  'Apresentação da Implementação': 'Pipeline criado no CRM\nCampos personalizados criados\nIntegrações feitas',
  'Treinamento': 'Treinamento realizado\nTime acessando o CRM corretamente\nPlaybook entregue'
};

// Descrição efetiva: clientes antigos (sem o campo) caem no padrão por rótulo;
// uma vez editada/limpa, o valor salvo prevalece.
function effectiveDescricao(r) {
  return r.descricao === undefined ? (MEETING_DESCRICOES[r.label] || '') : r.descricao;
}

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

function fmtDateLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Retorna a data (YYYY-MM-DD) da enésima/última ocorrência de um dia da
// semana no mês. ordinal: '1'..'4' ou 'ultima'; weekday: 0 (dom) .. 6 (sáb)
function nthWeekdayOfMonth(year, month, weekday, ordinal) {
  if (ordinal === 'ultima') {
    const last = new Date(year, month + 1, 0);
    last.setDate(last.getDate() - ((last.getDay() - weekday + 7) % 7));
    return fmtDateLocal(last);
  }
  const first = new Date(year, month, 1);
  const day = 1 + ((weekday - first.getDay() + 7) % 7) + (parseInt(ordinal, 10) - 1) * 7;
  const d = new Date(year, month, day);
  return d.getMonth() === month ? fmtDateLocal(d) : null;
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
  if (!reunioes || reunioes.length === 0) return 'em_andamento';
  const lastMeeting = reunioes[reunioes.length - 1];
  if (getMeetingStatus(lastMeeting.data) === 'passada') return 'finalizado';
  return 'em_andamento';
}

function makeMeeting(data, label) {
  return {
    data,
    label,
    descricao: MEETING_DESCRICOES[label] || '',
    concluido: false,
    status: '' // will be computed dynamically
  };
}

function generateMeetings(dataInicial) {
  return MEETING_LABELS.map((label, i) => makeMeeting(addDays(dataInicial, i * 7), label));
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
    const list = [];
    if (opts.frequencia === 'mensal_dia') {
      // Ex: "última sexta do mês" — calcula a ocorrência em cada mês da janela
      const base = new Date(dataInicial + 'T12:00:00');
      for (let m = 0; m <= 6; m++) {
        const ref = new Date(base.getFullYear(), base.getMonth() + m, 1);
        const ds = nthWeekdayOfMonth(ref.getFullYear(), ref.getMonth(), opts.diaSemana, opts.ordinal);
        if (ds && ds >= dataInicial && ds <= limite) {
          list.push(makeMeeting(ds, nome));
        }
      }
      return list;
    }
    const stepDays = opts.frequencia === 'quinzenal' ? 14 : 7;
    let i = 0;
    let d = dataInicial;
    while (d <= limite) {
      list.push(makeMeeting(d, nome));
      i++;
      d = opts.frequencia === 'mensal' ? addMonths(dataInicial, i) : addDays(dataInicial, i * stepDays);
    }
    return list;
  }
  return nomes.map((n, i) => makeMeeting(addDays(dataInicial, i * 7), n));
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
const $weekPatternGroup = document.getElementById('weekPatternGroup');
const $formOrdinal = document.getElementById('formOrdinal');
const $formWeekday = document.getElementById('formWeekday');
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
const $meetingPopover = document.getElementById('meetingPopover');
const $mpTitle = document.getElementById('mpTitle');
const $mpLabel = document.getElementById('mpLabel');
const $mpDate = document.getElementById('mpDate');
const $mpDone = document.getElementById('mpDone');
const $mpDesc = document.getElementById('mpDesc');

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

const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';

// Uma reunião conta como "feita" se foi marcada manualmente OU se a data passou
function isMeetingDone(r) {
  return r.concluido === true || getMeetingStatus(r.data) === 'passada';
}

function cardProgress(client) {
  const total = client.reunioes.length;
  const done = client.reunioes.filter(isMeetingDone).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return { done, total, pct };
}

function meetingItemHTML(client, r, mi) {
  const status = getMeetingStatus(r.data);
  const checked = r.concluido === true;
  const marker = (checked || status === 'passada') ? ICON_CHECK : '';
  let side = '';
  if (checked) {
    side = '<span class="meeting-rel done">✓ Concluído</span>';
  } else if (status === 'hoje') {
    side = '<span class="meeting-badge">Hoje</span>';
  } else if (status === 'futura') {
    side = `<span class="meeting-rel">${relativeDateLabel(r.data)}</span>`;
  }
  const desc = effectiveDescricao(r);
  const expanded = !!desc && expandedMeetings.has(`${client.id}:${mi}`);
  const chevron = desc ? `
    <span class="meeting-chevron" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </span>` : '';
  const detailsHTML = expanded ? `
    <div class="meeting-details">
      <div class="meeting-details-title">O que deve ser feito</div>
      ${desc.split('\n').map(l => l.trim()).filter(Boolean).map(l => `
        <div class="meeting-detail-line"><span class="detail-dot"></span>${escapeHtml(l)}</div>
      `).join('')}
    </div>` : '';
  const cls = `timeline-item ${status}${checked ? ' concluido' : ''}${desc ? ' expandable' : ''}${expanded ? ' expanded' : ''}`;
  return `
    <div class="${cls}" data-client="${client.id}" data-idx="${mi}"${desc ? ' data-expandable="1"' : ''}>
      <button type="button" class="timeline-marker" data-action="toggle" title="${checked ? 'Marcar como não concluído' : 'Marcar como concluído'}" aria-label="${checked ? 'Desmarcar' : 'Marcar como concluído'}: ${escapeHtml(r.label)}">${marker}</button>
      ${dateChipHTML(r.data)}
      <div class="timeline-body">
        <span class="meeting-label">${escapeHtml(r.label)}</span>
        <span class="meeting-date">${getWeekdayFull(r.data)}</span>
      </div>
      ${side}
      ${chevron}
      <button type="button" class="meeting-edit-btn" data-action="edit" title="Editar reunião" aria-label="Editar ${escapeHtml(r.label)}">${ICON_EDIT}</button>
    </div>
    ${detailsHTML}
  `;
}

function meetingsTrackHTML(client) {
  return client.reunioes.map((r, mi) => meetingItemHTML(client, r, mi)).join('');
}

function renderCards() {
  closeMeetingPopover();
  // Preserva a posição de scroll de cada timeline entre renderizações
  const scrollPos = {};
  $cardsGrid.querySelectorAll('.client-card').forEach(card => {
    const tl = card.querySelector('.card-timeline');
    if (tl && tl.scrollTop) scrollPos[card.dataset.id] = tl.scrollTop;
  });

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

    const { done, total, pct } = cardProgress(client);
    const meetingsHTML = meetingsTrackHTML(client);

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

  // Restaura a posição de scroll das timelines
  Object.entries(scrollPos).forEach(([id, top]) => {
    const tl = $cardsGrid.querySelector(`.client-card[data-id="${id}"] .card-timeline`);
    if (tl) tl.scrollTop = top;
  });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- Per-item meeting interactions (check / data / descrição) ----

function findMeeting(clientId, idx) {
  const client = clients.find(c => c.id === clientId);
  if (!client || !client.reunioes || !client.reunioes[idx]) return null;
  return { client, meeting: client.reunioes[idx] };
}

// Atualiza apenas um card no lugar (sem re-renderizar a grade toda) —
// mantém o scroll e evita re-disparar a animação de entrada
function updateCardInPlace(clientId) {
  const client = clients.find(c => c.id === clientId);
  const card = $cardsGrid.querySelector(`.client-card[data-id="${clientId}"]`);
  if (!client || !card) { renderCards(); return; }
  client.reunioes.forEach(r => { r.status = getMeetingStatus(r.data); });
  client.cardStatus = getCardStatus(client.reunioes);
  const isFinalizado = client.cardStatus === 'finalizado';
  card.classList.toggle('finalizado', isFinalizado);
  const badge = card.querySelector('.status-badge');
  badge.className = `status-badge ${isFinalizado ? 'finalizado' : 'em-andamento'}`;
  badge.textContent = isFinalizado ? 'Projeto Finalizado' : 'Em andamento';
  const { done, total, pct } = cardProgress(client);
  card.querySelector('.progress-fill').style.width = pct + '%';
  card.querySelector('.progress-text').textContent = `${done} de ${total}`;
  card.querySelector('.timeline-track').innerHTML = meetingsTrackHTML(client);
  updateStats();
}

function toggleMeetingDone(clientId, idx) {
  const ref = findMeeting(clientId, idx);
  if (!ref) return;
  ref.meeting.concluido = !(ref.meeting.concluido === true);
  saveClients();
  updateCardInPlace(clientId);
}

// ---- Meeting editor popover ----

let popoverClientId = null;
let popoverIdx = null;

function positionPopover(anchorEl) {
  const r = anchorEl.getBoundingClientRect();
  $meetingPopover.style.visibility = 'hidden';
  $meetingPopover.classList.add('active');
  const pr = $meetingPopover.getBoundingClientRect();
  let top = r.bottom + 6;
  if (top + pr.height > window.innerHeight - 8) top = Math.max(8, r.top - pr.height - 6);
  let left = r.left;
  if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
  if (left < 8) left = 8;
  $meetingPopover.style.top = top + 'px';
  $meetingPopover.style.left = left + 'px';
  $meetingPopover.style.visibility = '';
}

function openMeetingPopover(clientId, idx, anchorEl) {
  const ref = findMeeting(clientId, idx);
  if (!ref) return;
  popoverClientId = clientId;
  popoverIdx = idx;
  $mpTitle.textContent = ref.meeting.label;
  $mpLabel.value = ref.meeting.label;
  $mpDate.value = ref.meeting.data;
  $mpDone.checked = ref.meeting.concluido === true;
  $mpDesc.value = effectiveDescricao(ref.meeting);
  positionPopover(anchorEl);
  setTimeout(() => $mpDate.focus(), 50);
}

function closeMeetingPopover() {
  if (!$meetingPopover.classList.contains('active')) return;
  $meetingPopover.classList.remove('active');
  popoverClientId = null;
  popoverIdx = null;
}

function saveMeetingPopover() {
  const ref = findMeeting(popoverClientId, popoverIdx);
  if (!ref) { closeMeetingPopover(); return; }
  const newDate = $mpDate.value;
  if (!newDate) { showToast('Informe uma data para a reunião.', 'error'); return; }
  const newLabel = $mpLabel.value.trim();
  if (!newLabel) { showToast('Informe o nome da reunião.', 'error'); return; }
  ref.meeting.label = newLabel;
  ref.meeting.data = newDate;
  ref.meeting.concluido = $mpDone.checked;
  ref.meeting.descricao = $mpDesc.value.trim();
  // Mantém a timeline em ordem cronológica após mudar a data
  ref.client.reunioes.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  saveClients();
  closeMeetingPopover();
  renderCards();
  showToast('Reunião atualizada!');
}

// ---- Expansão dos subtópicos (clique no item abre seção abaixo) ----

const expandedMeetings = new Set();

function toggleMeetingDetails(clientId, idx) {
  const key = `${clientId}:${idx}`;
  if (expandedMeetings.has(key)) expandedMeetings.delete(key);
  else expandedMeetings.add(key);
  updateCardInPlace(clientId);
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
    frequencia: $formFreq.value,
    ordinal: $formOrdinal.value,
    diaSemana: parseInt($formWeekday.value, 10)
  };
}

function updateCustomUI() {
  const custom = $toggleCustom.checked;
  const rec = custom && $toggleRecurring.checked;
  $customEventArea.style.display = custom ? 'block' : 'none';
  $formDateLabelText.textContent = custom ? 'Data da 1ª Reunião' : 'Data da 1ª Reunião (Onboarding)';
  $recurringGroup.style.display = rec ? 'block' : 'none';
  $weekPatternGroup.style.display = rec && $formFreq.value === 'mensal_dia' ? 'block' : 'none';
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
  $formOrdinal.value = (client && client.ordinalSemana) || 'ultima';
  $formWeekday.value = (client && client.diaSemana != null && client.diaSemana !== '') ? String(client.diaSemana) : '5';
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
  if (reunioes.length === 0) {
    showToast('Nenhuma data foi gerada — ajuste a data inicial ou a recorrência.', 'error');
    return;
  }

  const isWeekPattern = opts.recorrente && opts.frequencia === 'mensal_dia';
  const eventFields = {
    tipoEvento: opts.custom ? 'personalizado' : 'padrao',
    eventosPersonalizados: opts.custom ? opts.nomes : [],
    recorrente: opts.recorrente,
    frequencia: opts.recorrente ? opts.frequencia : '',
    ordinalSemana: isWeekPattern ? opts.ordinal : '',
    diaSemana: isWeekPattern ? opts.diaSemana : ''
  };

  if (editingClientId) {
    const idx = clients.findIndex(c => c.id === editingClientId);
    if (idx !== -1) {
      const existing = clients[idx];
      // Se a configuração do cronograma não mudou, preserva as reuniões
      // existentes (com seus checks, datas e descrições já editados no card)
      const scheduleSame =
        existing.dataInicial === dataInicial &&
        (existing.tipoEvento || 'padrao') === eventFields.tipoEvento &&
        JSON.stringify(existing.eventosPersonalizados || []) === JSON.stringify(eventFields.eventosPersonalizados) &&
        !!existing.recorrente === !!eventFields.recorrente &&
        (existing.frequencia || '') === eventFields.frequencia &&
        String(existing.ordinalSemana || '') === String(eventFields.ordinalSemana || '') &&
        String(existing.diaSemana ?? '') === String(eventFields.diaSemana ?? '');
      const reunioesFinal = scheduleSame && Array.isArray(existing.reunioes) && existing.reunioes.length
        ? existing.reunioes
        : reunioes;
      clients[idx] = {
        ...existing,
        nomeCliente,
        nomeProjeto,
        dataInicial,
        responsavel,
        reunioes: reunioesFinal,
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
$formFreq.addEventListener('change', updateCustomUI);
$formOrdinal.addEventListener('change', updateMeetingsPreview);
$formWeekday.addEventListener('change', updateMeetingsPreview);
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

// Card timeline interactions:
// marcador = check, lápis = editor, clique no item = expande os subtópicos
$cardsGrid.addEventListener('click', (e) => {
  const item = e.target.closest('.timeline-item');
  if (!item) return;
  const clientId = item.dataset.client;
  const idx = parseInt(item.dataset.idx, 10);
  const action = e.target.closest('[data-action]');
  if (action) {
    if (action.dataset.action === 'toggle') toggleMeetingDone(clientId, idx);
    else if (action.dataset.action === 'edit') openMeetingPopover(clientId, idx, item);
    return;
  }
  if (item.dataset.expandable) toggleMeetingDetails(clientId, idx);
});

// Meeting editor popover
document.getElementById('mpSave').addEventListener('click', saveMeetingPopover);
document.getElementById('mpCancel').addEventListener('click', closeMeetingPopover);
document.getElementById('mpClose').addEventListener('click', closeMeetingPopover);
$meetingPopover.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
    e.preventDefault();
    saveMeetingPopover();
  }
});

// Fecha popover ao clicar fora
document.addEventListener('click', (e) => {
  if (!$meetingPopover.classList.contains('active')) return;
  if (e.target.closest('#meetingPopover') || e.target.closest('[data-action="edit"]')) return;
  closeMeetingPopover();
});

// Qualquer scroll (inclusive dentro das timelines) fecha o popover
document.addEventListener('scroll', closeMeetingPopover, true);
window.addEventListener('resize', closeMeetingPopover);

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
    if ($meetingPopover.classList.contains('active')) {
      closeMeetingPopover();
    } else if ($deleteOverlay.classList.contains('active')) {
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
    reunioes: (c.reunioes || []).map(r => ({
      data: r.data,
      label: r.label,
      concluido: r.concluido === true,
      descricao: r.descricao ?? null
    }))
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
