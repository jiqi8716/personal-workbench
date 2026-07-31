const fs = require('node:fs');
const vm = require('node:vm');

function classList() {
  const values = new Set();
  return {
    add: (...items) => items.forEach(item => values.add(item)),
    remove: (...items) => items.forEach(item => values.delete(item)),
    toggle: (item, force) => {
      if (force === true) values.add(item);
      else if (force === false) values.delete(item);
      else if (values.has(item)) values.delete(item);
      else values.add(item);
    },
    contains: item => values.has(item)
  };
}

const elements = new Map();
function element(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      id,
      className: '',
      classList: classList(),
      innerHTML: '',
      textContent: '',
      value: '',
      style: {},
      addEventListener() {},
      querySelectorAll() { return []; }
    });
  }
  return elements.get(id);
}

const storage = new Map();
global.localStorage = {
  getItem: key => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key)
};
global.window = {
  scrollTo() {},
  open() {}
};
global.document = {
  readyState: 'complete',
  body: { style: {} },
  getElementById: element,
  querySelectorAll() { return []; },
  addEventListener() {},
  createElement() {
    return {
      click() {},
      style: {},
      content: { querySelectorAll() { return []; } },
      set innerHTML(value) { this._html = value; },
      get innerHTML() { return this._html || ''; }
    };
  }
};
global.confirm = () => true;
global.alert = message => {
  throw new Error(message);
};
global.URL = class URLMock {
  constructor(value) {
    this.protocol = String(value).startsWith('https:') ? 'https:' : 'http:';
    this.href = String(value);
  }
  static createObjectURL() { return 'blob:test'; }
  static revokeObjectURL() {}
};

const now = new Date().toISOString();
const today = now.slice(0, 10);
storage.set('personal-workbench-v1', JSON.stringify({
  tasks: [
    {
      id: 'task_open',
      title: '写方案',
      status: 'doing',
      due: today,
      priority: 'high',
      tag: '工作',
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'task_planned',
      title: '整理笔记',
      status: 'todo',
      plannedDate: today,
      plannedStart: '14:00',
      plannedEnd: '15:30',
      deadlineDate: today,
      deadlineTime: '18:00',
      priority: 'medium',
      tag: '',
      createdAt: now,
      updatedAt: now
    }
  ],
  notes: [
    { id: 'note_1', title: 'Markdown', content: '# 标题\n\n**正文**', createdAt: now, updatedAt: now },
    { id: 'goal_1', title: '长期写作', content: '持续记录自己的思考。', kind: 'goal', createdAt: now, updatedAt: now }
  ],
  events: [
    { id: 'event_1', title: '讨论', date: today, time: '10:00', note: '一段很长的备注\n第二行', createdAt: now, updatedAt: now }
  ],
  resources: []
}));

vm.runInThisContext(fs.readFileSync('app.js', 'utf8'), { filename: 'app.js' });

const migrated = JSON.parse(storage.get('personal-workbench-v1'));
if (migrated.tasks[0].status !== 'todo' || migrated.tasks[0].completed !== false) {
  throw new Error('Legacy doing task was not migrated to an open task');
}
if (migrated.tasks[0].deadlineDate !== today) {
  throw new Error('Legacy due date was not migrated to deadlineDate');
}
if (migrated.notes[0].kind !== 'note' || migrated.notes[1].kind !== 'goal') {
  throw new Error('Note kinds were not normalized');
}

for (const page of ['overview', 'tasks', 'notes', 'schedule', 'goals', 'settings']) {
  window.App.navigate(page);
  if (!element('content').innerHTML.includes('class="page')) {
    throw new Error(`Page did not render: ${page}`);
  }
}

window.App.setScheduleView('upcoming');
window.App.toggleTask('task_planned');
const completed = JSON.parse(storage.get('personal-workbench-v1')).tasks.find(task => task.id === 'task_planned');
if (!completed.completed || completed.status !== 'done' || !completed.completedAt) {
  throw new Error('Direct task completion did not persist');
}
window.App.navigate('tasks');

console.log('Workbench smoke test passed');
