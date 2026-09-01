import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "static" / "js" / "smart-canvas.js"
SETTINGS = ROOT / "static" / "js" / "smart-canvas" / "generation-settings.js"
RUN = ROOT / "static" / "js" / "smart-canvas" / "generation-run.js"


class Issue161MediaComposerEligibilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.host = HOST.read_text(encoding="utf-8")
        cls.settings = SETTINGS.read_text(encoding="utf-8")
        cls.run_source = RUN.read_text(encoding="utf-8")

    def test_one_role_eligibility_contract_drives_visibility_button_and_submission(self):
        eligibility = self.host[
            self.host.index("function isSmartRunnableNode(node)"):
            self.host.index("function isHistoryGroupNode(node)")
        ]
        self.assertIn("return smartNodeGenerationEligibility(node).runnable", eligibility)
        self.assertIn("nodeKinds.isGeneration(node) || smartContainer.isGroup(node)", eligibility)
        self.assertNotIn("uploadedAttachment", eligibility)

        composer = self.host[
            self.host.index("function updateComposer("):
            self.host.index("function renderInputThumbsRow", self.host.index("function updateComposer("))
        ]
        self.assertIn("if(!isSmartRunnableNode(node))", composer)

        button = self.host[
            self.host.index("function syncRunButtonState("):
            self.host.index("function canvasImageDragPayload", self.host.index("function syncRunButtonState("))
        ]
        self.assertIn("runBtn.disabled = !isSmartRunnableNode(node)", button)

        gate = self.run_source[
            self.run_source.index("async function runGeneration("):
            self.run_source.index("function generationRunStatus", self.run_source.index("async function runGeneration("))
        ]
        self.assertIn("? smartNodeGenerationEligibility(node)", gate)
        self.assertIn("if(!nodeEligibility.runnable) return false", gate)

    def test_plain_media_nodes_do_not_receive_composer_or_generation_eligibility(self):
        eligibility = self.host[
            self.host.index("function smartNodeGenerationEligibility(node)"):
            self.host.index("function isHistoryGroupNode(node)")
        ]
        self.assertIn("nodeKinds.isGeneration(node)", eligibility)
        self.assertNotIn("isSmartImageNode(node) ||", eligibility)
        self.assertNotIn("isSmartUploadMediaNode(node)", eligibility)

    def test_only_generation_nodes_with_video_or_audio_media_are_constrained_to_video(self):
        eligibility = self.host[
            self.host.index("function smartNodeGenerationEligibility(node)"):
            self.host.index("function isHistoryGroupNode(node)")
        ]
        self.assertIn("mediaKinds.has('video') || mediaKinds.has('audio')", eligibility)
        self.assertNotIn("referenceGenerationKind(node) === 'video'", eligibility)
        self.assertIn("const videoOnly = hasVideoOrAudio && !hasImage", eligibility)
        self.assertIn("imageAllowed:!videoOnly", eligibility)
        self.assertIn("forcedApiKind:videoOnly ? 'video' : ''", eligibility)

        constraint = self.settings[
            self.settings.index("function constrainSmartNodeGenerationSettings("):
            self.settings.index("function reconcileSmartSettingsAfterCanvasSync", self.settings.index("function constrainSmartNodeGenerationSettings("))
        ]
        self.assertIn("recentSmartSettingsForMode(smartSettingsModeKey(modeSettings))", constraint)
        self.assertIn("engine:requestedEngine, apiKind:'video'", constraint)
        self.assertIn("base = constrainSmartNodeGenerationSettings(node, base)", self.settings)

        persistence = self.settings[
            self.settings.index("function persistActiveSmartSettings()"):
            self.settings.index("window.SmartCanvasModules", self.settings.index("function persistActiveSmartSettings()"))
        ]
        self.assertIn("referenceGenerationKind(subject)", persistence)
        self.assertIn("!(subject.images || []).some(item => item?.url)", persistence)
        self.assertIn("!smartNodeInFlight(subject)", persistence)
        self.assertIn("subject.referenceGenerationKind = settings.apiKind === 'video'", persistence)

        gate = self.run_source[
            self.run_source.index("async function runGeneration("):
            self.run_source.index("const runSettings = runPlan.settings", self.run_source.index("async function runGeneration("))
        ]
        self.assertIn("!nodeEligibility.imageAllowed", gate)
        self.assertIn("runPlan.outputKind !== 'video'", gate)

    def test_kind_toggle_is_disabled_and_guarded_when_video_is_forced(self):
        toggle = self.host[
            self.host.index("function syncApiKindToggleVisibility("):
            self.host.index("runBtn.onclick", self.host.index("function syncApiKindToggleVisibility("))
        ]
        self.assertIn("apiKindToggle.disabled = Boolean(forcedKind)", toggle)
        self.assertIn("if(smartNodeGenerationEligibility(activeComposerNode()).forcedApiKind) return", toggle)
        self.assertIn("syncApiKindToggleVisibility();", self.host[
            self.host.index("function updateComposer("):
            self.host.index("function renderInputThumbsRow", self.host.index("function updateComposer("))
        ])


if __name__ == "__main__":
    unittest.main()
