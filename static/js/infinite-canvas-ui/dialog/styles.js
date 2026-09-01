const DIALOG_STYLE_MARKER = 'ic-dialog-v3';


export function ensureDialogStyles() {
  if (document.querySelector(`style[data-ic-dialog-styles="${DIALOG_STYLE_MARKER}"]`)) return;

  const stylesheet = document.createElement('style');
  stylesheet.dataset.icDialogStyles = DIALOG_STYLE_MARKER;
  stylesheet.textContent = `
    :root {
      --ui-dialog-size-small: 28rem;
      --ui-dialog-size-medium: 45rem;
      --ui-dialog-size-large: 72rem;
      --ui-dialog-block-size-large: min(48rem, calc(100dvh - 6rem));
      --ui-dialog-size-x-large: 90vw;
      --ui-dialog-block-size-x-large: 92vh;
    }

    ic-dialog::part(dialog),
    ic-confirmation-dialog::part(dialog) {
      inline-size: min(calc(100dvw - (2 * var(--ui-space-4))), var(--ui-dialog-size-medium));
      max-block-size: calc(100dvh - (2 * var(--ui-space-4)));
      color: var(--ui-color-text-primary);
      background-color: var(--ui-color-surface);
      border: var(--ui-border-width-thin) solid var(--ui-color-border-secondary);
      border-radius: var(--ui-radius-m);
      box-shadow: var(--ui-shadow-modal);
    }

    ic-dialog[size="small"]::part(dialog),
    ic-confirmation-dialog::part(dialog) {
      inline-size: min(calc(100dvw - (2 * var(--ui-space-4))), var(--ui-dialog-size-small));
    }

    ic-dialog[size="small"][variant="compact"]::part(dialog) {
      inline-size: min(calc(100dvw - (2 * var(--ui-space-4))), var(--ic-dialog-compact-inline-size, 32rem));
    }

    ic-dialog[variant="compact"]::part(header) {
      padding: var(--ui-space-6) var(--ui-space-6) var(--ui-space-4);
    }

    ic-dialog[variant="compact"]::part(body) {
      min-block-size: 0;
      padding: 0 var(--ui-space-6) var(--ui-space-6);
    }

    ic-dialog[variant="compact"]:has(> [slot="footer"])::part(body) {
      padding-block-end: 0;
    }

    ic-dialog[variant="compact"]::part(footer) {
      padding: var(--ui-space-4) var(--ui-space-6) var(--ui-space-6);
      border-block-start: 0;
    }

    ic-dialog[size="large"]::part(dialog) {
      inline-size: min(calc(100dvw - (2 * var(--ui-space-4))), var(--ui-dialog-size-large));
      block-size: var(--ui-dialog-block-size-large);
      max-inline-size: none;
      max-block-size: none;
    }

    ic-dialog[size="x-large"]::part(dialog) {
      inline-size: var(--ui-dialog-size-x-large);
      block-size: var(--ui-dialog-block-size-x-large);
      max-inline-size: none;
      max-block-size: none;
    }


    ic-dialog[immersive] {
      zoom: 1;
    }

    ic-dialog[immersive]::part(dialog) {
      inset: 0;
      inline-size: 100dvw;
      block-size: 100dvh;
      max-inline-size: none;
      max-block-size: none;
      margin: 0;
    }

    ic-dialog::part(body),
    ic-confirmation-dialog::part(body) {
      overflow: auto;
      overscroll-behavior: contain;
    }

    ic-dialog[without-visible-header]::part(header) {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }

    ic-dialog::part(footer),
    ic-confirmation-dialog::part(footer) {
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: var(--ui-space-2);
    }
  `;
  document.head.append(stylesheet);
}
