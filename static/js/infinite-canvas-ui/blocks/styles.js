const BLOCK_STYLE_ID = 'infinite-canvas-ui-block-styles';

export const BLOCK_STYLES = `
  ic-smart-canvas-dock.smart-canvas-dock { --ic-icon-context-stroke-width:var(--ui-icon-stroke-width-m); --ic-smart-canvas-dock-cross-size:calc(var(--ui-control-height-s) + 2 * var(--ui-space-2)); position:fixed; left:50%; bottom:max(var(--ui-space-6), env(safe-area-inset-bottom)); z-index:60; height:var(--ic-smart-canvas-dock-cross-size); padding:var(--ui-space-2); display:flex; align-items:center; gap:var(--ui-space-2); transform:translateX(-50%); border:var(--ui-border-width-none); border-radius:var(--ui-radius-l); background:var(--ui-color-surface-floating); box-shadow:var(--ui-shadow-raised); backdrop-filter:blur(18px); overflow:visible; }
  ic-smart-canvas-dock.smart-canvas-dock[data-position="left"] { left:max(var(--ui-space-6), env(safe-area-inset-left)); top:50%; right:auto; bottom:auto; width:var(--ic-smart-canvas-dock-cross-size); height:auto; transform:translateY(-50%); flex-direction:column; }
  ic-smart-canvas-dock .smart-canvas-dock-divider[orientation="vertical"] { width:1px; height:var(--ic-smart-canvas-dock-cross-size); flex:0 0 1px; margin-block:calc(-1 * var(--ui-space-2)); margin-inline:var(--ui-space-0); }
  ic-smart-canvas-dock .smart-canvas-dock-divider[orientation="horizontal"] { width:var(--ic-smart-canvas-dock-cross-size); height:1px; flex:0 0 1px; margin-block:var(--ui-space-0); margin-inline:calc(-1 * var(--ui-space-2)); }
  ic-smart-canvas-dock .smart-canvas-dock-btn { position:relative; inset:auto; right:auto; top:auto; width:var(--ui-control-height-s); height:var(--ui-control-height-s); min-width:var(--ui-control-height-s); padding:var(--ui-space-0); display:inline-flex; align-items:center; justify-content:center; flex:0 0 var(--ui-control-height-s); border:var(--ui-border-width-none); border-radius:var(--ui-radius-xs); background:transparent; color:var(--ui-color-text-secondary); box-shadow:var(--ui-shadow-none); backdrop-filter:none; transform:none; overflow:visible; }
  ic-smart-canvas-dock .smart-canvas-dock-btn::part(base) { width:100%; min-width:0; height:100%; min-height:0; padding:var(--ui-space-0); border:var(--ui-border-width-none); border-radius:var(--ui-radius-xs); background:transparent; color:inherit; box-shadow:var(--ui-shadow-none); }
  ic-smart-canvas-dock .smart-canvas-dock-btn:hover::part(base) { background:var(--ui-color-surface-subtle); color:var(--ui-color-text-primary); }
  ic-smart-canvas-dock .smart-canvas-dock-btn:active::part(base) { transform:translateY(1px); }
  ic-smart-canvas-dock[data-position="left"] .smart-canvas-dock-btn:active::part(base) { transform:translateX(1px); }
  ic-smart-canvas-dock .smart-canvas-dock-btn[pressed]::part(base) { background:var(--ui-color-action-primary); color:var(--ui-color-text-on-action-primary); box-shadow:var(--ui-shadow-none); }
  ic-smart-canvas-dock.suppress-shortcut-hover .smart-canvas-dock-btn:not([pressed]):hover::part(base) { background:transparent; color:var(--ui-color-text-secondary); }
  ic-smart-canvas-dock[data-position="left"] .smart-annotation-options { left:calc(100% + var(--ui-space-3)); top:calc(var(--ui-space-2) + var(--ui-control-height-s) + var(--ui-space-2) + var(--ui-control-height-s) + var(--ui-space-2)); bottom:auto; transform:translateX(calc(-1 * var(--ui-space-2))); }
  ic-smart-canvas-dock[data-position="left"] .smart-annotation-options.open { transform:translateX(0); }
  ic-smart-canvas-dock[data-position="left"] .smart-canvas-settings-panel { left:calc(100% + var(--ui-space-3)); right:auto; top:auto; bottom:var(--ui-space-0); transform:translateX(calc(-1 * var(--ui-space-2))); }
  ic-smart-canvas-dock[data-position="left"] .smart-canvas-settings-panel.open { transform:translateX(0); }
  ic-smart-canvas-dock.smart-canvas-dock[data-preview-state="static"] { position:relative; inset:auto; transform:none; }

  ic-image-edit-mode-toolbar {
    position:fixed;
    z-index:9;
    top:var(--image-studio-inset,var(--ui-space-4));
    left:50%;
    width:max-content;
    max-width:calc(100% - 2 * var(--image-studio-inset,var(--ui-space-4)));
    height:auto;
    min-height:0;
    align-self:center;
    flex:0 0 auto;
    padding:0;
    border:0;
    background:transparent;
    box-shadow:none;
    pointer-events:auto;
    transform:translateX(-50%);
  }
  .image-edit-dialog.video-preview-mode ic-image-edit-mode-toolbar { display:none!important; }
  ic-image-edit-mode-toolbar::part(surface) { border-radius:10px; background:color-mix(in srgb,var(--ui-color-surface-floating) 97%,transparent); }
  ic-image-edit-mode-toolbar::part(content) {
    max-width:100%;
    flex-flow:row nowrap;
    align-items:center;
    gap:var(--ui-space-1);
    overflow-x:auto;
    overflow-y:hidden;
    scrollbar-width:none;
  }
  ic-image-edit-mode-toolbar::part(content)::-webkit-scrollbar { display:none; }
  ic-image-edit-mode-toolbar .image-edit-mode {
    width:auto;
    max-width:100%;
    --ic-tabs-item-inline-padding:var(--ui-space-2);
  }
  ic-image-edit-mode-toolbar .image-edit-mode > [data-image-edit-mode] {
    width:auto;
    height:2rem;
    min-height:2rem;
    justify-content:center;
    gap:var(--ui-space-2);
    font-size:var(--ui-font-size-2);
  }
  ic-image-edit-mode-toolbar .image-edit-mode > [data-image-edit-mode]:not([aria-selected="true"]) { color:var(--ui-color-text-secondary); }
  ic-image-edit-mode-toolbar #imageEditModeTabs > [data-image-edit-mode][aria-selected="true"] {
    background:var(--ui-color-action-primary);
    color:var(--ui-color-text-on-action-primary);
  }
  ic-image-edit-mode-toolbar #depthMapActionBtn {
    --ui-radius-m:var(--ui-radius-s);
  }
  ic-image-edit-mode-toolbar #depthMapActionBtn::part(base) {
    width:auto;
    height:2rem;
    min-height:2rem;
    padding-block:0;
    padding-inline:var(--ui-space-2);
    gap:0;
    border:0;
    border-radius:var(--ui-radius-s)!important;
    background:var(--ui-color-action-tertiary);
    color:var(--ui-color-text-secondary);
    box-shadow:none;
    font-family:inherit;
    font-size:var(--ui-density-font-size);
    font-weight:var(--ui-font-weight-regular);
    line-height:normal;
  }
  ic-image-edit-mode-toolbar #depthMapActionBtn > ic-icon[slot="start"] {
    margin-inline-end:var(--ui-space-2);
    font-size:var(--ui-density-font-size);
  }
  ic-image-edit-mode-toolbar #depthMapActionBtn:hover::part(base) { background:var(--ui-color-action-tertiary-hover); color:var(--ui-color-text-primary); }
  ic-image-edit-mode-toolbar #panoramaToggleBtn::part(base) {
    height:2rem;
    min-height:2rem;
    padding-inline:var(--ui-space-2);
    border:0;
    border-radius:var(--ui-radius-s);
    background:transparent;
    color:var(--ui-color-text-secondary);
    font-size:var(--ui-font-size-2);
    font-weight:var(--ui-font-weight-regular);
  }
  ic-image-edit-mode-toolbar #panoramaToggleBtn::part(base):hover { background:var(--ui-color-action-tertiary-hover); color:var(--ui-color-text-primary); }
  ic-image-edit-mode-toolbar #panoramaToggleBtn[pressed]::part(base) { background:var(--ui-color-action-primary); color:var(--ui-color-text-on-action-primary); }
  ic-image-edit-mode-toolbar[data-preview-state="static"] { position:relative; top:auto; left:auto; transform:none; }

  ic-smart-node-context-menu::part(surface) { box-sizing:border-box; width:14rem; max-width:calc(100vw - 20px); max-height:none; overflow:hidden; border-radius:var(--ui-radius-m); background:var(--ui-color-surface-floating); backdrop-filter:blur(20px); }
  ic-smart-node-context-menu > ic-menu-item::part(base) { min-height:calc(var(--ui-control-height-xs) + var(--ui-space-1)); padding-block:var(--ui-space-0); }
  ic-smart-node-context-menu > ic-menu-item:not([disabled])::part(base):hover { background:var(--ui-color-action-secondary-hover); }
  ic-smart-node-context-menu > ic-menu-item kbd { min-width:0; padding:var(--ui-space-0); border:var(--ui-border-width-none); background:transparent; color:var(--ui-color-text-tertiary); box-shadow:var(--ui-shadow-none); font-family:var(--ui-font-sans); font-size:var(--ui-font-size-1); font-weight:var(--ui-font-weight-bold); white-space:nowrap; }

  ic-smart-node-toolbar.smart-node-floating-menu {
    position:absolute;
    left:50%;
    top:-38px;
    z-index:var(--ui-z-raised);
    max-width:min(760px,calc(100vw - 48px));
    height:auto;
    color:var(--ui-color-text-secondary);
    white-space:nowrap;
    cursor:default;
    opacity:0;
    pointer-events:none;
    transform:translateX(-50%) translateY(3px);
    transition:opacity var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),transform var(--ui-motion-duration-fast) var(--ui-motion-ease-standard);
  }
  .image-node.selected ic-smart-node-toolbar.smart-node-floating-menu { opacity:1; pointer-events:auto; transform:translateX(-50%) translateY(0); }
  .world.smart-multi-selected ic-smart-node-toolbar.smart-node-floating-menu { opacity:0!important; pointer-events:none!important; }
  ic-smart-node-toolbar::part(surface) { border-radius:10px; box-shadow:var(--ui-shadow-raised); }
  ic-smart-node-toolbar::part(content) { gap:var(--ui-space-1); }
  ic-smart-node-toolbar > ic-button { color:var(--ui-color-text-secondary); }
  ic-smart-node-toolbar > ic-button::part(base) {
    box-sizing:border-box;
    min-height:var(--ui-control-height-xs);
    padding:var(--ui-space-0) var(--ui-space-2);
    border:var(--ui-border-width-none);
    border-radius:var(--ui-radius-s);
    background:transparent;
    color:var(--ui-color-text-secondary);
    font-size:var(--ui-font-size-2);
    line-height:var(--ui-line-height-tight);
    font-weight:var(--ui-font-weight-regular);
    transition:background var(--ui-motion-duration-fast) var(--ui-motion-ease-standard),color var(--ui-motion-duration-fast) var(--ui-motion-ease-standard);
  }
  ic-smart-node-toolbar > ic-button:hover::part(base) { background:var(--ui-color-surface-subtle); color:var(--ui-color-text-primary); }
  ic-smart-node-toolbar > ic-button:is([pressed],[aria-pressed="true"],[aria-selected="true"],.selected,.active)::part(base) { background:var(--ui-color-action-secondary-selected); color:var(--ui-color-text-primary); }
  ic-smart-node-toolbar > ic-button[disabled] { opacity:.36; }
  ic-smart-node-toolbar > ic-button[disabled]::part(base) { color:var(--ui-color-text-secondary); cursor:not-allowed; transform:none; }
  ic-smart-node-toolbar > ic-button ic-icon { --ic-icon-context-stroke-width:var(--ui-icon-stroke-width-m); color:inherit; }
  ic-smart-node-toolbar[data-preview-state="visible"] { position:relative; top:auto; left:auto; opacity:1; pointer-events:auto; transform:none; transition:none; }
  .smart-node-floating-portal ic-smart-node-toolbar.smart-node-floating-menu { position:relative; left:auto; top:auto; opacity:1; pointer-events:auto; transform:none; transition:none; }
  body.smart-node-drag ic-smart-node-toolbar.smart-node-floating-menu,
  body.smart-node-resize ic-smart-node-toolbar.smart-node-floating-menu,
  .image-node.dragging ic-smart-node-toolbar.smart-node-floating-menu { opacity:0!important; pointer-events:none!important; }
  .image-node.smart-group-member-node ic-smart-node-toolbar.smart-node-floating-menu,
  .smart-annotation-node ic-smart-node-toolbar.smart-node-floating-menu { display:none!important; }
  @media (max-width:760px) {
    ic-smart-canvas-dock.smart-canvas-dock { bottom:max(14px, env(safe-area-inset-bottom)); gap:var(--ui-space-1); padding-inline:7px; }
    ic-smart-canvas-dock.smart-canvas-dock[data-position="left"] { left:max(14px, env(safe-area-inset-left)); top:50%; right:auto; bottom:auto; padding-block:7px; }
    ic-smart-canvas-dock.smart-canvas-dock[data-preview-state="static"] { inset:auto; }
    ic-smart-node-toolbar.smart-node-floating-menu { top:-40px; overflow-x:auto; scrollbar-width:none; }
    ic-smart-node-toolbar.smart-node-floating-menu::-webkit-scrollbar { display:none; }
  }
`;

export function ensureBlockStyles() {
  if (document.getElementById(BLOCK_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = BLOCK_STYLE_ID;
  style.textContent = BLOCK_STYLES;
  document.head.append(style);
}
