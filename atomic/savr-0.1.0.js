const core = 'https://atomicdata.dev/properties/';
const prefix = 'savr-article/v1:';
const fields = [
  ['name', 'Title'], ['url', 'URL (optional)'], ['body', 'Article text', true]
];

function el(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

async function library(store) {
  const {table, rowClass} = await store.getData();
  if (!table || !rowClass) throw new Error('Savr needs an article table.');

  function item(row) {
    if (row.error) throw new Error('Atomic could not read an article.');
    const data = row.get(core + 'description');
    if (row.get(core + 'parent') !== table || !row.get(core + 'isA')?.includes(rowClass) ||
        typeof data !== 'string' || !data.startsWith(prefix)) return;
    return {...JSON.parse(data.slice(prefix.length)), name: row.get(core + 'name'), subject: row.subject};
  }

  return {
    async list() {
      const all = await store.query({property: core + 'parent', value: table});
      if (all.length >= 500) throw new Error('This version supports fewer than 500 rows.');
      const result = [];
      for (let offset = 0; offset < all.length; offset += 100) {
        const rows = await store.getMany(all.slice(offset, offset + 100));
        result.push(...rows.map(item).filter(Boolean));
      }
      return result.sort((first, second) => first.name.localeCompare(second.name));
    },
    async save({subject, name, ...record}) {
      const props = {[core + 'name']: name, [core + 'description']: prefix + JSON.stringify(record)};
      if (!subject) {
        await store.newResource({parent: table, isA: [rowClass], propVals: props});
        return;
      }
      const row = await store.getResource(subject);
      if (!item(row)) throw new Error('That article is outside this reading list.');
      for (const [property, value] of Object.entries(props)) row.set(property, value);
      await row.save();
    },
    async remove(subject) {
      const row = await store.getResource(subject);
      if (!item(row)) throw new Error('That article is outside this reading list.');
      await row.destroy();
    }
  };
}

export async function view({root, store}) {
  const items = await library(store);
  const style = el('style', `
    main { max-width: 60rem; margin: auto; padding: 1.25rem; font: 1rem system-ui; }
    fieldset { display: grid; gap: .6rem; }
    fieldset label, fieldset input, textarea { display: block; width: 100%; box-sizing: border-box; }
    textarea { min-height: 4rem; }
    input, textarea, button { font: inherit; padding: .35rem; }
    button { margin: .2rem .4rem .2rem 0; }
    article { border-top: 1px solid #8886; margin-block: 1rem; padding-block: .5rem; }
    label input[type=checkbox] { display: inline; width: auto; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  `);
  const main = el('main');
  const editor = el('fieldset');
  editor.append(el('legend', 'Save an article'));
  const input = {};
  for (const [key, label, multiline] of fields) {
    input[key] = el(multiline ? 'textarea' : 'input');
    if (key === 'url') input[key].type = 'url';
    const wrapper = el('label', label);
    wrapper.append(input[key]);
    editor.append(wrapper);
  }
  const actions = el('div');
  const save = el('button', 'Save to reading list');
  const cancel = el('button', 'Cancel edit');
  actions.append(save, cancel);
  editor.append(actions);
  const status = el('p');
  status.setAttribute('role', 'status');
  const filterLabel = el('label', 'Find articles');
  const filter = el('input');
  filter.type = 'search';
  filterLabel.append(filter);
  const includeDone = el('input');
  includeDone.type = 'checkbox';
  const includeLabel = el('label', 'Show read articles');
  includeLabel.prepend(includeDone);
  const results = el('section');
  main.append(el('h1', 'Savr'), editor, status, filterLabel, includeLabel, results);
  root.replaceChildren(style, main);

  let all = [];
  let selected;
  let busy = false;
  
  function edit(record) {
    selected = record;
    for (const [key] of fields) {
      input[key].value = record?.[key] || '';
    }
    save.textContent = record ? 'Save article' : 'Save to reading list';
    cancel.hidden = !record;
  }

  function render() {
    results.replaceChildren();
    const query = filter.value.trim().toLocaleLowerCase();
    for (const item of all) {
      if (item.read && !includeDone.checked) continue;
      if (![item.name, item.body, item.url].join(' ').toLocaleLowerCase().includes(query)) continue;
      const card = el('article');
      card.append(el('h2', item.name));
      if (item.url) {
        const label = el('label', 'Saved URL');
        const url = el('input');
        url.value = item.url;
        url.readOnly = true;
        url.addEventListener('focus', () => url.select());
        label.append(url);
        card.append(label);
      }
      if (item.body) {
        const reading = el('details');
        reading.append(el('summary', 'Read saved text'), el('pre', item.body));
        card.append(reading);
      }
      const archive = el('button', item.read ? 'Mark unread' : 'Mark read');
      archive.addEventListener('click', () => run(async () => {
        await items.save({...item, read: !item.read});
        if (selected?.subject === item.subject) selected = {...item, read: !item.read};
      }, item.read ? 'Marked unread.' : 'Marked read.'));
      const change = el('button', 'Edit article');
      change.addEventListener('click', () => { if (!busy) edit(item); });
      const remove = el('button', 'Delete article');
      remove.addEventListener('click', () => {
        if (busy || !window.confirm('Delete ' + item.name + ' from your reading list?')) return;
        run(async () => {
          await items.remove(item.subject);
          if (selected?.subject === item.subject) edit();
        }, 'Article deleted.');
      });
      card.append(archive, change, remove);
      results.append(card);
    }
    if (!results.children.length) results.append(el('p', 'No matching articles.'));
  }

  async function run(operation, message = '') {
    if (busy) return;
    busy = editor.disabled = true;
    status.textContent = '';
    try {
      await operation();
      all = await items.list();
      render();
      status.textContent = message;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = editor.disabled = false;
    }
  }

  filter.addEventListener('input', render);
  includeDone.addEventListener('change', render);
  cancel.addEventListener('click', () => edit());
  save.addEventListener('click', () => run(async () => {
    const name = input.name.value.trim();
    if (!name) throw new Error('Enter a title.');
    const value = input.url.value.trim();
    let url = '';
    if (value) {
      const parsed = new URL(value);
      if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error('Enter an HTTP or HTTPS URL without credentials.');
      }
      url = parsed.href;
    }
    if (!url && !input.body.value.trim()) throw new Error('Paste article text or enter its URL.');
    await items.save({
      subject: selected?.subject,
      name, url,
      body: input.body.value,
      createdAt: selected?.createdAt || new Date().toISOString(),
      read: selected?.read ?? false
    });
    edit();
  }, 'Article saved.'));
  edit();
  await run(async () => {}, '');
}
