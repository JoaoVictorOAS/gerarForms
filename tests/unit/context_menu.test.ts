import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  handleContentMessage,
  setLastRightClickedElement,
  showPageToast,
} from '../../src/content/index';
import {
  setupContextMenus,
  handleContextMenuClick,
} from '../../src/background/index';

describe('Context Menu & Right-Click Target Integration', () => {
  let dom: JSDOM;
  let document: Document;

  beforeEach(() => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <form id="contact-form">
            <input type="text" id="name" name="name" />
            <input type="email" id="email" name="email" />
          </form>
          <form id="billing-form">
            <input type="text" id="card" name="card" />
          </form>
        </body>
      </html>
    `, { url: 'http://localhost/form' });
    document = dom.window.document;
  });

  describe('Content Script Right-Click Context Resolution', () => {
    it('targets the enclosing form when scan is invoked with fromContextMenu: true', async () => {
      const emailInput = document.getElementById('email') as HTMLInputElement;
      setLastRightClickedElement(emailInput);

      const res = await handleContentMessage(
        {
          action: 'SCAN_DOM',
          fromContextMenu: true,
        },
        undefined,
        document
      );

      expect(res.success).toBe(true);
      if ('schema' in res && res.schema) {
        expect(res.schema.formId).toBe('contact-form');
        expect(res.schema.fields.some((f) => f.id === 'email')).toBe(true);
        expect(res.schema.fields.some((f) => f.id === 'card')).toBe(false);
      }
    });

    it('injects record directly into the right-clicked form when fromContextMenu: true', async () => {
      const cardInput = document.getElementById('card') as HTMLInputElement;
      setLastRightClickedElement(cardInput);

      const res = await handleContentMessage(
        {
          action: 'INJECT_RECORD',
          record: { card: '4111-2222-3333-4444' },
          fromContextMenu: true,
        },
        undefined,
        document
      );

      expect(res.success).toBe(true);
      expect(cardInput.value).toBe('4111-2222-3333-4444');
    });

    it('renders a floating toast notification via SHOW_TOAST action', async () => {
      const res = await handleContentMessage(
        {
          action: 'SHOW_TOAST',
          message: 'Registro preenchido com sucesso!',
          type: 'success',
        },
        undefined,
        document
      );

      expect(res.success).toBe(true);
      const toast = document.getElementById('formgen-toast-notification');
      expect(toast).not.toBeNull();
      expect(toast?.textContent).toContain('Registro preenchido com sucesso!');
    });
  });

  describe('Background Context Menu Setup', () => {
    it('registers the FormGen root menu and submenus in chrome.contextMenus', () => {
      const createdMenus: chrome.contextMenus.CreateProperties[] = [];

      (globalThis as any).chrome = {
        contextMenus: {
          removeAll: vi.fn((cb) => {
            if (cb) cb();
          }),
          create: vi.fn((props) => {
            createdMenus.push(props);
          }),
        },
      };

      setupContextMenus();

      expect(chrome.contextMenus.removeAll).toHaveBeenCalled();
      const menuIds = createdMenus.map((m) => m.id);

      expect(menuIds).toContain('formgen_root');
      expect(menuIds).toContain('formgen_create_menu');
      expect(menuIds).toContain('formgen_create_1');
      expect(menuIds).toContain('formgen_create_10');
      expect(menuIds).toContain('formgen_create_100');
      expect(menuIds).toContain('formgen_inject_next');
      expect(menuIds).toContain('formgen_discard_queue');
    });
  });
});
