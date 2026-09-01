import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class CanvasListUiRegressionTests(unittest.TestCase):
    def test_project_filter_uses_vertical_manual_tabs_with_internal_count(self):
        page = (ROOT / "static/canvas-list.html").read_text(encoding="utf-8")
        styles = (ROOT / "static/css/canvas-list.css").read_text(encoding="utf-8")
        script = (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8")

        self.assertIn('<ic-tabs id="projectList" class="ws-project-list"', page)
        self.assertIn('data-legal-combination="vertical-manual-label"', page)
        self.assertIn('orientation="vertical" activation="manual"', page)
        self.assertIn('<span class="ws-project-nav">', script)
        self.assertIn('class="ws-project-icon" name="${isDefault ? \'project-default\' : \'project\'}" size="small"', script)
        self.assertIn('<ic-badge class="ws-project-count" kind="count" tone="neutral">', script)
        self.assertLess(script.index('<span class="ws-project-nav">'), script.index('<ic-badge class="ws-project-count"'))
        self.assertNotIn('<ic-nav-item class="ws-project-nav"', script)
        self.assertIn(".ws-project-row.has-actions:is(:hover,:focus-within) .ws-project-count { opacity:0; visibility:hidden; }", styles)
        self.assertNotIn(".ws-project-row.active { background:", styles)

    def test_project_rows_have_roomy_spacing_and_hover_actions_replace_count(self):
        styles = (ROOT / "static/css/canvas-list.css").read_text(encoding="utf-8")
        navigation = (ROOT / "static/js/infinite-canvas-ui/navigation-command/tabs.js").read_text(encoding="utf-8")

        self.assertIn(".ws-project-row { --ic-tabs-item-inline-padding:var(--ui-space-3);", styles)
        self.assertIn("padding-inline:var(--ui-space-3);", styles)
        self.assertIn("var(--ic-tabs-item-inline-padding,var(--ic-navigation-inline-padding))", navigation)
        self.assertIn(':host{box-sizing:border-box;display:flex;gap:var(--ic-tabs-space,0.125rem)', navigation)
        self.assertIn("row.className = `ws-project-row${canManageProjects ? ' has-actions' : ''}`;", (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8"))
        self.assertIn(".ws-project-actions { position:absolute;", styles)
        self.assertIn("inset-inline-end:var(--ui-space-3);", styles)
        self.assertIn("inline-size:max-content;", styles)
        self.assertIn("justify-content:flex-end;", styles)
        self.assertIn("gap:var(--ui-space-1);", styles)
        self.assertIn("opacity:0; visibility:hidden; pointer-events:none;", styles)
        self.assertNotIn(".ws-project-actions { display:none;", styles)

    def test_project_navigation_fills_the_tab_row(self):
        styles = (ROOT / "static/css/canvas-list.css").read_text(encoding="utf-8")

        self.assertIn(
            ".ws-project-nav { display:grid; grid-template-columns:auto minmax(0, 1fr) auto; align-items:center; gap:var(--ui-space-2); width:100%; min-width:0; }",
            styles,
        )

    def test_sidebar_icons_keep_small_size_with_medium_stroke(self):
        page = (ROOT / "static/canvas-list.html").read_text(encoding="utf-8")
        script = (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8")
        styles = (ROOT / "static/css/canvas-list.css").read_text(encoding="utf-8")

        self.assertIn('<ic-icon-button id="newProjectBtn" class="ws-side-add" type="button" size="s"', page)
        self.assertIn('hierarchy="secondary" icon="add" label="新建项目"', page)
        self.assertIn('id="newProjectCancel" class="ws-mini-btn" type="button" size="s"', page)
        self.assertIn('id="newProjectConfirm" class="ws-mini-btn" type="button" size="s"', page)
        self.assertIn('class="ws-project-icon" name="delete" size="small"', page)
        self.assertIn('class="ws-proj-act rename" type="button" size="s"', script)
        self.assertIn('class="ws-proj-act del" type="button" size="s"', script)
        self.assertIn(".ws-sidebar { --ic-icon-context-stroke-width:var(--ui-icon-stroke-width-m);", styles)
        self.assertIn(".ws-side-add,.ws-project-icon,.ws-proj-act { --ic-icon-context-stroke-width:var(--ui-icon-stroke-width-m); }", styles)

    def test_destructive_actions_use_public_confirmation_dialog(self):
        page = (ROOT / "static/canvas-list.html").read_text(encoding="utf-8")
        styles = (ROOT / "static/css/canvas-list.css").read_text(encoding="utf-8")
        script = (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8")

        self.assertIn('<ic-confirmation-dialog id="canvasActionConfirmation"', page)
        self.assertIn("consequence:'destructive'", script)
        self.assertIn("移入回收站','Move to trash", script)
        self.assertIn("删除后不可恢复。", script)
        self.assertNotIn("ws-card-delete", styles + script)
        self.assertNotIn("ws-trash-confirm", styles + script)

    def test_project_selection_has_no_page_specific_dark_theme_override(self):
        styles = (ROOT / "static/css/canvas-list.css").read_text(encoding="utf-8")
        navigation = (ROOT / "static/js/infinite-canvas-ui/navigation-command/tabs.js").read_text(encoding="utf-8")

        self.assertNotIn(".theme-dark .ws-project-row.active", styles)
        self.assertIn('--ic-tabs-selected-background:var(--ui-color-action-secondary-selected)', navigation)
        self.assertIn('--ic-tabs-selected-background:var(--ui-color-action-secondary-selected)', navigation)
        self.assertIn('::slotted([role="tab"][aria-selected="true"]){background:var(--ic-tabs-selected-background);', navigation)

    def test_board_grid_is_owned_by_the_shared_canvas_grid_component(self):
        page = (ROOT / "static/canvas-list.html").read_text(encoding="utf-8")
        styles = (ROOT / "static/css/canvas-list.css").read_text(encoding="utf-8")

        self.assertIn('<ic-canvas-grid></ic-canvas-grid>', page)
        board_rule = styles.split(".ws-board {", 1)[1].split("}", 1)[0]
        self.assertNotIn("background-image", board_rule)
        self.assertNotIn("background-size", board_rule)
        self.assertNotIn("--ws-board-major-grid-color", styles)
        self.assertNotRegex(styles, r"#[0-9a-fA-F]{3,8}\b|(?:rgb|rgba|hsl|hsla)\(")
        self.assertNotIn("--ui-palette-", styles)

    def test_board_actions_float_without_redundant_topbar_information(self):
        page = (ROOT / "static/canvas-list.html").read_text(encoding="utf-8")
        styles = (ROOT / "static/css/canvas-list.css").read_text(encoding="utf-8")
        script = (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8")

        board_start = page.index('<div id="board" class="ws-board"')
        toolbar_start = page.index('<ic-toolbar class="ws-topbar-right"')
        board_world_start = page.index('<div id="boardWorld" class="ws-board-world"')
        self.assertLess(board_start, toolbar_start)
        self.assertLess(toolbar_start, board_world_start)
        self.assertNotIn('class="ws-topbar"', page)
        self.assertNotIn('class="ws-topbar-left"', page)
        self.assertNotIn('id="boardProjectName"', page)
        self.assertNotIn('id="boardCanvasCount"', page)
        self.assertNotIn(".ws-topbar {", styles)
        self.assertNotIn(".ws-topbar-left {", styles)
        self.assertIn(".ws-topbar-right { position:absolute;", styles)
        self.assertIn("inset-block-start:var(--ui-space-4);", styles)
        self.assertIn("inset-inline-end:var(--ui-space-4);", styles)
        self.assertNotIn("boardProjectName", script)
        self.assertNotIn("boardCanvasCount", script)
        self.assertIn(".ws-board-empty-actions,.ws-topbar-right", script)
        self.assertIn(".ws-card,.ws-topbar-right", script)

    def test_new_canvas_defaults_to_smart_canvas(self):
        page = (ROOT / "static/canvas-list.html").read_text(encoding="utf-8")
        list_script = (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8")
        editor_script = (ROOT / "static/js/canvas.js").read_text(encoding="utf-8")

        self.assertIn("let createKind = 'smart';", list_script)
        self.assertIn("createKind = 'smart';", list_script)
        self.assertIn(
            '<ic-segmented-control id="createCanvasKind" label="画布类型" value="smart"',
            page,
        )
        self.assertIn("let createCanvasKind = 'smart';", editor_script)
        self.assertIn("function setCreateMode(active, kind='smart')", editor_script)

    def test_open_canvas_does_not_call_legacy_touch_command(self):
        editor_script = (ROOT / "static/js/canvas.js").read_text(
            encoding="utf-8"
        )

        self.assertNotIn("touchCanvasOpened", editor_script)
        self.assertNotIn("/touch`, {method:'POST'", editor_script)

    def test_confirmation_actions_render_secondary_button_before_primary_button(self):
        page = (ROOT / "static/canvas-list.html").read_text(encoding="utf-8")
        editor_script = (ROOT / "static/js/canvas.js").read_text(encoding="utf-8")

        ordered_pairs = (
            (page, 'id="newProjectCancel"', 'id="newProjectConfirm"'),
            (page, 'id="createCanvasCancel"', 'id="createCanvasConfirm"'),
            (editor_script, 'class="canvas-cancel-btn"', 'class="canvas-confirm-btn"'),
        )
        for source, secondary, primary in ordered_pairs:
            with self.subTest(secondary=secondary, primary=primary):
                self.assertLess(source.index(secondary), source.index(primary))

    def test_editable_badge_is_separate_from_canvas_kind_badge(self):
        script = (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8")
        styles = (ROOT / "static/css/canvas-list.css").read_text(encoding="utf-8")

        self.assertIn('class="ws-card-kind ', script)
        self.assertIn('class="ws-card-access"', script)
        self.assertIn("L('可编辑','Editable')", script)
        self.assertNotIn("L('能画'", script)
        self.assertIn(".ws-card-access", styles)

    def test_smart_canvas_omits_kind_badge_while_classic_canvas_keeps_it(self):
        script = (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8")

        self.assertEqual(script.count("const canvasKindTag = isSmart"), 2)
        self.assertEqual(script.count('class="ws-card-kind classic"'), 2)
        self.assertNotIn('class="ws-card-kind smart"', script)

    def test_thumbnail_statuses_use_public_badges_and_icons(self):
        script = (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8")
        styles = (ROOT / "static/css/canvas-list.css").read_text(encoding="utf-8")

        self.assertIn('<ic-badge class="ws-card-kind classic" kind="label" tone="neutral">', script)
        self.assertIn('<ic-badge class="ws-card-access" kind="label" tone="neutral">', script)
        self.assertIn('<ic-badge class="ws-card-privacy" kind="label" tone="neutral">', script)
        self.assertIn('<ic-icon name="edit" size="small"', script)
        self.assertIn('<ic-icon name="lock" size="x-small"', script)
        self.assertIn(".ws-card-access ic-icon,.ws-card-privacy ic-icon,.ws-card-menu { --ic-icon-context-stroke-width:var(--ui-icon-stroke-width-m); }", styles)
        self.assertIn(".ws-card-kind::part(base),.ws-card-access::part(base),.ws-card-privacy::part(base) { min-block-size:1.5rem; block-size:1.5rem; font:var(--ui-text-caption); }", styles)
        self.assertNotIn(".ws-card-kind.classic { background:", styles)
        self.assertIn(".ws-card-menu { margin-left:auto;", styles)
        self.assertNotIn(".theme-dark .ws-card-kind", styles)

    def test_card_more_action_keeps_small_size_with_medium_stroke(self):
        script = (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8")
        styles = (ROOT / "static/css/canvas-list.css").read_text(encoding="utf-8")

        self.assertIn('<ic-icon-button class="ws-card-menu" type="button" size="s"', script)
        self.assertIn('hierarchy="secondary" icon="more"', script)
        self.assertIn(".ws-card-access ic-icon,.ws-card-privacy ic-icon,.ws-card-menu { --ic-icon-context-stroke-width:var(--ui-icon-stroke-width-m); }", styles)
        self.assertIn("--ic-icon-button-control-size:1.5rem; inline-size:1.5rem; block-size:1.5rem;", styles)
        self.assertIn("ic-icon-button.ws-card-menu::part(base) { min-inline-size:1.5rem; min-block-size:1.5rem; inline-size:1.5rem; block-size:1.5rem; }", styles)
        self.assertNotIn('class="ws-card-enter"', script)
        self.assertIn("card.setAttribute('role', 'link')", script)
        self.assertIn("openCanvas(c);", script)

    def test_card_dropdown_consumes_public_menu_components(self):
        script = (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8")
        styles = (ROOT / "static/css/canvas-list.css").read_text(encoding="utf-8")

        self.assertIn("document.createElement('ic-menu')", script)
        self.assertIn("pop.setAttribute('alignment', 'end')", script)
        self.assertIn('<ic-menu-item kind="command" icon="edit"', script)
        self.assertIn('<ic-menu-item kind="command" icon="delete"', script)
        self.assertNotIn(".ws-pop-item", styles)
        self.assertNotIn(".ws-pop-sep", styles)
        self.assertNotIn(".ws-card-pop {", styles)

    def test_canvas_cards_render_tokenized_sixteen_by_nine_covers(self):
        script = (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8")
        styles = (ROOT / "static/css/canvas-list.css").read_text(encoding="utf-8")

        self.assertIn("const coverUrl = String(c.cover_url || '').trim();", script)
        self.assertIn("const coverPreviewUrl = canvasListCoverPreviewUrl(coverUrl);", script)
        self.assertIn("/api/media-preview?w=${previewWidth}&url=", script)
        self.assertIn('data-original-src="${escapeAttr(coverUrl)}"', script)
        self.assertIn('class="ws-card-thumb ${coverUrl ? \'has-cover\' : \'\'}"', script)
        self.assertIn('class="ws-card-cover"', script)
        self.assertIn("classList.add('cover-failed')", script)
        self.assertIn(".ws-card-thumb", styles)
        self.assertIn("aspect-ratio:16/9", styles)
        self.assertIn("object-fit:cover", styles)
        self.assertIn("var(--ui-color-surface)", styles)
        self.assertIn("border-radius:var(--ui-radius-m) var(--ui-radius-m) var(--ui-radius-none) var(--ui-radius-none)", styles)
        self.assertNotIn("height:260px", styles)
        self.assertNotIn("height:238px", styles)
        self.assertNotIn(".ws-card-meta { margin-top:auto", styles)

    def test_canvas_card_uses_public_border_token(self):
        styles = (ROOT / "static/css/canvas-list.css").read_text(encoding="utf-8")
        component = (ROOT / "static/js/infinite-canvas-ui/containers-data.js").read_text(encoding="utf-8")

        self.assertIn("--ic-card-border-color:var(--ui-color-border-secondary);", component)
        self.assertIn("solid var(--ic-card-border-color)", component)
        self.assertIn("--ic-card-border-color:var(--ui-color-border-secondary);", styles)
        self.assertIn('<div class="frame" part="frame">', component)
        self.assertIn(".ws-card-thumb::part(frame) { border-radius:var(--ui-radius-none); }", styles)

    def test_canvas_list_paginates_on_demand_and_bounds_project_cache(self):
        page = (ROOT / "static/canvas-list.html").read_text(encoding="utf-8")
        script = (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8")

        self.assertIn('id="boardLoadMore"', page)
        self.assertIn("const CANVAS_LIST_PROJECT_CACHE_LIMIT = 3;", script)
        self.assertIn("function cacheProjectCanvases(projectId, items)", script)
        self.assertIn("async function loadNextCanvasBatch()", script)
        self.assertIn("boardLoadMoreBtn?.addEventListener('click', loadNextCanvasBatch);", script)
        self.assertNotIn("loadSecondaryCanvasData({refreshTrash:false})", script)

    def test_media_preview_generation_has_a_small_memory_concurrency_bound(self):
        source = (ROOT / "backend/main.py").read_text(encoding="utf-8")

        self.assertIn("MEDIA_PREVIEW_BUILD_CONCURRENCY = 2", source)
        self.assertIn("BoundedSemaphore(MEDIA_PREVIEW_BUILD_CONCURRENCY)", source)
        self.assertIn("with MEDIA_PREVIEW_BUILD_SEMAPHORE:", source)

    def test_canvas_editors_return_to_a_fresh_canvas_list_page(self):
        expected = "&v=${Date.now()}"
        for relative_path in ("static/js/canvas.js", "static/js/smart-canvas.js"):
            with self.subTest(relative_path=relative_path):
                script = (ROOT / relative_path).read_text(encoding="utf-8")
                self.assertIn(expected, script)

    def test_canvas_list_opens_fresh_editor_pages(self):
        script = (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8")

        self.assertIn("&v=${Date.now()}", script)
        self.assertNotIn("&v=2026.07.03.4", script)

    def test_canvas_focus_refreshes_account_context_before_rerendering(self):
        script = (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8")

        self.assertIn("async function refreshCanvasListSession()", script)
        self.assertIn("event.data?.type === 'canvas-focus'", script)
        self.assertGreaterEqual(script.count("refreshCanvasListSession()"), 3)

    def test_share_uses_one_entry_and_opens_an_action_tooltip_for_existing_links(self):
        page = (ROOT / "static/canvas-list.html").read_text(encoding="utf-8")
        script = (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8")
        styles = (ROOT / "static/css/canvas-list.css").read_text(encoding="utf-8")

        self.assertEqual(script.count('data-act="share"'), 1)
        self.assertNotIn('data-act="revoke-share"', script)
        self.assertIn("if(status.active){", script)
        self.assertIn("openSharePopover(id, rememberedShareUrl(id), anchorBtn)", script)
        self.assertIn("data-share-revoke", page)
        self.assertIn("data-share-regenerate", page)
        self.assertIn("await copyText(url)", script)
        self.assertNotIn("window.prompt", script)
        self.assertIn(".ws-share-popover-row", styles)
        self.assertIn('<ic-popover id="canvasSharePopover"', page)

    def test_card_menu_shows_and_copies_the_canvas_id(self):
        script = (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8")
        styles = (ROOT / "static/css/canvas-list.css").read_text(encoding="utf-8")

        self.assertIn('class="ws-card-id-item"', script)
        self.assertIn("L('画布 ID','Canvas ID')", script)
        self.assertIn('name="copy" size="x-small"', script)
        self.assertIn('data-act="copy-id"', script)
        self.assertIn("async function copyCanvasId(canvasId)", script)
        self.assertIn("const copied = await copyText(canvasId);", script)
        self.assertIn("L('画布 ID 已复制','Canvas ID copied')", script)
        self.assertIn("--ic-menu-item-font-size:var(--ui-font-size-1)", styles)
        self.assertIn("color:var(--ui-color-text-tertiary)", styles)

    def test_permanent_delete_action_is_only_rendered_for_admins(self):
        script = (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8")

        self.assertIn("const canPurge = currentUser?.role === 'admin';", script)
        self.assertIn("${canPurge ? `", script)
        self.assertIn('class="ws-trash-act purge"', script)

    def test_board_uses_pointer_with_space_or_middle_mouse_temporary_hand(self):
        page = (ROOT / "static/canvas-list.html").read_text(encoding="utf-8")
        script = (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8")
        styles = (ROOT / "static/css/canvas-list.css").read_text(encoding="utf-8")

        self.assertIn("cursor:default", styles)
        self.assertIn(".ws-board.temporary-pan { cursor:grab; }", styles)
        self.assertIn(".ws-board.panning { cursor:grabbing; }", styles)
        self.assertIn("const middle = e.button === 1;", script)
        self.assertIn("const temporaryHandLeft = e.button === 0 && boardSpacePan;", script)
        self.assertIn("e.code === 'Space'", script)
        self.assertIn("board.addEventListener('mousedown', onBoardPanStart, true);", script)
        self.assertNotIn("smartCanvasDock", page)

    def test_board_wheel_pans_by_default_and_modifier_zoom_matches_smart_canvas(self):
        list_script = (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8")
        smart_script = (ROOT / "static/js/smart-canvas.js").read_text(encoding="utf-8")

        self.assertIn("'smartCanvasPanSpeed'", list_script)
        self.assertIn("function canvasListPanSpeed()", list_script)
        self.assertIn("if(!(e.metaKey || e.ctrlKey)){", list_script)
        self.assertIn("viewport.x -= Number(e.deltaX || 0) * speed;", list_script)
        self.assertIn("viewport.y -= Number(e.deltaY || 0) * speed;", list_script)
        self.assertIn("function canvasListWheelZoomFactor(event, pageSize)", list_script)
        self.assertIn("'smartCanvasZoomSpeed'", list_script)
        self.assertIn("function canvasListZoomSpeed()", list_script)
        for contract in (
            "event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? pageSize : 1",
            "const sensitivity = 0.0016;",
            "const macMultiplier = isMac ? 1.15 : 1;",
            "Math.exp(-event.deltaY * unit * sensitivity * macMultiplier",
        ):
            with self.subTest(contract=contract):
                self.assertIn(contract, list_script)
                self.assertIn(contract, smart_script)
        self.assertIn("* canvasListZoomSpeed()", list_script)
        self.assertIn("* smartCanvasZoomSpeed", smart_script)
        self.assertNotIn("e.deltaY < 0 ? 1.1 : 1 / 1.1", list_script)


if __name__ == "__main__":
    unittest.main()
