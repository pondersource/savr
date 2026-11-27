const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {test} = require('node:test');

function node(tag) {
    return {
        tag, value: '', children: [], handlers: {},
        prepend(...children) { this.children.unshift(...children); },
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; },
        setAttribute() {},
        addEventListener(type, handler) { this.handlers[type] = handler; },
    };
}

function find(root, predicate) {
    if (predicate(root)) return root;
    for (const child of root.children) {
        const result = find(child, predicate);
        if (result) return result;
    }
}

test('read saved article text and keep its reading state', async () => {
    const source = readFileSync('atomic/savr-0.1.0.js', 'utf8');
    const {view} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    global.document = {createElement: node};
    const core = 'https://atomicdata.dev/properties/';
    const data = new Map();
    function resource(subject) {
        const props = {...data.get(subject)};
        return {
            subject,
            get: key => props[key],
            set: (key, value) => { props[key] = value; },
            save: async () => { data.set(subject, props); }
        };
    }
    const store = {
        getData: async () => ({table: 'inbox', rowClass: 'item'}),
        query: async () => [...data.keys()],
        getMany: async subjects => subjects.map(resource),
        getResource: async subject => resource(subject),
        newResource: async ({parent, isA, propVals}) => {
            data.set('saved', {...propVals, [core + 'parent']: parent, [core + 'isA']: isA});
        }
    };
    const root = node('div');
    await view({root, store});
    const button = text => find(root, n => n.tag === 'button' && n.textContent === text);
    const title = find(root, n => n.tag === 'label' && n.textContent === 'Title');
    const url = find(root, n => n.tag === 'label' && n.textContent === 'URL (optional)');
    const note = find(root, n => n.tag === 'label' && n.textContent === 'Article text');
    title.children[0].value = 'My note';
    url.children[0].value = '';
    note.children[0].value = 'Saved locally in my Atomic drive.';
    await button('Save to reading list').handlers.click();
    assert.ok(button('Mark read'));
    await button('Mark read').handlers.click();
    const payload = data.get('saved')[core + 'description'];
    assert.equal(JSON.parse(payload.slice('savr-article/v1:'.length)).read, true);
    await view({root, store});
    const checkbox = find(root, n => n.type === 'checkbox');
    checkbox.checked = true;
    checkbox.handlers.change();
    assert.ok(button('Mark unread'));
});
