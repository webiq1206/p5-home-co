import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

// Exercise the actual navigation component with only its CSS module stubbed.
const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../components/P5EstimatorNavigation.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}}).outputText;
const exports: Record<string, any> = {};
new Function('require', 'exports', compiled)((id: string) => id.endsWith('.css') ? {default: {}} : require(id), exports);
const Navigation = exports.P5EstimatorNavigation;
const base = {brandName: 'Boise Cabinet Co', stepLabel: 'Step 1 of 3', showBack: false, frameActive: true, embedded: false, onBack() {}};
const render = (props = {}) => renderToStaticMarkup(React.createElement(Navigation, {...base, ...props}));

test('direct-entry estimator has native Home, brand-home and Exit-home links', () => {
  const html = render();
  assert.equal((html.match(/href="\/"/g) || []).length, 3);
  assert.match(html, /Back to the homepage/);
  assert.match(html, /Boise Cabinet Co, back to the homepage/);
  assert.match(html, /Exit the estimator and return to the homepage/);
});

test('later steps keep a previous-step button and independent home links', () => {
  const html = render({showBack: true});
  assert.equal((html.match(/href="\/"/g) || []).length, 2);
  assert.match(html, /<button[^>]+aria-label="Back to the previous step"/);
});

test('embedded and modal exit calls their owner without changing browser history', () => {
  for (const embedded of [true, false]) {
    let exits = 0;
    const node = Navigation({...base, embedded, onExit: () => exits++});
    const exit = node.props.children[2];
    assert.equal(exit.type, 'button');
    exit.props.onClick();
    assert.equal(exits, 1);
    assert.equal(node.props.children[1].props.href, '/');
  }
});

test('standalone exit never guesses a destination from history length', () => {
  const estimator = readFileSync(new URL('../components/P5Estimator.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(estimator, /window\.history\.(back|go|length)/);
  assert.match(estimator, /<P5EstimatorNavigation/);
});
