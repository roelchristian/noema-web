import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SidebarOrganization } from '../src/client/organization/SidebarOrganization.tsx';
import { OrganizationLibrary } from '../src/client/organization/OrganizationLibrary.tsx';

const data = {
  collections: [],
  folders: [{id: 'desk', name: 'Desk', parent_id: null}, {id: 'child', name: 'Subfolder', parent_id: 'desk'}],
  locations: [{kind: 'page', item_id: 'filed', folder_id: 'desk'}], memberships: [],
  favourites: [{kind: 'folder', item_id: 'child'}, {kind: 'page', item_id: 'draft'}],
};
const noop = () => {};
const render = (props = {}) => renderToStaticMarkup(createElement(OrganizationLibrary, {
  data, vaultId: 'default', pages: [{id: 'draft', title: 'Draft', updated_at: '2026-10-17'}, {id: 'filed', title: 'Filed', updated_at: '2026-10-17'}],
  entities: [], favouritesOnly: false, context: {collection: '', folder: ''},
  onContextChange: noop, onChanged: noop, onOpenPage: noop, onOpenEntity: noop, onOpenFolder: noop,
  onRenamePage: noop, onDeletePage: noop, onNewNote: noop, onError: noop, ...props,
}));

test('Library places folders and notes in the same table and keeps page selection scoped to notes', () => {
  const html = render();
  assert.match(html, /<h1>Library<\/h1>/);
  const table = html.slice(html.indexOf('class="organization-items'));
  assert.match(table, /Desk/);
  assert.match(table, /Draft/);
  assert.doesNotMatch(table, /Filed/);
  assert.ok(table.indexOf('Desk') < table.indexOf('Draft'));
  assert.doesNotMatch(html, /organization-folder-grid/);
  assert.doesNotMatch(html, /Subfolder/);
  assert.match(table, /aria-label="Favourite: Desk"/);
  assert.doesNotMatch(table, /aria-label="Select Desk"/);
});

test('folder browsing and Favourites include the right folder rows', () => {
  const folder = render({context: {collection: '', folder: 'desk'}});
  assert.match(folder, /Subfolder/);
  assert.match(folder, /Filed/);
  assert.doesNotMatch(folder, /Draft/);
  const favourites = render({favouritesOnly: true});
  assert.match(favourites, /Subfolder/);
  assert.match(favourites, /Draft/);
  assert.doesNotMatch(favourites, />Desk</);
  assert.doesNotMatch(favourites, /Filed/);
  assert.match(favourites, /aria-label="Remove favourite: Subfolder"/);
  const inbox = render({inboxOnly: true});
  assert.match(inbox, /Draft/);
  assert.doesNotMatch(inbox, /Subfolder|>Desk<|Filed/);
});


test('Library and sidebar folder rows are draggable while collections remain curated drop targets', () => {
  const html = render();
  const row = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
  assert.match(row, /draggable="true"/);
  assert.match(row, /Desk/);
  const sidebar = renderToStaticMarkup(createElement(SidebarOrganization, {
    data: {...data, collections: [{id: 'theme', name: 'Theme'}]}, vaultId: 'default', pages: [],
    context: {collection: '', folder: ''}, active: true, disabled: false,
    onOpen: noop, onOpenPage: noop, onMovePage: noop, onChanged: noop, onError: noop,
  }));
  assert.match(sidebar, /draggable="true"[^>]*>[\s\S]*?Open folder: Desk/);
  assert.match(sidebar, /draggable="false"[^>]*>[\s\S]*?Open collection: Theme/);
});
