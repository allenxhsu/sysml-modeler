// Modal dialogs and pop-up menus, built on the kit's sc-overlay / sc-dialog / sc-menu.

import { el } from '../util.js';

let openCount = 0;
export const modalOpen = () => openCount > 0;

/** `build(close)` returns the dialog body; the promise resolves with whatever `close` is given. */
export function openDialog(title, build, { dismissable = true } = {}) {
  return new Promise((resolve) => {
    const close = (value) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      openCount--;
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape' && dismissable) { e.stopPropagation(); close(null); } };
    const overlay = el('div', { class: 'sc-overlay', onpointerdown: (e) => { if (e.target === overlay && dismissable) close(null); } },
      el('div', { class: 'sc-dialog sc-brackets', role: 'dialog', 'aria-label': title },
        el('div', { class: 'sc-dialog-head' }, el('span', { class: 'sc-display', text: title })),
        el('div', { class: 'sc-dialog-body' }, build(close))));
    openCount++;
    document.addEventListener('keydown', onKey, true);
    document.getElementById('modal-root').append(overlay);
    setTimeout(() => (overlay.querySelector('[data-autofocus]') || overlay.querySelector('input,select,textarea,button'))?.focus(), 0);
  });
}

export const foot = (...buttons) => el('div', { class: 'dialog-foot' }, ...buttons);
export const button = (text, onclick, variant = '') => el('button', { class: `sc-button ${variant}`, text, onclick });

export function confirmDialog(title, body, okLabel = 'Delete') {
  return openDialog(title, (close) => [
    el('p', { text: body }),
    foot(el('button', { class: 'sc-button', text: 'Cancel', 'data-autofocus': '', onclick: () => close(false) }), button(okLabel, () => close(true), 'sc-button--danger')),
  ]);
}

export function promptText(title, body, value = '') {
  return openDialog(title, (close) => {
    const input = el('input', { class: 'sc-input', type: 'text', value, 'data-autofocus': '' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') close(input.value); });
    setTimeout(() => input.select(), 0);
    return [el('p', { text: body }), input, foot(button('Cancel', () => close(null)), button('OK', () => close(input.value), 'sc-button--primary'))];
  });
}

export function showText(title, text) {
  return openDialog(title, (close) => [el('pre', { class: 'dialog-pre', text }), foot(el('button', { class: 'sc-button', text: 'Close', 'data-autofocus': '', onclick: () => close(null) }))]);
}

/**
 * Choose one of `options` ([{ value, label }]) or type a new name.
 * Resolves { value } for an existing choice, { create: name } for a new one, null when cancelled.
 */
export function pickOrCreate(title, body, options, createLabel) {
  return openDialog(title, (close) => {
    const select = el('select', { class: 'sc-select', 'data-autofocus': '' },
      ...options.map((o) => el('option', { value: o.value, text: o.label })),
      el('option', { value: '', text: `＋ ${createLabel}…` }));
    const input = el('input', { class: 'sc-input', type: 'text', placeholder: 'Name' });
    const sync = () => { input.hidden = select.value !== ''; if (!input.hidden) input.focus(); };
    select.addEventListener('change', sync);
    const ok = () => {
      if (select.value) close({ value: select.value });
      else if (input.value.trim()) close({ create: input.value.trim() });
      else input.focus();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    input.hidden = options.length > 0;
    if (!options.length) select.value = '';
    return [el('p', { text: body }), select, input, foot(button('Cancel', () => close(null)), button('OK', ok, 'sc-button--primary'))];
  });
}

/** A form of selects. `fields`: [{ key, label, options: [{value,label}], value }]. Resolves { key: value } or null. */
export function formDialog(title, fields, okLabel = 'Create') {
  return openDialog(title, (close) => {
    const inputs = {};
    const rows = fields.map((f) => {
      const input = f.options
        ? el('select', { class: 'sc-select' }, ...f.options.map((o) => el('option', { value: o.value, text: o.label, selected: o.value === f.value })))
        : el('input', { class: 'sc-input', type: 'text', value: f.value || '' });
      inputs[f.key] = input;
      return el('label', { class: 'sc-field' }, el('span', { class: 'sc-label', text: f.label }), input);
    });
    const ok = () => close(Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value])));
    return [...rows, foot(button('Cancel', () => close(null)), button(okLabel, ok, 'sc-button--primary'))];
  });
}

// ---------------------------------------------------------------- menus

let openMenu = null;
export function closeMenu() { openMenu?.remove(); openMenu = null; }

/**
 * Pop a menu at a screen position. `items`: [{ label, run, danger?, disabled?, note? } | '-'].
 */
export function showMenu(x, y, items) {
  closeMenu();
  const menu = el('div', { class: 'sc-menu pop-menu' }, ...items.map((it) => {
    if (it === '-') return el('div', { class: 'sc-menu-sep' });
    if (it.note) return el('div', { class: 'menu-note', text: it.note });
    return el('button', {
      class: `sc-menu-item${it.danger ? ' is-danger' : ''}`, disabled: !!it.disabled,
      onclick: () => { closeMenu(); it.run(); },
    }, el('span', { text: it.label }), it.key ? el('span', { class: 'sc-kbd', text: it.key }) : null);
  }));
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
  openMenu = menu;
}
document.addEventListener('pointerdown', (e) => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
