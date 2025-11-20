const DEFAULT_BINDINGS = {
  left: ['ArrowLeft', 'a', 'A'],
  right: ['ArrowRight', 'd', 'D'],
  up: ['ArrowUp', 'w', 'W'],
  down: ['ArrowDown', 's', 'S'],
  jump: ['Space', 'w', 'W', 'ArrowUp'],
  action: ['Enter', 'e', 'E'],
};

export class InputSystem {
  constructor(bindings = DEFAULT_BINDINGS) {
    this.bindings = bindings;
    this.state = { left: false, right: false, up: false, down: false, jump: false, action: false };
    this._listener = (e, pressed) => {
      Object.entries(this.bindings).forEach(([key, codes]) => {
        if (codes.includes(e.key)) {
          this.state[key] = pressed;
        }
      });
    };
    this._keydown = (e) => this._listener(e, true);
    this._keyup = (e) => this._listener(e, false);
    window.addEventListener('keydown', this._keydown);
    window.addEventListener('keyup', this._keyup);
  }

  getState() {
    return { ...this.state };
  }

  destroy() {
    window.removeEventListener('keydown', this._keydown);
    window.removeEventListener('keyup', this._keyup);
  }
}
