class ModeSwitch {
  constructor(root) {
    this.buttons = [...root.querySelectorAll(".segment-btn")];
    this.views = [...document.querySelectorAll(".canvas-view")];
    this.buttons.forEach((button) => button.addEventListener("click", () => this.set(button.dataset.mode)));
  }

  set(mode) {
    this.buttons.forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active);
    });
    this.views.forEach((view) => view.classList.toggle("active", view.dataset.view === mode));
  }
}

class Omnibar {
  constructor(form) {
    this.form = form;
    this.input = form.querySelector("input");
    form.addEventListener("submit", (event) => this.submit(event));
  }

  submit(event) {
    event.preventDefault();
    const value = this.input.value.trim();
    if (!value) return;
    this.input.value = "";
    this.input.placeholder = "Queued: " + value;
  }
}

new ModeSwitch(document.querySelector(".segment"));
new Omnibar(document.querySelector(".omnibar"));
