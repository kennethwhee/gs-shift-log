import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve(process.argv[2] || process.cwd());
const source = fs.readFileSync(path.join(root, "maintenance/seal-pot-ois-shadow.js"), "utf8");
const start = source.indexOf("  function syncButton() {");
const end = source.indexOf('\n  document.addEventListener("click", event => {', start);
assert.ok(start >= 0 && end > start, "Seal Pot launch synchronization function exists");
const syncSource = source.slice(start, end);

function fixture({ anchor = true, manager = true } = {}) {
  let childMutations = 0;
  class Element {
    constructor(name) {
      this.name = name; this.children = []; this.parentElement = null;
      this.hidden = false; this.handlers = []; this.attributes = new Map();
    }
    set textContent(value) { this.text = value; childMutations++; }
    get previousElementSibling() {
      const siblings = this.parentElement?.children || [];
      return siblings[siblings.indexOf(this) - 1] || null;
    }
    setAttribute(name, value) { this.attributes.set(name, value); }
    addEventListener(...args) { this.handlers.push(args); }
    detach() {
      if (!this.parentElement) return;
      const siblings = this.parentElement.children;
      siblings.splice(siblings.indexOf(this), 1); this.parentElement = null;
    }
    appendChild(node) {
      node.detach(); this.children.push(node); node.parentElement = this; childMutations++;
    }
    insertAdjacentElement(position, node) {
      assert.equal(position, "afterend");
      const parent = this.parentElement; node.detach();
      parent.children.splice(parent.children.indexOf(this) + 1, 0, node);
      node.parentElement = parent; childMutations++;
    }
  }
  const parent = new Element("settings"), managerNode = new Element("manager"), anchorNode = new Element("query");
  parent.appendChild(managerNode);
  const ids = { ...(manager ? { assetManagerButton: managerNode } : {}), ...(anchor ? { blowerQueryActions: anchorNode } : {}) };
  const classes = new Set(); let currentType = "seal_pot", user = { sessionToken: "fixture" }, mobile = false, opened = 0;
  const context = vm.createContext({
    button: null,
    document: {
      body: { classList: { contains: value => classes.has(value) } },
      getElementById: id => ids[id] || null,
      createElement: name => new Element(name)
    },
    activeType: () => currentType,
    currentUser: () => user,
    isMobileMonitoring: () => mobile,
    openAnalysis: () => { opened++; }
  });
  vm.runInContext(syncSource, context);
  return { context, ids, classes, parent, managerNode, anchorNode, Element,
    sync: () => context.syncButton(), mutations: () => childMutations, opened: () => opened,
    set: { type: value => { currentType = value; }, user: value => { user = value; }, mobile: value => { mobile = value; } } };
}

test("dedicated query anchor works without the management button and preserves the click handler", () => {
  const f = fixture({ manager: false }); f.sync();
  const button = f.context.button;
  assert.equal(button.parentElement, f.anchorNode);
  assert.equal(button.text, "운영정보 조회");
  assert.match(button.title, /토출압력·베어링온도/);
  assert.doesNotMatch(button.title, /진동/);
  assert.equal(button.attributes.has("data-mobile-write"), true);
  assert.equal(button.hidden, true);
  assert.equal(button.handlers.length, 1);
  assert.equal(button.handlers[0][0], "click");
  button.handlers[0][1](); assert.equal(f.opened(), 1);
});

test("older pages retain the original placement after the management button", () => {
  const f = fixture({ anchor: false }); f.sync();
  assert.equal(f.context.button.parentElement, f.parent);
  assert.equal(f.context.button.previousElementSibling, f.managerNode);
});

test("a late query anchor moves the existing button once without registering another listener", () => {
  const f = fixture({ anchor: false }); f.sync(); const button = f.context.button;
  f.ids.blowerQueryActions = f.anchorNode;
  const before = f.mutations(); f.sync();
  assert.equal(f.context.button, button);
  assert.equal(button.parentElement, f.anchorNode);
  assert.equal(f.mutations(), before + 1);
  assert.equal(button.handlers.length, 1);
  const settled = f.mutations(); f.sync(); assert.equal(f.mutations(), settled);
});

test("one hundred MutationObserver callbacks do not keep changing the DOM", () => {
  for (const anchor of [true, false]) {
    const f = fixture({ anchor }); f.sync(); const before = f.mutations();
    for (let count = 0; count < 100; count++) f.sync();
    assert.equal(f.mutations(), before);
    assert.equal(f.context.button.handlers.length, 1);
  }
});

test("replaced query container receives the existing button without duplication", () => {
  const f = fixture(); f.sync(); const button = f.context.button;
  const replacement = new f.Element("replacement query");
  f.ids.blowerQueryActions = replacement; f.sync();
  assert.equal(button.parentElement, replacement);
  assert.equal(f.anchorNode.children.length, 0);
  assert.equal(replacement.children.length, 1);
});

test("mobile, anonymous, public with stale local user, and other tabs cannot expose launch", () => {
  const f = fixture(); f.sync();
  f.set.mobile(true); f.sync(); assert.equal(f.context.button.hidden, true);
  f.set.mobile(false); f.set.user(null); f.sync(); assert.equal(f.context.button.hidden, true);
  f.set.user({ sessionToken: "stale-local-user" }); f.classes.add("public-monitoring");
  f.sync(); assert.equal(f.context.button.hidden, true);
  assert.equal(f.context.button.attributes.has("data-mobile-write"), true);
  f.classes.delete("public-monitoring"); f.set.type("fbhe"); f.sync();
  assert.equal(f.context.button.hidden, true);
  f.set.type("seal_pot"); f.sync(); assert.equal(f.context.button.hidden, true);
});

test("missing anchors produce no detached launch control", () => {
  const f = fixture({ anchor: false, manager: false }); const before = f.mutations();
  f.sync(); assert.equal(f.context.button, null); assert.equal(f.mutations(), before);
});
