import { IcButton, IcButtonGroup, IcIconButton, IcVideoPlayButton } from './actions.js?v=asset-da9cdfb560fb';
import { IcConfirmationDialog, IcDialog } from './dialog.js?v=asset-85d552251014';
import { IcAiProcessorDialog } from './ai-processor-dialog.js?v=asset-ad3eb1a27570';
import { IcIcon, loadLucide } from './icon.js?v=asset-9392c478ebb0';
import { IcCheckbox, IcColorField, IcNumberInput, IcRadio, IcRadioGroup, IcSelect, IcSlider, IcSwitch } from './selection-adjustment.js?v=asset-73a9a20cbe8f';
import { IcFormField, IcInput, IcTextarea } from './text-entry.js?v=asset-1f07f840d089';
import { IcAlert, IcBadge, IcEmptyState, IcLoading, IcProgress, IcSkeleton, IcToast } from './feedback-progress.js?v=asset-22aaa6b66aec';
import { IcMenu, IcMenuItem, IcPopover, IcTooltip } from './menu-popover.js?v=asset-db929ea5acca';
import { IcConfirmPopover } from './confirm-popover.js?v=asset-9ba5cc618ff9';
import { IcMentionPicker } from './mention-picker.js?v=asset-49e806f064f3';
import { IcBreadcrumb, IcFloatingToolbar, IcNavDisclosure, IcNavItem, IcPagination, IcSegmentedControl, IcSteps, IcTabs, IcToolbar } from './navigation-command.js?v=asset-8d7f89e16c9d';
import { IcCard, IcDivider, IcList, IcMediaContainer, IcTable } from './containers-data.js?v=asset-37c3b467193e';
import { IcCanvasGrid } from './canvas-grid.js?v=asset-e5cf6825fccf';
import { IcSmartMinimap } from './canvas-navigation.js?v=asset-92341c33c4cc';
import { IcFileInput, IcImageFrame, IcMediaPlayerControls, IcMediaSlot, IcReferenceThumbnail, IcThumbHovercard, IcUploadSurface } from './file-media-input.js?v=asset-52f0eeec6878';
import { IcHeading } from './heading.js?v=asset-8d66d5ff5aee';
import { IcAspectRatioPicker, PROJECT_ASPECT_RATIO_PRESETS } from './aspect-ratio-picker.js?v=asset-9ced9971bd80';
import { IcGenerationSettingsPicker } from './generation-settings-picker.js?v=asset-3601f63a0e55';
import { IcGenerationPending } from './generation-pending.js?v=asset-db751b27edca';
import { IcGenerationRecovery } from './generation-recovery.js?v=asset-76ec9018f728';
import { IcPromptComposer } from './prompt-composer.js?v=asset-a479acc27053';
import { IcPromptTemplateLibrary } from './prompt-template-library.js?v=asset-0d8f1aff36de';
import { IcImageEditModeToolbar, IcSmartCanvasDock, IcSmartNodeContextMenu, IcSmartNodeToolbar } from './blocks.js?v=asset-7a1e26b083da';
import { CANVAS_NODE_KINDS, IcCanvasMultiSelection, IcCanvasNode, IcPromptNodeFocusSurface, renderCanvasNodeMarkup, renderReadOnlyPromptNodeBodyMarkup } from './nodes.js?v=asset-4cfa4e582618';
import { IcWorkspaceAssetLibrary } from './workspace-asset-library.js?v=asset-caabf13d2a21';
import { ensureThemeAdapterStyles } from './theme-adapter.js?v=asset-91786900b295';
import { ensureScrollbarStyles, INFINITE_CANVAS_UI_SCROLLBAR, refreshScrollbarStyles } from './scrollbar.js?v=asset-8d85878aaeb6';
import { installFocusPolicy } from './focus-policy.js?v=asset-383b6358e45a';
import { installOverlayScopePolicy } from './overlay-layer.js?v=asset-93234911c8e7';


const ENGINE_VERSION = '3.10.0';
const ENGINE_ROOT = new URL(
  `../../vendor/webawesome/${ENGINE_VERSION}/package/dist-cdn/`,
  import.meta.url,
);

export const INFINITE_CANVAS_UI_ENGINE = Object.freeze({
  name: '@awesome.me/webawesome',
  version: ENGINE_VERSION,
  distribution: 'dist-cdn',
});

function ensureEngineStyles() {
  const marker = `webawesome-${ENGINE_VERSION}`;
  if (document.querySelector(`link[data-ic-ui-engine="${marker}"]`)) return;

  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('../../css/webawesome-engine.css?v=asset-19b440cccf6a', import.meta.url).href;
  stylesheet.dataset.icUiEngine = marker;
  document.head.append(stylesheet);
}

function define(name, constructor) {
  const existing = customElements.get(name);
  if (existing && existing !== constructor) {
    throw new Error(`${name} is already registered with another implementation`);
  }
  if (!existing) customElements.define(name, constructor);
}

ensureEngineStyles();
ensureScrollbarStyles();
ensureThemeAdapterStyles();
installFocusPolicy();
installOverlayScopePolicy();
await loadLucide();
IcButton.engine = INFINITE_CANVAS_UI_ENGINE;
IcButtonGroup.engine = INFINITE_CANVAS_UI_ENGINE;
IcIconButton.engine = INFINITE_CANVAS_UI_ENGINE;
IcInput.engine = INFINITE_CANVAS_UI_ENGINE;
IcTextarea.engine = INFINITE_CANVAS_UI_ENGINE;
IcCheckbox.engine = INFINITE_CANVAS_UI_ENGINE;
IcColorField.engine = INFINITE_CANVAS_UI_ENGINE;
IcNumberInput.engine = INFINITE_CANVAS_UI_ENGINE;
IcRadio.engine = INFINITE_CANVAS_UI_ENGINE;
IcRadioGroup.engine = INFINITE_CANVAS_UI_ENGINE;
IcSelect.engine = INFINITE_CANVAS_UI_ENGINE;
IcSlider.engine = INFINITE_CANVAS_UI_ENGINE;
IcSwitch.engine = INFINITE_CANVAS_UI_ENGINE;
IcDialog.engine = INFINITE_CANVAS_UI_ENGINE;
IcConfirmationDialog.engine = INFINITE_CANVAS_UI_ENGINE;
IcAiProcessorDialog.engine = INFINITE_CANVAS_UI_ENGINE;
define('ic-button', IcButton);
define('ic-input', IcInput);
define('ic-textarea', IcTextarea);
define('ic-form-field', IcFormField);
define('ic-checkbox', IcCheckbox);
define('ic-color-field', IcColorField);
define('ic-number-input', IcNumberInput);
define('ic-radio-group', IcRadioGroup);
define('ic-radio', IcRadio);
define('ic-select', IcSelect);
define('ic-slider', IcSlider);
define('ic-switch', IcSwitch);
define('ic-dialog', IcDialog);
define('ic-confirmation-dialog', IcConfirmationDialog);
define('ic-ai-processor-dialog', IcAiProcessorDialog);
define('ic-icon', IcIcon);
define('ic-icon-button', IcIconButton);
define('ic-button-group', IcButtonGroup);
define('ic-alert', IcAlert);
define('ic-badge', IcBadge);
define('ic-toast', IcToast);
define('ic-loading', IcLoading);
define('ic-progress', IcProgress);
define('ic-skeleton', IcSkeleton);
define('ic-empty-state', IcEmptyState);
define('ic-menu', IcMenu);
define('ic-menu-item', IcMenuItem);
define('ic-popover', IcPopover);
define('ic-confirm-popover', IcConfirmPopover);
define('ic-tooltip', IcTooltip);
define('ic-mention-picker', IcMentionPicker);
define('ic-tabs', IcTabs);
define('ic-segmented-control', IcSegmentedControl);
define('ic-toolbar', IcToolbar);
define('ic-floating-toolbar', IcFloatingToolbar);
define('ic-nav-item', IcNavItem);
define('ic-nav-disclosure', IcNavDisclosure);
define('ic-breadcrumb', IcBreadcrumb);
define('ic-pagination', IcPagination);
define('ic-steps', IcSteps);
define('ic-card', IcCard);
define('ic-canvas-grid', IcCanvasGrid);
define('ic-smart-minimap', IcSmartMinimap);
define('ic-divider', IcDivider);
define('ic-list', IcList);
define('ic-table', IcTable);
define('ic-media-container', IcMediaContainer);
define('ic-file-input', IcFileInput);
define('ic-upload-surface', IcUploadSurface);
define('ic-media-player-controls', IcMediaPlayerControls);
define('ic-image-frame', IcImageFrame);
define('ic-media-slot', IcMediaSlot);
define('ic-thumb-hovercard', IcThumbHovercard);
define('ic-reference-thumbnail', IcReferenceThumbnail);
define('ic-heading', IcHeading);
define('ic-aspect-ratio-picker', IcAspectRatioPicker);
define('ic-generation-settings-picker', IcGenerationSettingsPicker);
define('ic-generation-pending', IcGenerationPending);
define('ic-generation-recovery', IcGenerationRecovery);
define('ic-prompt-composer', IcPromptComposer);
define('ic-prompt-template-library', IcPromptTemplateLibrary);
define('ic-image-edit-mode-toolbar', IcImageEditModeToolbar);
define('ic-smart-canvas-dock', IcSmartCanvasDock);
define('ic-smart-node-context-menu', IcSmartNodeContextMenu);
define('ic-smart-node-toolbar', IcSmartNodeToolbar);
define('ic-canvas-node', IcCanvasNode);
define('ic-canvas-multi-selection', IcCanvasMultiSelection);
define('ic-prompt-node-focus-surface', IcPromptNodeFocusSurface);
define('ic-video-play-button', IcVideoPlayButton);
define('ic-workspace-asset-library', IcWorkspaceAssetLibrary);
refreshScrollbarStyles();

globalThis.InfiniteCanvasUiNodeComponents = Object.freeze({
  kinds: CANVAS_NODE_KINDS,
  render: renderCanvasNodeMarkup,
  renderReadOnlyPromptBody: renderReadOnlyPromptNodeBodyMarkup,
});

export { CANVAS_NODE_KINDS, IcAiProcessorDialog, IcAlert, IcAspectRatioPicker, IcBadge, IcBreadcrumb, IcButton, IcButtonGroup, IcCanvasGrid, IcCanvasMultiSelection, IcCanvasNode, IcCard, IcCheckbox, IcColorField, IcConfirmPopover, IcConfirmationDialog, IcDialog, IcDivider, IcEmptyState, IcFileInput, IcFloatingToolbar, IcFormField, IcGenerationPending, IcGenerationRecovery, IcGenerationSettingsPicker, IcHeading, IcIcon, IcIconButton, IcImageEditModeToolbar, IcImageFrame, IcInput, IcList, IcLoading, IcMediaContainer, IcMediaPlayerControls, IcMediaSlot, IcMenu, IcMenuItem, IcNavDisclosure, IcNavItem, IcNumberInput, IcPagination, IcPopover, IcProgress, IcPromptComposer, IcPromptNodeFocusSurface, IcPromptTemplateLibrary, IcRadio, IcRadioGroup, IcReferenceThumbnail, IcSegmentedControl, IcSelect, IcSkeleton, IcSlider, IcSmartCanvasDock, IcSmartMinimap, IcSmartNodeContextMenu, IcSmartNodeToolbar, IcSteps, IcSwitch, IcTable, IcTabs, IcTextarea, IcThumbHovercard, IcToast, IcToolbar, IcTooltip, IcUploadSurface, IcVideoPlayButton, IcWorkspaceAssetLibrary, INFINITE_CANVAS_UI_SCROLLBAR, PROJECT_ASPECT_RATIO_PRESETS, renderCanvasNodeMarkup, renderReadOnlyPromptNodeBodyMarkup };
