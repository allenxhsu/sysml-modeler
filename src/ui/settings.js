// Settings: appearance (shared with every toolkit app) and Sync.
//
// The model itself is the unit that travels (see state/sync.js), so Sync is a
// server, a token, a switch and an honest status line — or, on the Portal,
// none of those, because the session cookie already says where and as whom.

import { el } from '../util.js';
import { openDialog, foot, button } from './dialog.js';
import { getSettings, applySettings, syncNow, syncStatus, deviceId, inPortal, modelDocId, listSyncedModels, openSyncedModel, WORKSPACE } from '../state/sync.js';
import { store } from '../state/store.js';
import { confirmDialog } from './dialog.js';
import { publishStatus } from '../../sync-kit/js/index.js';

const PLACEHOLDER = `http://127.0.0.1:8080/w/${WORKSPACE}`;

export function settingsDialog() {
  return openDialog('Settings', (close) => {
    const current = getSettings();
    const readout = el('sc-sync-status');
    const parts = [
      el('div', { class: 'sc-section-title', text: 'Appearance' }),
      el('sc-theme-picker'),
      el('div', { class: 'sc-section-title', text: 'Sync' }),
    ];
    let save = async () => {};
    if (inPortal()) {
      parts.push(
        el('p', { class: 'sc-muted small', text: 'Signed in via the toolkit. This model syncs with your account’s workspace on this site; nothing to paste.' }),
        readout);
    } else {
      const url = el('input', { class: 'sc-input', type: 'text', value: current.url, placeholder: PLACEHOLDER, spellcheck: false });
      const token = el('input', { class: 'sc-input', type: 'password', value: current.token, placeholder: 'The workspace secret', spellcheck: false });
      const enabled = el('input', { class: 'sc-check', type: 'checkbox', checked: current.enabled });
      for (const input of [url, token]) input.addEventListener('keydown', (e) => e.stopPropagation());
      save = () => applySettings({ url: url.value, token: token.value, enabled: enabled.checked });
      parts.push(
        el('p', { class: 'sc-muted small', text: 'One model is one record. Point every device at the same server and workspace, and whichever saved last wins — unless this model has unsaved changes, in which case you are asked.' }),
        el('label', { class: 'sc-field' }, el('span', { class: 'sc-label', text: 'Server URL' }), url,
          el('span', { class: 'sc-faint field-hint', text: `The server’s origin, or the workspace URL ending in /w/${WORKSPACE}. On a paired Mac the shell fills this in.` })),
        el('label', { class: 'sc-field' }, el('span', { class: 'sc-label', text: 'Token' }), token,
          el('span', { class: 'sc-faint field-hint', text: 'The device token. A loopback server on this machine may not need one.' })),
        el('label', { class: 'check-row' }, enabled, el('span', { text: 'Sync automatically (every 30 seconds, when the window is focused, and after each save)' })),
        readout);
    }
    // The shelf: every model this workspace holds, so a second device can open what the first one made.
    const shelf = el('div', { class: 'shelf' });
    listSyncedModels().then((models) => {
      if (!models.length) { shelf.append(el('p', { class: 'empty', text: 'No models have synced yet.' })); return; }
      for (const m of models) {
        shelf.append(el('div', { class: 'rel' },
          el('button', { class: `link${m.open ? ' is-open' : ''}`, text: m.name || '(unnamed)', onclick: async () => {
            if (m.open) return;
            if (store.ui.dirty && !(await confirmDialog('Open another model?', 'This model has changes you have not saved to a file. They stay on this device’s shelf, but the window will show the other model.', 'Open'))) return;
            if (await openSyncedModel(m.id)) close(null);
          } }),
          el('span', { class: 'sc-faint sc-mono', text: `${new Date(m.updatedAt).toLocaleString()}${m.open ? ' · open' : ''}` })));
      }
    });
    parts.push(el('div', { class: 'sc-section-title', text: 'Models on the shelf' }), shelf);
    parts.push(
      el('div', { class: 'sc-faint field-hint', text: `This device is ${deviceId()} · model ${modelDocId()}` }),
      foot(
        button('Sync now', async () => { await save(); await syncNow(); }),
        ...(inPortal() ? [] : [button('Save', save, 'sc-button--primary')]),
        button('Close', () => close(null))));
    // A readout mounted after the last status event starts from it.
    setTimeout(() => publishStatus(syncStatus()), 0);
    return parts;
  });
}
