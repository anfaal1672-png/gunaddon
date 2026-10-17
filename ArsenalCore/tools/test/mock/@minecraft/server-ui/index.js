// テスト用の @minecraft/server-ui モック：フォームは内容を記録し、あらかじめ指定した回答を返す
export const FormCancelationReason = { UserBusy: "UserBusy", UserClosed: "UserClosed" };
export const UI_LOG = { forms: [], answers: [] };

class Base {
  constructor() { this.items = []; this.kind = this.constructor.name; }
  title(t) { this._title = t; return this; }
  body(b) { this._body = b; return this; }
  button(t, icon) { this.items.push({ type: "button", t, icon }); return this; }
  button1(t) { this.items.push({ type: "b1", t }); return this; }
  button2(t) { this.items.push({ type: "b2", t }); return this; }
  dropdown(l, opts, o) { this.items.push({ type: "dropdown", l, opts, o }); return this; }
  toggle(l, o) { this.items.push({ type: "toggle", l, o }); return this; }
  slider(l, a, b, o) { this.items.push({ type: "slider", l, a, b, o }); return this; }
  textField(l, p, o) { this.items.push({ type: "text", l, p, o }); return this; }
  submitButton(t) { return this; }
  label(t) { return this; }
  header(t) { return this; }
  divider() { return this; }
  async show() {
    UI_LOG.forms.push(this);
    const a = UI_LOG.answers.shift();
    if (a === undefined) return { canceled: true, cancelationReason: FormCancelationReason.UserClosed };
    return a;
  }
}
export class ActionFormData extends Base {}
export class ModalFormData extends Base {}
export class MessageFormData extends Base {}
