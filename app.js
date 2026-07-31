(() => {
  'use strict';

  const STORAGE_KEY = 'personal-workbench-v1';
  const PAGES = {
    overview: '工作台',
    tasks: '任务',
    notes: '笔记',
    schedule: '日程',
    goals: '长期目标',
    settings: '设置'
  };

  const emptyState = () => ({
    tasks: [],
    notes: [],
    events: [],
    resources: []
  });

  const state = {
    data: emptyState(),
    page: 'overview',
    taskFilter: 'open',
    scheduleView: 'calendar',
    calendarCursor: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    selectedDate: toDateInput(new Date()),
    currentNoteId: null,
    noteEditor: null,
    noteSaveTimer: null,
    toastTimer: null,
    cloudStatus: {
      code: 'local',
      label: '本地模式',
      detail: '登录后启用云端同步',
      session: null
    }
  };

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function escapeHTML(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function toDateInput(value) {
    const date = value instanceof Date ? value : new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatDate(value, options = {}) {
    if (!value) return '未设置';
    const date = new Date(`${value}T00:00:00`);
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'short',
      day: 'numeric',
      ...options
    }).format(date);
  }

  function formatDateTime(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  }

  function normalizeData(data) {
    const normalized = emptyState();
    const fallbackTime = new Date().toISOString();
    Object.keys(normalized).forEach(collection => {
      normalized[collection] = Array.isArray(data?.[collection])
        ? data[collection].map(item => ({
            ...item,
            createdAt: item.createdAt || item.updatedAt || fallbackTime,
            updatedAt: item.updatedAt || item.createdAt || fallbackTime
          }))
        : [];
    });
    normalized.tasks = normalized.tasks.map(task => {
      const completed = task.completed === true || task.status === 'done';
      return {
        ...task,
        status: completed ? 'done' : 'todo',
        completed,
        completedAt: completed ? (task.completedAt || task.updatedAt || fallbackTime) : '',
        plannedDate: task.plannedDate || '',
        plannedStart: task.plannedStart || '',
        plannedEnd: task.plannedEnd || '',
        deadlineDate: Object.prototype.hasOwnProperty.call(task, 'deadlineDate')
          ? (task.deadlineDate || '')
          : (task.due || ''),
        deadlineTime: task.deadlineTime || ''
      };
    });
    normalized.notes = normalized.notes.map(note => ({
      ...note,
      kind: note.kind === 'goal' ? 'goal' : 'note'
    }));
    return normalized;
  }

  function isTaskDone(task) {
    return task.completed === true || task.status === 'done';
  }

  function taskPlanLabel(task) {
    if (!task.plannedDate) return '';
    const date = formatDate(task.plannedDate);
    if (!task.plannedStart) return `计划 ${date}`;
    const time = task.plannedEnd
      ? `${task.plannedStart}–${task.plannedEnd}`
      : task.plannedStart;
    return `计划 ${date} ${time}`;
  }

  function taskDeadlineLabel(task, includeDate = true) {
    if (!task.deadlineDate) return '';
    const date = includeDate ? `${formatDate(task.deadlineDate)} ` : '';
    return `DDL ${date}${task.deadlineTime || '当天'}`;
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && typeof saved === 'object') {
        state.data = normalizeData(saved);
        save();
      }
    } catch (error) {
      console.warn('无法读取本地数据：', error);
      toast('本地数据读取失败，已使用空白工作台');
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  }

  function queueUpsert(collection, item) {
    window.WorkbenchCloud?.queueUpsert(collection, item);
  }

  function queueDelete(collection, id, deletedAt = new Date().toISOString()) {
    window.WorkbenchCloud?.queueDelete(collection, id, deletedAt);
  }

  function content() {
    return document.getElementById('content');
  }

  function navigate(page) {
    if (!PAGES[page]) return;
    state.page = page;
    document.getElementById('pageTitle').textContent = PAGES[page];
    document.querySelectorAll('.tab-item').forEach(button => {
      button.classList.toggle('active', button.dataset.page === page);
    });
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function render() {
    const renderers = {
      overview: renderOverview,
      tasks: renderTasks,
      notes: renderNotes,
      schedule: renderSchedule,
      goals: renderGoals,
      settings: renderSettings
    };
    renderers[state.page]();
  }

  function renderOverview() {
    const hour = new Date().getHours();
    const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
    const today = toDateInput(new Date());
    const activeTasks = state.data.tasks.filter(task => !isTaskDone(task));
    const upcomingTasks = activeTasks
      .filter(task => task.plannedDate || task.deadlineDate)
      .sort((a, b) => taskSortKey(a).localeCompare(taskSortKey(b)))
      .slice(0, 4);
    const regularNotes = state.data.notes.filter(note => note.kind !== 'goal');
    const goals = state.data.notes.filter(note => note.kind === 'goal');

    content().innerHTML = `
      <div class="page">
        <div class="overview-greeting">
          <div class="greeting-text">${greeting}，今天也要保持专注 ✨</div>
          <div class="greeting-date">${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full' }).format(new Date())}</div>
        </div>
        <div class="stat-grid">
          ${statCard('📋', activeTasks.length, '待办任务', 'var(--primary-light)')}
          ${statCard('✅', state.data.tasks.filter(isTaskDone).length, '已完成', 'var(--success-light)')}
          ${statCard('📝', regularNotes.length, '笔记', 'var(--warning-light)')}
          ${statCard('◎', goals.length, '长期目标', 'var(--purple-light)')}
        </div>
        <section class="section">
          <div class="section-header">
            <h2 class="section-title">近期任务</h2>
            <button class="section-more" onclick="App.navigate('tasks')">查看全部</button>
          </div>
          <div class="section-body">
            ${upcomingTasks.length ? upcomingTasks.map(task => `
              <div class="list-item" onclick="App.editTask('${task.id}')">
                ${taskCheckbox(task)}
                <div class="list-item-content">
                  <div class="list-item-title">${escapeHTML(task.title)}</div>
                  <div class="list-item-meta">${escapeHTML([taskPlanLabel(task), taskDeadlineLabel(task)].filter(Boolean).join(' · '))}</div>
                </div>
                <span class="list-item-badge priority-${task.priority}">${priorityLabel(task.priority)}</span>
              </div>
            `).join('') : emptyBlock('还没有安排时间的任务')}
          </div>
        </section>
        <section class="section">
          <div class="section-header">
            <h2 class="section-title">今日安排</h2>
            <button class="section-more" onclick="App.openScheduleDate('${today}')">查看日历</button>
          </div>
          <div class="section-body overview-agenda">
            ${renderAgendaForDate(today, true)}
          </div>
        </section>
        <button class="btn btn-ghost" style="width:100%" onclick="App.navigate('settings')">数据管理与设置</button>
      </div>`;
  }

  function statCard(icon, value, label, background) {
    return `<div class="stat-card">
      <div class="stat-icon" style="background:${background}">${icon}</div>
      <div class="stat-info"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>
    </div>`;
  }

  function renderTasks() {
    const filters = [['open', '待办'], ['done', '已完成']];
    const tasks = state.data.tasks.filter(task =>
      state.taskFilter === 'done' ? isTaskDone(task) : !isTaskDone(task)
    );
    const sorted = [...tasks].sort((a, b) => {
      if (state.taskFilter === 'done') {
        return (b.completedAt || b.updatedAt).localeCompare(a.completedAt || a.updatedAt);
      }
      return taskSortKey(a).localeCompare(taskSortKey(b));
    });

    content().innerHTML = `
      <div class="page">
        <div class="task-filter">
          ${filters.map(([key, label]) => `<button class="filter-chip ${state.taskFilter === key ? 'active' : ''}" onclick="App.setTaskFilter('${key}')">${label}</button>`).join('')}
        </div>
        <div class="task-list">
          ${sorted.length ? sorted.map(taskCard).join('') : emptyBlock('这里还没有任务')}
        </div>
        <button class="btn-fab" onclick="App.editTask()" aria-label="添加任务">＋</button>
      </div>`;
  }

  function taskSortKey(task) {
    const plan = task.plannedDate
      ? `${task.plannedDate}T${task.plannedStart || '00:00'}`
      : '9999-12-31T23:59';
    const deadline = task.deadlineDate
      ? `${task.deadlineDate}T${task.deadlineTime || '23:59'}`
      : '9999-12-31T23:59';
    return plan < deadline ? plan : deadline;
  }

  function taskCheckbox(task, className = '') {
    const done = isTaskDone(task);
    return `<button class="task-checkbox ${done ? 'checked' : ''} ${className}" type="button"
      role="checkbox" aria-checked="${done}" aria-label="${done ? '恢复' : '完成'}${escapeHTML(task.title)}"
      onclick="event.stopPropagation();App.toggleTask('${task.id}')">${done ? '✓' : ''}</button>`;
  }

  function taskCard(task) {
    const done = isTaskDone(task);
    const nowKey = `${toDateInput(new Date())}T${new Date().toTimeString().slice(0, 5)}`;
    const deadlineKey = task.deadlineDate
      ? `${task.deadlineDate}T${task.deadlineTime || '23:59'}`
      : '';
    const overdue = deadlineKey && deadlineKey < nowKey && !done;
    return `<article class="task-card ${done ? 'status-done' : ''}" onclick="App.editTask('${task.id}')">
      ${taskCheckbox(task, 'task-card-checkbox')}
      <div class="task-card-content">
        <div class="task-card-title ${done ? 'done' : ''}">${escapeHTML(task.title)}</div>
        <div class="task-card-meta">
          <span class="priority-badge priority-${task.priority}">${priorityLabel(task.priority)}</span>
          ${task.tag ? `<span class="task-tag">${escapeHTML(task.tag)}</span>` : ''}
          ${task.plannedDate ? `<span class="task-date">${escapeHTML(taskPlanLabel(task))}</span>` : ''}
          ${task.deadlineDate ? `<span class="task-date ${overdue ? 'overdue' : ''}">${overdue ? '已逾期 · ' : ''}${escapeHTML(taskDeadlineLabel(task))}</span>` : ''}
        </div>
      </div>
    </article>`;
  }

  function priorityLabel(priority) {
    return { high: '高优先级', medium: '中优先级', low: '低优先级' }[priority] || '中优先级';
  }

  function setTaskFilter(filter) {
    state.taskFilter = filter;
    renderTasks();
  }

  function editTask(id = '') {
    const task = state.data.tasks.find(item => item.id === id) || {
      id: '',
      title: '',
      priority: 'medium',
      tag: '',
      plannedDate: '',
      plannedStart: '',
      plannedEnd: '',
      deadlineDate: '',
      deadlineTime: ''
    };
    openModal(task.id ? '编辑任务' : '新建任务', `
      <form id="taskForm" onsubmit="App.saveTask(event, '${task.id}')">
        <div class="field-group">
          <label class="field-label" for="taskTitle">任务名称</label>
          <input class="input" id="taskTitle" name="title" value="${escapeHTML(task.title)}" required maxlength="120" autofocus>
        </div>
        <div class="field-group">
          <label class="field-label" for="taskPriority">优先级</label>
          <select class="select" id="taskPriority" name="priority">
            ${option('high', '高', task.priority)}
            ${option('medium', '中', task.priority)}
            ${option('low', '低', task.priority)}
          </select>
        </div>
        <fieldset class="time-fieldset">
          <legend>计划时间 <span>我准备什么时候做</span></legend>
          <div class="field-group">
            <label class="field-label" for="taskPlannedDate">日期</label>
            <input class="input" id="taskPlannedDate" name="plannedDate" type="date" value="${escapeHTML(task.plannedDate)}">
          </div>
          <div class="time-row">
            <div class="field-group">
              <label class="field-label" for="taskPlannedStart">开始</label>
              <input class="input" id="taskPlannedStart" name="plannedStart" type="time" value="${escapeHTML(task.plannedStart)}">
            </div>
            <div class="field-group">
              <label class="field-label" for="taskPlannedEnd">结束</label>
              <input class="input" id="taskPlannedEnd" name="plannedEnd" type="time" value="${escapeHTML(task.plannedEnd)}">
            </div>
          </div>
        </fieldset>
        <fieldset class="time-fieldset">
          <legend>DDL <span>最晚什么时候完成</span></legend>
          <div class="time-row">
            <div class="field-group">
              <label class="field-label" for="taskDeadlineDate">截止日期</label>
              <input class="input" id="taskDeadlineDate" name="deadlineDate" type="date" value="${escapeHTML(task.deadlineDate)}">
            </div>
            <div class="field-group">
              <label class="field-label" for="taskDeadlineTime">具体时间</label>
              <input class="input" id="taskDeadlineTime" name="deadlineTime" type="time" value="${escapeHTML(task.deadlineTime)}">
            </div>
          </div>
        </fieldset>
        ${task.id ? `<div class="task-completion-row">${taskCheckbox(task)}<span>${isTaskDone(task) ? '已完成，点击恢复为待办' : '点击直接标记完成'}</span></div>` : ''}
        <div class="field-group">
          <label class="field-label" for="taskTag">标签</label>
          <input class="input" id="taskTag" name="tag" value="${escapeHTML(task.tag)}" maxlength="30" placeholder="例如：工作">
        </div>
        <div class="modal-footer" style="padding-left:0;padding-right:0">
          ${task.id ? `<button class="btn btn-danger" type="button" onclick="App.deleteTask('${task.id}')">删除</button>` : ''}
          <button class="btn btn-primary" type="submit">保存</button>
        </div>
      </form>`);
  }

  function saveTask(event, id) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const existing = state.data.tasks.find(task => task.id === id);
    const task = {
      id: id || uid('task'),
      title: form.get('title').trim(),
      status: existing && isTaskDone(existing) ? 'done' : 'todo',
      completed: existing ? isTaskDone(existing) : false,
      completedAt: existing?.completedAt || '',
      priority: form.get('priority'),
      plannedDate: form.get('plannedDate'),
      plannedStart: form.get('plannedStart'),
      plannedEnd: form.get('plannedEnd'),
      deadlineDate: form.get('deadlineDate'),
      deadlineTime: form.get('deadlineTime'),
      due: '',
      tag: form.get('tag').trim(),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (!task.title) return;
    if ((task.plannedStart || task.plannedEnd) && !task.plannedDate) {
      alert('设置计划时间前，请先选择计划日期');
      return;
    }
    if (task.plannedEnd && !task.plannedStart) {
      alert('设置结束时间前，请先选择开始时间');
      return;
    }
    if (task.plannedStart && task.plannedEnd && task.plannedEnd <= task.plannedStart) {
      alert('计划结束时间需要晚于开始时间');
      return;
    }
    if (task.deadlineTime && !task.deadlineDate) {
      alert('设置具体 DDL 时间前，请先选择截止日期');
      return;
    }
    if (existing) Object.assign(existing, task);
    else state.data.tasks.unshift(task);
    save();
    queueUpsert('tasks', task);
    closeModal();
    render();
    toast('任务已保存');
  }

  function toggleTask(id) {
    const task = state.data.tasks.find(item => item.id === id);
    if (!task) return;
    const completed = !isTaskDone(task);
    task.completed = completed;
    task.status = completed ? 'done' : 'todo';
    task.completedAt = completed ? new Date().toISOString() : '';
    task.updatedAt = new Date().toISOString();
    save();
    queueUpsert('tasks', task);
    if (document.getElementById('modalOverlay').classList.contains('active')) closeModal();
    render();
    toast(completed ? '已完成' : '已恢复为待办');
  }

  function deleteTask(id) {
    if (!confirm('确定删除这个任务吗？')) return;
    state.data.tasks = state.data.tasks.filter(task => task.id !== id);
    save();
    queueDelete('tasks', id);
    closeModal();
    render();
    toast('任务已删除');
  }

  function renderNotes() {
    const notes = state.data.notes
      .filter(note => note.kind !== 'goal')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    content().innerHTML = `
      <div class="page notes-layout">
        <div class="notes-list">
          ${notes.length ? notes.map(note => `
            <article class="note-item" onclick="App.openNote('${note.id}')">
              <div class="note-item-title">${escapeHTML(note.title || '无标题')}</div>
              <div class="note-item-preview markdown-card">${renderMarkdown(note.content || '*空白笔记*', true)}</div>
              <div class="note-item-date">${formatDateTime(note.updatedAt)}</div>
            </article>
          `).join('') : emptyBlock('还没有笔记')}
        </div>
        <button class="btn-fab" onclick="App.createNote('note')" aria-label="添加笔记">＋</button>
      </div>`;
  }

  function renderMarkdown(source, compact = false) {
    const html = window.marked ? marked.parse(source || '') : `<p>${escapeHTML(source || '')}</p>`;
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('script, iframe, object, embed, style, link, meta, form').forEach(node => node.remove());
    template.content.querySelectorAll('*').forEach(node => {
      [...node.attributes].forEach(attribute => {
        const name = attribute.name.toLowerCase();
        if (name.startsWith('on') || name === 'srcdoc') node.removeAttribute(attribute.name);
      });
    });
    template.content.querySelectorAll('a').forEach(link => {
      const safeUrl = safeExternalUrl(link.getAttribute('href'));
      if (!safeUrl) link.removeAttribute('href');
      else {
        link.href = safeUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    });
    template.content.querySelectorAll('img').forEach(image => {
      if (compact) {
        image.remove();
        return;
      }
      const safeUrl = safeExternalUrl(image.getAttribute('src'));
      if (!safeUrl) image.remove();
      else image.src = safeUrl;
    });
    if (compact) {
      template.content.querySelectorAll('pre, table, hr').forEach(node => node.remove());
    }
    return template.innerHTML;
  }

  function createNote(kind = 'note') {
    const note = {
      id: uid('note'),
      title: '',
      content: '',
      kind: kind === 'goal' ? 'goal' : 'note',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.data.notes.unshift(note);
    save();
    queueUpsert('notes', note);
    openNote(note.id);
  }

  function openNote(id) {
    const note = state.data.notes.find(item => item.id === id);
    if (!note) return;
    state.currentNoteId = id;
    document.getElementById('noteTitleInput').value = note.title;
    document.getElementById('noteEditorContext').textContent = note.kind === 'goal' ? '长期目标' : 'Markdown 笔记';
    document.getElementById('noteEditorPage').classList.add('active');
    const host = document.getElementById('noteLiveEditor');
    host.innerHTML = '';
    if (window.Vditor) {
      state.noteEditor = new Vditor('noteLiveEditor', {
        cdn: './vendor/vditor',
        mode: 'ir',
        lang: 'zh_CN',
        height: '100%',
        minHeight: 360,
        value: note.content || '',
        placeholder: note.kind === 'goal' ? '写下这个长期目标，以及它为什么重要…' : '开始写作，Markdown 会在输入时直接呈现…',
        cache: { enable: false },
        typewriterMode: false,
        toolbar: [
          'headings', 'bold', 'italic', 'strike', '|',
          'list', 'ordered-list', 'check', 'quote', 'code', 'link', '|',
          'undo', 'redo'
        ],
        preview: {
          hljs: { enable: false },
          markdown: { sanitize: true }
        },
        input: value => scheduleNoteSave(value),
        blur: value => persistCurrentNote(value)
      });
    } else {
      host.innerHTML = `<textarea class="note-fallback" id="noteFallback" placeholder="在此输入 Markdown 内容…">${escapeHTML(note.content)}</textarea>`;
      document.getElementById('noteFallback').addEventListener('input', event => scheduleNoteSave(event.target.value));
    }
  }

  function currentNote() {
    return state.data.notes.find(note => note.id === state.currentNoteId);
  }

  function updateNoteTitle() {
    const note = currentNote();
    if (!note) return;
    note.title = document.getElementById('noteTitleInput').value;
    note.updatedAt = new Date().toISOString();
    save();
    clearTimeout(state.noteSaveTimer);
    state.noteSaveTimer = setTimeout(() => queueUpsert('notes', note), 450);
  }

  function scheduleNoteSave(value) {
    const note = currentNote();
    if (!note) return;
    note.content = value;
    note.updatedAt = new Date().toISOString();
    save();
    clearTimeout(state.noteSaveTimer);
    state.noteSaveTimer = setTimeout(() => queueUpsert('notes', note), 450);
  }

  function persistCurrentNote(value) {
    const note = currentNote();
    if (!note) return;
    if (typeof value === 'string') note.content = value;
    note.updatedAt = new Date().toISOString();
    save();
    queueUpsert('notes', note);
  }

  function closeNoteEditor() {
    clearTimeout(state.noteSaveTimer);
    const value = state.noteEditor?.getValue?.() ?? document.getElementById('noteFallback')?.value;
    if (typeof value === 'string') persistCurrentNote(value);
    state.noteEditor?.destroy?.();
    state.noteEditor = null;
    document.getElementById('noteEditorPage').classList.remove('active');
    state.currentNoteId = null;
    render();
  }

  function deleteNoteCurrent() {
    const note = currentNote();
    if (!note || !confirm(`确定删除这个${note.kind === 'goal' ? '长期目标' : '笔记'}吗？`)) return;
    const deletedId = state.currentNoteId;
    state.data.notes = state.data.notes.filter(note => note.id !== state.currentNoteId);
    save();
    queueDelete('notes', deletedId);
    closeNoteEditor();
    toast('笔记已删除');
  }

  function renderSchedule() {
    const viewSwitch = `
      <div class="schedule-switch" role="tablist" aria-label="日程视图">
        <button class="${state.scheduleView === 'calendar' ? 'active' : ''}" role="tab" onclick="App.setScheduleView('calendar')">日历</button>
        <button class="${state.scheduleView === 'upcoming' ? 'active' : ''}" role="tab" onclick="App.setScheduleView('upcoming')">接下来</button>
      </div>`;
    content().innerHTML = `
      <div class="page schedule-page">
        ${viewSwitch}
        ${state.scheduleView === 'calendar' ? renderCalendarView() : renderUpcomingView()}
        <button class="btn-fab" onclick="App.editEvent('', '${state.selectedDate}')" aria-label="添加日程">＋</button>
      </div>`;
  }

  function setScheduleView(view) {
    state.scheduleView = view === 'upcoming' ? 'upcoming' : 'calendar';
    renderSchedule();
  }

  function openScheduleDate(date) {
    state.selectedDate = date;
    const selected = new Date(`${date}T00:00:00`);
    state.calendarCursor = new Date(selected.getFullYear(), selected.getMonth(), 1);
    state.scheduleView = 'calendar';
    navigate('schedule');
  }

  function renderCalendarView() {
    const year = state.calendarCursor.getFullYear();
    const month = state.calendarCursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const gridStart = new Date(year, month, 1 - firstDay.getDay());
    const days = Array.from({ length: 42 }, (_, index) => {
      const day = new Date(gridStart);
      day.setDate(gridStart.getDate() + index);
      return day;
    });

    return `
      <div class="calendar-header">
        <button class="cal-nav-btn" onclick="App.changeMonth(-1)" aria-label="上个月">‹</button>
        <div class="calendar-month">${year} 年 ${month + 1} 月</div>
        <button class="cal-nav-btn" onclick="App.changeMonth(1)" aria-label="下个月">›</button>
      </div>
      <div class="calendar-legend">
        <span><i class="legend-dot event"></i>日程</span>
        <span><i class="legend-dot task"></i>计划任务</span>
        <span><i class="legend-dot deadline"></i>DDL</span>
      </div>
      <div class="calendar-grid">
        ${['日', '一', '二', '三', '四', '五', '六'].map(day => `<div class="cal-day-header">${day}</div>`).join('')}
        ${days.map(day => calendarDay(day, month)).join('')}
      </div>
      <section class="section">
        <div class="section-header">
          <h2 class="section-title">${formatDate(state.selectedDate, { year: 'numeric' })} 的安排</h2>
          <button class="section-more" onclick="App.editEvent('', '${state.selectedDate}')">添加日程</button>
        </div>
        <div class="section-body today-events">
          ${renderAgendaForDate(state.selectedDate)}
        </div>
      </section>`;
  }

  function calendarDay(day, currentMonth) {
    const date = toDateInput(day);
    const entries = agendaEntries(date);
    const kinds = [...new Set(entries.map(entry => entry.kind))];
    const classes = [
      'cal-day',
      day.getMonth() !== currentMonth ? 'other-month' : '',
      date === toDateInput(new Date()) ? 'today' : ''
    ].filter(Boolean).join(' ');
    return `<button class="${classes}" style="${date === state.selectedDate ? 'box-shadow:inset 0 0 0 2px var(--primary)' : ''}" onclick="App.selectDate('${date}')">
      <span class="cal-day-num">${day.getDate()}</span>
      <span class="cal-event-dots">${kinds.slice(0, 3).map(kind => `<i class="cal-event-dot ${kind}"></i>`).join('')}</span>
    </button>`;
  }

  function agendaEntries(date) {
    const entries = state.data.events
      .filter(event => event.date === date)
      .map(event => ({
        kind: 'event',
        time: event.time || '',
        sortTime: event.time || '00:00',
        item: event
      }));
    state.data.tasks.filter(task => !isTaskDone(task)).forEach(task => {
      if (task.plannedDate === date) {
        entries.push({
          kind: 'task',
          time: task.plannedStart || '',
          sortTime: task.plannedStart || '00:00',
          item: task
        });
      }
      if (task.deadlineDate === date && task.plannedDate !== date) {
        entries.push({
          kind: 'deadline',
          time: task.deadlineTime || '',
          sortTime: task.deadlineTime || '23:59',
          item: task
        });
      }
    });
    return entries.sort((a, b) => {
      const allDayA = a.time ? 1 : 0;
      const allDayB = b.time ? 1 : 0;
      if (allDayA !== allDayB) return allDayA - allDayB;
      return a.sortTime.localeCompare(b.sortTime);
    });
  }

  function renderAgendaForDate(date, compact = false) {
    const entries = agendaEntries(date);
    if (!entries.length) return emptyBlock('当天还没有安排');
    return entries.map(entry => agendaCard(entry, date, compact)).join('');
  }

  function agendaCard(entry, date, compact = false) {
    const item = entry.item;
    if (entry.kind === 'event') {
      return `<article class="agenda-card agenda-event ${compact ? 'compact' : ''}" onclick="App.editEvent('${item.id}')">
        <div class="agenda-time"><strong>${escapeHTML(item.time || '全天')}</strong><span>日程</span></div>
        <div class="agenda-info">
          <div class="agenda-title">${escapeHTML(item.title)}</div>
          ${item.note ? `<div class="agenda-note">${escapeHTML(item.note)}</div>` : ''}
        </div>
      </article>`;
    }
    const isDeadline = entry.kind === 'deadline';
    const timeLabel = isDeadline
      ? (item.deadlineTime || '当天')
      : (item.plannedStart
        ? `${item.plannedStart}${item.plannedEnd ? `–${item.plannedEnd}` : ''}`
        : '全天');
    const sameDayDeadline = !isDeadline && item.deadlineDate === date;
    return `<article class="agenda-card agenda-${entry.kind} ${compact ? 'compact' : ''}" onclick="App.editTask('${item.id}')">
      ${taskCheckbox(item, 'agenda-checkbox')}
      <div class="agenda-time"><strong>${escapeHTML(timeLabel)}</strong><span>${isDeadline ? 'DDL' : '计划任务'}</span></div>
      <div class="agenda-info">
        <div class="agenda-title">${escapeHTML(item.title)}</div>
        <div class="agenda-note">${sameDayDeadline ? escapeHTML(taskDeadlineLabel(item, false)) : escapeHTML(item.tag || '')}</div>
      </div>
    </article>`;
  }

  function renderUpcomingView() {
    const today = toDateInput(new Date());
    const dateSet = new Set();
    state.data.events.forEach(event => {
      if (event.date >= today) dateSet.add(event.date);
    });
    state.data.tasks.filter(task => !isTaskDone(task)).forEach(task => {
      if (task.plannedDate >= today) dateSet.add(task.plannedDate);
      if (task.deadlineDate >= today) dateSet.add(task.deadlineDate);
    });
    const dates = [...dateSet].sort();
    if (!dates.length) return `<div class="upcoming-empty">${emptyBlock('接下来还没有安排')}</div>`;
    return `<div class="upcoming-list">
      ${dates.map((date, index) => {
        const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(new Date(`${date}T00:00:00`));
        const relative = date === today ? '今天' : index === 0 ? '接下来' : '';
        return `<section class="upcoming-day">
          <div class="upcoming-date">
            <div><strong>${formatDate(date, { year: date.slice(0, 4) !== today.slice(0, 4) ? 'numeric' : undefined })}</strong><span>${weekday}</span></div>
            ${relative ? `<em>${relative}</em>` : ''}
          </div>
          <div class="upcoming-items">${renderAgendaForDate(date)}</div>
        </section>`;
      }).join('')}
    </div>`;
  }

  function changeMonth(offset) {
    state.calendarCursor = new Date(
      state.calendarCursor.getFullYear(),
      state.calendarCursor.getMonth() + offset,
      1
    );
    renderSchedule();
  }

  function selectDate(date) {
    state.selectedDate = date;
    const selected = new Date(`${date}T00:00:00`);
    state.calendarCursor = new Date(selected.getFullYear(), selected.getMonth(), 1);
    renderSchedule();
  }

  function editEvent(id = '', date = '') {
    const item = state.data.events.find(event => event.id === id) || {
      id: '',
      title: '',
      date: date || state.selectedDate || toDateInput(new Date()),
      time: '09:00',
      note: ''
    };
    openModal(item.id ? '编辑日程' : '新建日程', `
      <form onsubmit="App.saveEvent(event, '${item.id}')">
        <div class="field-group"><label class="field-label" for="eventTitle">标题</label><input class="input" id="eventTitle" name="title" value="${escapeHTML(item.title)}" required maxlength="120"></div>
        <div class="field-group"><label class="field-label" for="eventDate">日期</label><input class="input" id="eventDate" name="date" type="date" value="${escapeHTML(item.date)}" required></div>
        <div class="field-group"><label class="field-label" for="eventTime">时间</label><input class="input" id="eventTime" name="time" type="time" value="${escapeHTML(item.time)}"></div>
        <div class="field-group"><label class="field-label" for="eventNote">备注</label><textarea class="textarea" id="eventNote" name="note" maxlength="300">${escapeHTML(item.note)}</textarea></div>
        <div class="modal-footer" style="padding-left:0;padding-right:0">
          ${item.id ? `<button class="btn btn-danger" type="button" onclick="App.deleteEvent('${item.id}')">删除</button>` : ''}
          <button class="btn btn-primary" type="submit">保存</button>
        </div>
      </form>`);
  }

  function saveEvent(event, id) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const existing = state.data.events.find(item => item.id === id);
    const item = {
      id: id || uid('event'),
      title: form.get('title').trim(),
      date: form.get('date'),
      time: form.get('time'),
      note: form.get('note').trim(),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (existing) Object.assign(existing, item);
    else state.data.events.push(item);
    state.selectedDate = item.date;
    const selected = new Date(`${item.date}T00:00:00`);
    state.calendarCursor = new Date(selected.getFullYear(), selected.getMonth(), 1);
    save();
    queueUpsert('events', item);
    closeModal();
    render();
    toast('日程已保存');
  }

  function deleteEvent(id) {
    if (!confirm('确定删除这个日程吗？')) return;
    state.data.events = state.data.events.filter(event => event.id !== id);
    save();
    queueDelete('events', id);
    closeModal();
    render();
    toast('日程已删除');
  }

  function renderGoals() {
    const goals = state.data.notes
      .filter(note => note.kind === 'goal')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    content().innerHTML = `
      <div class="page goals-page">
        <div class="goals-intro">
          <span>长期方向</span>
          <p>记录真正重要、值得长期投入的事情。这里不追踪进度，只帮助你保持方向。</p>
        </div>
        <div class="goals-list">
          ${goals.length ? goals.map(goal => `
            <article class="goal-card" onclick="App.openNote('${goal.id}')">
              <div class="goal-marker">◎</div>
              <div class="goal-content">
                <div class="goal-title">${escapeHTML(goal.title || '未命名目标')}</div>
                <div class="goal-preview markdown-card">${renderMarkdown(goal.content || '*写下它为什么重要*', true)}</div>
                <div class="note-item-date">${formatDateTime(goal.updatedAt)}</div>
              </div>
            </article>
          `).join('') : emptyBlock('还没有长期目标')}
        </div>
        <button class="btn-fab" onclick="App.createNote('goal')" aria-label="添加长期目标">＋</button>
      </div>`;
  }

  function safeExternalUrl(value) {
    if (!value) return '';
    try {
      const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
      const url = new URL(normalized);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function renderSettings() {
    const cloud = state.cloudStatus;
    const accountEmail = cloud.session?.user?.email;
    content().innerHTML = `
      <div class="page">
        <section class="settings-section">
          <h3>云端同步</h3>
          <div class="cloud-status-card">
            <div class="cloud-status-icon">${accountEmail ? '☁️' : '📱'}</div>
            <div class="cloud-status-copy">
              <div class="cloud-status-title" id="settingsCloudTitle">${escapeHTML(cloud.label)}</div>
              <div class="cloud-status-detail" id="settingsCloudDetail">${escapeHTML(accountEmail || cloud.detail)}</div>
            </div>
          </div>
          <div style="display:flex;gap:10px">
            <button class="btn btn-primary btn-sm" style="flex:1" onclick="App.openCloudPanel()">${accountEmail ? '账户与同步' : '登录云端'}</button>
            ${accountEmail ? '<button class="btn btn-ghost btn-sm" style="flex:1" onclick="App.syncNow()">立即同步</button>' : ''}
          </div>
        </section>
        <section class="settings-section">
          <h3>数据概览</h3>
          <div class="data-stats">
            <div class="data-stat"><div class="data-stat-value">${state.data.tasks.length}</div><div class="data-stat-label">任务</div></div>
            <div class="data-stat"><div class="data-stat-value">${state.data.notes.filter(note => note.kind !== 'goal').length}</div><div class="data-stat-label">笔记</div></div>
            <div class="data-stat"><div class="data-stat-value">${state.data.events.length}</div><div class="data-stat-label">日程</div></div>
            <div class="data-stat"><div class="data-stat-value">${state.data.notes.filter(note => note.kind === 'goal').length}</div><div class="data-stat-label">目标</div></div>
          </div>
          ${state.data.resources.length ? `<p class="archived-data-note">另有 ${state.data.resources.length} 条旧资源数据被安全保留在备份中。</p>` : ''}
        </section>
        <section class="settings-section">
          <h3>备份与迁移</h3>
          <div class="settings-row">
            <div class="settings-info"><div class="settings-label">导出备份</div><div class="settings-desc">下载 JSON 文件，用于备份或迁移到另一台设备</div></div>
            <button class="btn btn-ghost btn-sm" onclick="App.exportData()">导出</button>
          </div>
          <div class="settings-row">
            <div class="settings-info"><div class="settings-label">导入备份</div><div class="settings-desc">从 JSON 备份恢复，会替换当前设备上的数据</div></div>
            <button class="btn btn-ghost btn-sm" onclick="document.getElementById('importFile').click()">导入</button>
            <input id="importFile" type="file" accept="application/json,.json" hidden onchange="App.importData(this.files[0]);this.value=''">
          </div>
          <div class="settings-row">
            <div class="settings-info"><div class="settings-label">清空全部数据</div><div class="settings-desc">${accountEmail ? '会从本机和云端删除，其他设备同步后也会清空' : '会清空当前浏览器中的全部内容'}，且不可撤销</div></div>
            <button class="btn btn-danger btn-sm" onclick="App.resetData()">清空</button>
          </div>
        </section>
        <section class="settings-section">
          <h3>关于存储</h3>
          <p style="color:var(--text-secondary);font-size:14px">所有修改都会先保存在本机。登录后，数据会在网络可用时自动同步到新加坡云端；公司网络暂时无法连接时仍可继续使用。</p>
        </section>
        <button class="btn btn-primary" style="width:100%" onclick="App.navigate('overview')">返回工作台</button>
      </div>`;
  }

  function exportData() {
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      data: state.data
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `工作台备份-${toDateInput(new Date())}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast('备份已导出');
  }

  async function importData(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = parsed.data || parsed;
      if (!incoming || !['tasks', 'notes', 'events', 'resources'].every(key => Array.isArray(incoming[key]))) {
        throw new Error('备份格式不正确');
      }
      if (!confirm('导入会替换当前设备上的数据，确定继续吗？')) return;
      const nextData = normalizeData({
        tasks: incoming.tasks,
        notes: incoming.notes,
        events: incoming.events,
        resources: incoming.resources
      });
      const deletedAt = new Date().toISOString();
      Object.keys(state.data).forEach(collection => {
        const incomingIds = new Set(nextData[collection].map(item => item.id));
        state.data[collection]
          .filter(item => !incomingIds.has(item.id))
          .forEach(item => queueDelete(collection, item.id, deletedAt));
      });
      state.data = nextData;
      save();
      window.WorkbenchCloud?.queueAll(state.data);
      render();
      toast('数据已导入');
    } catch (error) {
      alert(`导入失败：${error.message}`);
    }
  }

  function resetData() {
    const isCloudConnected = Boolean(window.WorkbenchCloud?.getSession()?.user);
    const scope = isCloudConnected
      ? '本机和云端中的全部工作台数据（其他设备同步后也会清空）'
      : '当前浏览器中的全部工作台数据';
    if (!confirm(`确定清空${scope}吗？此操作不可撤销。`)) return;
    const deletedAt = new Date().toISOString();
    Object.keys(state.data).forEach(collection => {
      state.data[collection].forEach(item => queueDelete(collection, item.id, deletedAt));
    });
    state.data = emptyState();
    save();
    render();
    toast(isCloudConnected ? '全部数据已清空，正在同步' : '本机数据已清空');
  }

  function updateCloudStatus(nextStatus) {
    state.cloudStatus = nextStatus;
    const button = document.getElementById('syncStatusButton');
    const label = document.getElementById('syncStatusLabel');
    if (button) {
      button.className = `sync-status status-${nextStatus.code}`;
      button.title = nextStatus.detail || nextStatus.label;
    }
    if (label) label.textContent = nextStatus.label;
    const settingsTitle = document.getElementById('settingsCloudTitle');
    const settingsDetail = document.getElementById('settingsCloudDetail');
    if (settingsTitle) settingsTitle.textContent = nextStatus.label;
    if (settingsDetail) {
      settingsDetail.textContent = nextStatus.session?.user?.email || nextStatus.detail || '';
    }
  }

  function openCloudPanel() {
    const cloud = window.WorkbenchCloud;
    const session = cloud?.getSession();
    const status = cloud?.getStatus() || state.cloudStatus;
    if (session?.user) {
      openModal('云端同步', `
        <div class="cloud-status-card">
          <div class="cloud-status-icon">☁️</div>
          <div class="cloud-status-copy">
            <div class="cloud-status-title">${escapeHTML(status.label)}</div>
            <div class="cloud-status-detail">${escapeHTML(status.detail || '')}</div>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-info">
            <div class="settings-label">已登录账号</div>
            <div class="settings-desc">${escapeHTML(session.user.email || '')}</div>
          </div>
        </div>
        <p style="font-size:13px;color:var(--text-secondary);margin:14px 0">修改会先保存在本机，再在网络可用时同步。退出账号不会删除本机数据。</p>
        <div class="modal-footer" style="padding-left:0;padding-right:0">
          <button class="btn btn-ghost" type="button" onclick="App.signOutCloud()">退出登录</button>
          <button class="btn btn-primary" type="button" onclick="App.syncNow()">立即同步</button>
        </div>`);
      return;
    }

    openModal('登录云端', `
      <form onsubmit="App.submitCloudAuth(event, 'signin')">
        <div class="field-group">
          <label class="field-label" for="cloudEmail">邮箱</label>
          <input class="input" id="cloudEmail" name="email" type="email" autocomplete="email" required placeholder="name@example.com">
        </div>
        <div class="field-group">
          <label class="field-label" for="cloudPassword">密码</label>
          <input class="input" id="cloudPassword" name="password" type="password" autocomplete="current-password" minlength="8" required placeholder="至少 8 位">
        </div>
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:14px">首次使用请选择“注册”。若公司网络暂时无法连接，工作台仍会继续保存在本机。</p>
        <div class="modal-footer" style="padding-left:0;padding-right:0">
          <button class="btn btn-ghost" type="button" onclick="App.submitCloudAuth(event, 'signup')">注册</button>
          <button class="btn btn-primary" type="submit">登录</button>
        </div>
      </form>`);
  }

  async function submitCloudAuth(event, mode) {
    event.preventDefault();
    const form = document.getElementById('cloudEmail')?.form;
    if (!form?.reportValidity()) return;
    const email = form.elements.email.value.trim();
    const password = form.elements.password.value;
    try {
      toast(mode === 'signup' ? '正在注册…' : '正在登录…');
      if (mode === 'signup') {
        const result = await window.WorkbenchCloud.signUp(email, password);
        if (!result.session) {
          closeModal();
          toast('请检查邮箱并完成账号验证');
          return;
        }
      } else {
        await window.WorkbenchCloud.signIn(email, password);
      }
      closeModal();
      toast('云端账号已连接');
      if (state.page === 'settings') renderSettings();
    } catch (error) {
      alert(`云端账号操作失败：${error.message}`);
    }
  }

  async function syncNow() {
    closeModal();
    await window.WorkbenchCloud?.syncNow({ quiet: false });
  }

  async function signOutCloud() {
    try {
      await window.WorkbenchCloud?.signOut();
      closeModal();
      toast('已退出云端账号，本机数据仍保留');
      if (state.page === 'settings') renderSettings();
    } catch (error) {
      alert(`退出失败：${error.message}`);
    }
  }

  function openSearch() {
    document.getElementById('searchOverlay').classList.add('active');
    const input = document.getElementById('searchInput');
    input.value = '';
    document.getElementById('searchResults').innerHTML = emptyBlock('输入关键词开始搜索');
    setTimeout(() => input.focus(), 30);
  }

  function closeSearch() {
    document.getElementById('searchOverlay').classList.remove('active');
  }

  function doSearch(query) {
    const value = query.trim().toLowerCase();
    if (!value) {
      document.getElementById('searchResults').innerHTML = emptyBlock('输入关键词开始搜索');
      return;
    }
    const results = [
      ...state.data.tasks.filter(item => `${item.title} ${item.tag}`.toLowerCase().includes(value)).map(item => ({ type: 'tasks', id: item.id, icon: '📋', title: item.title, label: '任务' })),
      ...state.data.events.filter(item => `${item.title} ${item.note}`.toLowerCase().includes(value)).map(item => ({ type: 'schedule', id: item.id, date: item.date, icon: '📅', title: item.title, label: '日程' })),
      ...state.data.notes.filter(item => `${item.title} ${item.content}`.toLowerCase().includes(value)).map(item => ({
        type: item.kind === 'goal' ? 'goals' : 'notes',
        id: item.id,
        icon: item.kind === 'goal' ? '◎' : '📝',
        title: item.title || '无标题',
        label: item.kind === 'goal' ? '长期目标' : '笔记'
      }))
    ].slice(0, 30);
    document.getElementById('searchResults').innerHTML = results.length ? results.map(result => `
      <div class="search-result-item" onclick="App.openSearchResult('${result.type}', '${result.id}', '${result.date || ''}')">
        <span class="search-result-icon">${result.icon}</span>
        <span class="search-result-info"><span class="search-result-title">${escapeHTML(result.title)}</span><span class="search-result-type">${result.label}</span></span>
      </div>
    `).join('') : emptyBlock('没有找到匹配内容');
  }

  function openSearchResult(type, id, date = '') {
    closeSearch();
    navigate(type);
    if (type === 'tasks') editTask(id);
    if (type === 'notes' || type === 'goals') openNote(id);
    if (type === 'schedule') {
      if (date) selectDate(date);
      editEvent(id);
    }
  }

  function option(value, label, selected) {
    return `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`;
  }

  function emptyBlock(message) {
    return `<div class="empty-state"><div class="empty-state-icon">· · ·</div><div class="empty-state-text">${escapeHTML(message)}</div></div>`;
  }

  function openModal(title, body) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = body;
    document.getElementById('modalOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
    document.body.style.overflow = '';
  }

  function toast(message) {
    const element = document.getElementById('toast');
    if (!element) return;
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => element.classList.remove('show'), 2200);
  }

  function init() {
    load();
    document.querySelectorAll('.tab-item').forEach(button => {
      button.addEventListener('click', () => navigate(button.dataset.page));
    });
    document.getElementById('searchOverlay').addEventListener('click', event => {
      if (event.target.id === 'searchOverlay') closeSearch();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeSearch();
        closeModal();
      }
    });
    navigate('overview');
    window.WorkbenchCloud?.init({
      getData: () => state.data,
      setData: nextData => {
        state.data = normalizeData(nextData);
        save();
        render();
      },
      onStatus: updateCloudStatus,
      toast
    });
  }

  window.App = {
    navigate,
    setTaskFilter,
    editTask,
    saveTask,
    toggleTask,
    deleteTask,
    createNote,
    openNote,
    updateNoteTitle,
    closeNoteEditor,
    deleteNoteCurrent,
    setScheduleView,
    openScheduleDate,
    changeMonth,
    selectDate,
    editEvent,
    saveEvent,
    deleteEvent,
    exportData,
    importData,
    resetData,
    openCloudPanel,
    submitCloudAuth,
    syncNow,
    signOutCloud,
    openSearch,
    closeSearch,
    doSearch,
    openSearchResult,
    closeModal
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
