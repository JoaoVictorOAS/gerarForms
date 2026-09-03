import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  injectRecordIntoDom,
  findMatchingElements,
  injectElementValue,
  dispatchInputEvents,
} from '../../src/content/filler';

describe('DOM Form Filler (Milestone 5)', () => {
  let dom: JSDOM;
  let document: Document;

  beforeEach(() => {
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <form id="test-form">
            <input type="text" id="nome" name="nome" data-formgen-id="fg_0" />
            <input type="email" id="email" name="email" data-formgen-id="fg_1" />
            <input type="number" id="idade" name="idade" data-formgen-id="fg_2" />
            <select id="estado" name="estado" data-formgen-id="fg_3">
              <option value="">Selecione</option>
              <option value="SP">São Paulo</option>
              <option value="RJ">Rio de Janeiro</option>
              <option value="MG">Minas Gerais</option>
            </select>
            <input type="checkbox" id="aceito" name="aceito" value="sim" data-formgen-id="fg_4" />
            <input type="radio" name="genero" value="M" id="gen_m" />
            <input type="radio" name="genero" value="F" id="gen_f" />
            <textarea id="observacoes" name="observacoes" data-formgen-id="fg_5"></textarea>
          </form>
        </body>
      </html>
    `, { url: 'http://localhost/test' });
    document = dom.window.document;
  });

  it('injects text, email, and number inputs with synthetic events', () => {
    let inputFired = 0;
    let changeFired = 0;
    const nomeInput = document.getElementById('nome') as HTMLInputElement;

    nomeInput.addEventListener('input', () => { inputFired++; });
    nomeInput.addEventListener('change', () => { changeFired++; });

    const result = injectRecordIntoDom({
      nome: 'João Silva',
      email: 'joao@example.com',
      idade: 30,
    }, 'test-form', document);

    expect(result.success).toBe(true);
    expect(result.injectedFields).toContain('nome');
    expect(result.injectedFields).toContain('email');
    expect(result.injectedFields).toContain('idade');

    expect(nomeInput.value).toBe('João Silva');
    expect((document.getElementById('email') as HTMLInputElement).value).toBe('joao@example.com');
    expect((document.getElementById('idade') as HTMLInputElement).value).toBe('30');

    expect(inputFired).toBeGreaterThanOrEqual(1);
    expect(changeFired).toBeGreaterThanOrEqual(1);
  });

  it('selects option in select element by value or text', () => {
    const select = document.getElementById('estado') as HTMLSelectElement;

    const res1 = injectRecordIntoDom({ estado: 'RJ' }, 'test-form', document);
    expect(res1.success).toBe(true);
    expect(select.value).toBe('RJ');

    const res2 = injectRecordIntoDom({ estado: 'Minas Gerais' }, 'test-form', document);
    expect(res2.success).toBe(true);
    expect(select.value).toBe('MG');
  });

  it('handles checkbox and radio buttons', () => {
    const checkbox = document.getElementById('aceito') as HTMLInputElement;
    const radioF = document.getElementById('gen_f') as HTMLInputElement;
    const radioM = document.getElementById('gen_m') as HTMLInputElement;

    const res = injectRecordIntoDom({
      aceito: true,
      genero: 'F',
    }, 'test-form', document);

    expect(res.success).toBe(true);
    expect(checkbox.checked).toBe(true);
    expect(radioF.checked).toBe(true);
    expect(radioM.checked).toBe(false);
  });

  it('injects into textarea element', () => {
    const textarea = document.getElementById('observacoes') as HTMLTextAreaElement;

    const res = injectRecordIntoDom({
      observacoes: 'Linha 1\nLinha 2',
    }, 'test-form', document);

    expect(res.success).toBe(true);
    expect(textarea.value).toBe('Linha 1\nLinha 2');
  });

  it('matches by data-formgen-id', () => {
    const res = injectRecordIntoDom({
      fg_0: 'Nome via FormGen ID',
    }, 'test-form', document);

    expect(res.success).toBe(true);
    expect((document.getElementById('nome') as HTMLInputElement).value).toBe('Nome via FormGen ID');
  });

  it('reports skipped fields for unknown keys', () => {
    const res = injectRecordIntoDom({
      campo_inexistente: 'Valor',
    }, 'test-form', document);

    expect(res.success).toBe(false);
    expect(res.skippedFields).toContain('campo_inexistente');
  });

  it('accepts a direct HTMLElement as target without throwing startsWith error', () => {
    const formEl = document.getElementById('test-form') as HTMLElement;
    expect(formEl).toBeDefined();

    // Passing HTMLElement directly as target
    const res = injectRecordIntoDom({
      nome: 'Carlos Eduardo',
      email: 'carlos@example.com',
    }, formEl, document);

    expect(res.success).toBe(true);
    expect((document.getElementById('nome') as HTMLInputElement).value).toBe('Carlos Eduardo');
    expect((document.getElementById('email') as HTMLInputElement).value).toBe('carlos@example.com');
  });

  it('handles forms with an input named "id" without crashing from form.id shadowing', () => {
    const customDom = new JSDOM(`
      <form id="shadow-form">
        <input type="text" name="id" value="123" />
        <input type="text" name="username" />
      </form>
    `);
    const customDoc = customDom.window.document;
    const form = customDoc.getElementById('shadow-form') as HTMLFormElement;

    // Passing form directly or an element as target must never throw startsWith error
    const res = injectRecordIntoDom({
      username: 'johndoe',
    }, form, customDoc);

    expect(res.success).toBe(true);
    expect((customDoc.querySelector('[name="username"]') as HTMLInputElement).value).toBe('johndoe');

    // Also test passing an input element directly as target
    const inputEl = customDoc.querySelector('[name="id"]') as HTMLElement;
    const resEl = injectRecordIntoDom({
      username: 'janedoe',
    }, inputEl, customDoc);
    expect(resEl.success).toBe(true);
    expect((customDoc.querySelector('[name="username"]') as HTMLInputElement).value).toBe('janedoe');
  });

  it('gracefully handles non-string or invalid target parameters without throwing', () => {
    // Number target
    const resNum = injectRecordIntoDom({ nome: 'Teste' }, 123 as any, document);
    expect(resNum.success).toBe(true);

    // Object target (not an HTMLElement)
    const resObj = injectRecordIntoDom({ nome: 'Teste 2' }, { invalid: true } as any, document);
    expect(resObj.success).toBe(true);

    // Malformed CSS selector
    const resBadSel = injectRecordIntoDom({ nome: 'Teste 3' }, '###invalid selector[[[', document);
    expect(resBadSel.success).toBe(true);
  });
});
