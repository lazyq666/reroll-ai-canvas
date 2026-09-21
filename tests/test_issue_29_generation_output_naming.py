import unittest

from backend.infinite_canvas.generation_output import (
    apply_generation_node_changes,
    apply_generation_result_nodes,
)


class GenerationOutputNamingTests(unittest.TestCase):
    def test_new_outputs_receive_short_per_kind_names_with_real_extensions(self):
        updated = apply_generation_node_changes(
            {"id": "target", "images": []},
            {
                "images": [
                    {"url": "/assets/output/opaque-long-name.png", "name": "provider-task-123.png"},
                    {"url": "/assets/output/second.webp", "name": "another-long-name.webp"},
                    {"url": "/assets/output/clip.webm", "kind": "video", "name": "task-video.mp4"},
                    {"url": "/assets/output/voice.wav", "kind": "audio", "name": "voice.mp3"},
                    {
                        "url": "/assets/output/opaque-id",
                        "kind": "video",
                        "mime_type": "video/webm",
                        "name": "provider-video.mp4",
                    },
                ]
            },
            run_id="run-1",
        )

        self.assertEqual(
            ["image-01.png", "image-02.webp", "video-01.webm", "audio-01.wav", "video-02.webm"],
            [item["name"] for item in updated["images"]],
        )

    def test_replay_preserves_an_existing_manual_name(self):
        updated = apply_generation_node_changes(
            {
                "id": "target",
                "images": [
                    {
                        "url": "/assets/output/result.png",
                        "kind": "image",
                        "name": "镜头01_海边远景.png",
                    }
                ],
            },
            {
                "images": [
                    {
                        "url": "/assets/output/result.png",
                        "kind": "image",
                        "name": "provider-replay-name.png",
                        "width": 2048,
                    }
                ]
            },
            run_id="run-1",
        )

        self.assertEqual("镜头01_海边远景.png", updated["images"][0]["name"])
        self.assertEqual(2048, updated["images"][0]["width"])

    def test_split_batch_keeps_the_original_batch_sequence(self):
        peers = [
            {
                "id": f"slot-{index}",
                "generationBatchId": "batch-1",
                "generationOperationId": "operation-1",
                "generationSlotCount": 3,
                "generationSlotIndex": index,
                "pendingTasks": [{"taskId": "run-1", "generationSlotCount": 3}],
                "images": [],
            }
            for index in range(3)
        ]
        peers[0]["generationInputSnapshot"] = {"settings": {"count": 3}}

        updated = apply_generation_result_nodes(
            peers[0],
            {
                "images": [
                    {"url": "/assets/output/first.png", "kind": "image"},
                    {"url": "/assets/output/second.webp", "kind": "image"},
                    {"url": "/assets/output/third.png", "kind": "image"},
                ],
                "pending": 0,
                "running": False,
            },
            peers,
            run_id="run-1",
        )

        self.assertEqual(
            ["image-01.png", "image-02.webp", "image-03.png"],
            [node["images"][0]["name"] for node in updated],
        )


if __name__ == "__main__":
    unittest.main()
