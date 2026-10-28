"""CLI copy exported from the shared agent.cli namespace (checked for parity)."""
import os

MESSAGES = {
    'description': {'zh':'通过 Reroll 后台生成图片并保存到本机。','en':'Generate images with the running Reroll service and save them locally.'},
    'models_help': {'zh':'查看模型与图片生成能力。','en':'List models and their image capabilities.'},
    'generate_help': {'zh':'生成并下载一张图片。','en':'Generate and download one image.'},
    'result_help': {'zh':'等待并下载已有任务的图片。','en':'Wait for and download an existing image run.'},
    'help': {'zh':'显示帮助。','en':'Show help.'},
    'json_help': {'zh':'向 stdout 输出一个 JSON 结果。','en':'Write one JSON result to stdout.'},
    'provider_help': {'zh':'models 返回的 Provider ID。','en':'Provider ID returned by models.'},
    'model_help': {'zh':'models 返回的 Model ID。','en':'Model ID returned by models.'},
    'image_help': {'zh':'本地参考图片；可重复指定，保持顺序。','en':'Local reference image; repeat in the required order.'},
    'ratio_help': {'zh':'模型支持的画幅比例；auto 只接受单张参考图。','en':'Supported aspect ratio; auto requires exactly one reference image.'},
    'resolution_help': {'zh':'模型支持的分辨率档位，例如 2K。','en':'Supported native resolution tier, for example 2K.'},
    'output_help': {'zh':'输出目录，默认 ./reroll-output。','en':'Output directory; defaults to ./reroll-output.'},
    'request_help': {'zh':'重试时复用原请求身份，避免重复生成。','en':'Reuse the original request ID when retrying to avoid duplicate generation.'},
    'prompt_help': {'zh':'保留原文和换行的提示词。','en':'Prompt text; original whitespace and line breaks are preserved.'},
    'run_help': {'zh':'原生成任务的 Run ID。','en':'Run ID of the original generation.'},
    'usage_error': {'zh':'命令参数不完整或不受支持。运行 reroll --help 查看用法。','en':'Missing or unsupported arguments. Run reroll --help for usage.'},
    'invalid_prompt': {'zh':'提示词不能为空。','en':'The prompt must contain text.'},
    'invalid_request_id': {'zh':'请求身份应为 1–160 个可打印字符。','en':'Use a request ID containing 1–160 printable characters.'},
    'model_unavailable': {'zh':'模型不可用。运行 reroll models 查看准确的 Provider ID 和 Model ID。','en':'The model is unavailable. Run reroll models for its exact Provider ID and Model ID.'},
    'invalid_image': {'zh':'参考图无法读取或不是有效图片。检查指定文件。','en':'A reference image is unreadable or invalid. Check the specified file.'},
    'image_too_large': {'zh':'参考图超过上传大小限制。请缩小图片后重试。','en':'A reference image exceeds the upload limit. Reduce its size and retry.'},
    'unsupported_image_type': {'zh':'参考图类型不受支持。请使用允许的图片格式。','en':'The reference image type is unsupported. Use an allowed image format.'},
    'invalid_reference_count': {'zh':'参考图片数量不符合该操作的模型限制。','en':'The reference image count is outside this operation’s model limits.'},
    'explicit_ratio_required': {'zh':'多张参考图必须明确指定非 auto 的 --ratio。','en':'Multiple reference images require an explicit --ratio other than auto.'},
    'invalid_auto_ratio': {'zh':'auto 只适用于恰好一张参考图；请指定明确比例。','en':'auto requires exactly one reference image. Choose an explicit ratio.'},
    'invalid_ratio': {'zh':'画幅比例不受支持。请选择返回的合法选项。','en':'The aspect ratio is unsupported. Choose one of the returned options.'},
    'invalid_resolution': {'zh':'分辨率档位不受支持。请选择返回的合法选项。','en':'The resolution tier is unsupported. Choose one of the returned options.'},
    'ratio_required': {'zh':'模型没有默认比例。请使用 --ratio 指定合法选项。','en':'The model has no default aspect ratio. Set --ratio to an allowed option.'},
    'resolution_required': {'zh':'模型没有默认档位。请使用 --resolution 指定合法选项。','en':'The model has no default resolution tier. Set --resolution to an allowed option.'},
    'output_unwritable': {'zh':'无法写入输出目录。检查 --output 路径与权限。','en':'The output directory is not writable. Check the --output path and permissions.'},
    'server_unreachable': {'zh':'无法连接 Reroll：{url}。启动服务或检查 REROLL_URL。','en':'Cannot connect to Reroll at {url}. Start the service or check REROLL_URL.'},
    'invalid_server_url': {'zh':'REROLL_URL 必须是无凭据的 HTTP 或 HTTPS 服务地址。','en':'REROLL_URL must be an HTTP or HTTPS service address without credentials.'},
    'credential_store_unavailable': {'zh':'无法读取授权缓存。检查 REROLL_CREDENTIAL_DIR 的权限与内容。','en':'The credential cache is unavailable. Check REROLL_CREDENTIAL_DIR and its permissions.'},
    'authorization_required': {'zh':'在 {url} 登录并批准识别码 {code}，然后重试原命令。','en':'Sign in at {url}, approve request code {code}, then retry the original command.'},
    'authorization_denied': {'zh':'授权请求已被拒绝。等待该请求过期后重新配对。','en':'Authorization was denied. Wait for this request to expire before pairing again.'},
    'authorization_revoked': {'zh':'授权已撤销。重试命令以请求新的网页授权。','en':'Access was revoked. Retry the command to request new browser approval.'},
    'unauthorized': {'zh':'授权无效。请重新完成网页配对。','en':'Authorization is invalid. Complete browser pairing again.'},
    'forbidden': {'zh':'当前账号没有此操作的权限。请检查角色与 Agent 接入设置。','en':'This account cannot perform the operation. Check its role and Agent access settings.'},
    'agent_disabled': {'zh':'Agent 接入已关闭。请在 Reroll 设置中启用。','en':'Agent access is disabled. Enable it in Reroll settings.'},
    'confirmation_required': {'zh':'账号要求逐条确认。请在已有 Agent 设置中主动调整后重试。','en':'This account requires confirmation for each run. Adjust the existing Agent setting before retrying.'},
    'concurrency_limit': {'zh':'账号已达到并发上限。等待现有任务完成后重试。','en':'The account has reached its concurrency limit. Wait for an existing run to finish.'},
    'operation_collision': {'zh':'该请求身份已用于不同输入。原样重试或为新任务使用新身份。','en':'This request ID was used with different inputs. Retry the original input or use a new ID for a new run.'},
    'download_failed': {'zh':'图片下载失败。运行 reroll result {run_id} 取回原任务。','en':'The image could not be downloaded. Run reroll result {run_id} to retrieve the original run.'},
    'invalid_download_url': {'zh':'服务返回的下载地址无效。请升级或检查 Reroll 服务。','en':'The service returned an invalid download URL. Check or update the Reroll service.'},
    'invalid_response': {'zh':'服务响应格式无效。请检查客户端与服务版本。','en':'The service response is invalid. Check the client and service versions.'},
    'generation_failed': {'zh':'生成失败。检查模型连接或运行信息后重试。','en':'Generation failed. Check the model connection or run information before retrying.'},
    'api_error': {'zh':'Reroll 拒绝了请求。检查错误代码与参数后重试。','en':'Reroll rejected the request. Check the error code and parameters before retrying.'},
    'pending': {'zh':'本次等待已结束，任务继续运行。使用 reroll result {run_id} 取回结果。','en':'This wait has ended; the run continues. Use reroll result {run_id} to retrieve it.'},
    'unknown': {'zh':'提交结果尚未确认。保留 request_id，用相同身份和原输入重试以对账。','en':'Submission is unconfirmed. Keep request_id and retry with the same ID and original input to reconcile it.'},
    'interrupted': {'zh':'已停止等待；已接收的任务不会取消。','en':'Waiting stopped; an accepted run has not been canceled.'},
    'waiting': {'zh':'任务 {run_id} 正在运行…','en':'Run {run_id} is in progress…'},
    'saved': {'zh':'已保存：{path}','en':'Saved: {path}'},
}

MESSAGES.update({
    'image_runs_unavailable': {'zh': '当前服务不支持后台图片生成。请升级并重启 Reroll。', 'en': 'This service does not support background image runs. Update and restart Reroll.'},
    'prompt_required': {'zh': '提示词不能为空。', 'en': 'The prompt must contain text.'},
    'prompt_too_long': {'zh': '提示词超过模型限制。缩短后重试。', 'en': 'The prompt exceeds the model limit. Shorten it and retry.'},
    'capability_unknown': {'zh': '模型能力尚未确认。请在 Reroll 中审核该操作的能力。', 'en': 'This model capability is unconfirmed. Review the operation’s capabilities in Reroll.'},
    'media_unavailable': {'zh': '参考图片不可用。请使用原文件重新上传。', 'en': 'A reference image is unavailable. Upload the original file again.'},
    'parameter_not_applicable': {'zh': '该模型不接受此参数。请查看 reroll models。', 'en': 'This parameter does not apply to the model. Check reroll models.'},
    'parameter_required': {'zh': '模型没有该参数的默认值。请明确指定返回的合法选项。', 'en': 'The model has no default for this parameter. Set one of the returned options.'},
    'parameter_value': {'zh': '参数值不受支持。请选择返回的合法选项。', 'en': 'The parameter value is unsupported. Choose one of the returned options.'},
    'auto_ratio_requires_one_image': {'zh': 'auto 只接受一张参考图。请指定明确比例。', 'en': 'auto requires exactly one reference image. Choose an explicit ratio.'},
    'auto_ratio_unavailable': {'zh': '无法从该参考图解析支持的比例。请明确指定 --ratio。', 'en': 'No supported ratio could be resolved from the reference image. Set --ratio explicitly.'},
    'capability_validation_failed': {'zh': '请求不符合当前模型能力。请查看错误详情与 reroll models。', 'en': 'The request does not meet the current model capabilities. Check the details and reroll models.'},
    'request_conflict': {'zh': '该请求身份已用于不同输入。原样重试或为新任务使用新身份。', 'en': 'This request ID was used with different inputs. Retry the original input or use a new ID for a new run.'},
    'image_run_submission_failed': {'zh': '生成提交失败。保留 request_id 并以原输入重试。', 'en': 'Image submission failed. Keep request_id and retry with the original input.'},
    'run_not_found': {'zh': '未找到当前账号可访问的任务。检查 Run ID 与授权账号。', 'en': 'No accessible run was found. Check the Run ID and authorized account.'},
    'output_unavailable': {'zh': '原任务的图片暂不可用。稍后使用 reroll result 重试下载。', 'en': 'The original image is unavailable. Retry the download later with reroll result.'},
})

MESSAGES.update({
    'run_scope_required': {'zh': '当前授权不包含运行权限。请重新配对并批准运行权限。', 'en': 'This grant does not include run permission. Pair again with run access.'},
    'invalid_request': {'zh': '请求参数无效。检查命令参数并更新客户端。', 'en': 'The request is invalid. Check the arguments and update the client.'},
    'invalid_refs': {'zh': '参考图列表无效。检查文件与输入顺序。', 'en': 'The reference image list is invalid. Check the files and their order.'},
    'media_size_limit': {'zh': '参考图超过服务的上传大小限制。请缩小后重试。', 'en': 'A reference image exceeds the service upload limit. Reduce its size and retry.'},
    'resolution_transport_unsupported': {'zh': '该模型连接无法传递请求的分辨率档位。请检查 Provider 配置。', 'en': 'This model connection cannot send the requested resolution tier. Check the Provider configuration.'},
    'catalog_changed': {'zh': '模型能力目录已变化。查看 reroll models 后以明确设置重试。', 'en': 'The model capability catalog changed. Check reroll models and retry with explicit settings.'},
    'provider_unavailable': {'zh': 'Provider 不可用。检查 Reroll 中的连接配置。', 'en': 'The Provider is unavailable. Check its connection settings in Reroll.'},
    'commands': {'zh': '命令', 'en': 'commands'},
    'options': {'zh': '选项', 'en': 'options'},
    'arguments': {'zh': '参数', 'en': 'arguments'},
    'usage_prefix': {'zh': '用法：', 'en': 'usage: '},
})


def language():
    value = os.environ.get('REROLL_LANGUAGE') or os.environ.get('LC_ALL') or os.environ.get('LC_MESSAGES') or os.environ.get('LANG', '')
    return 'zh' if value.lower().startswith('zh') else 'en'


def tr(key, **values):
    return MESSAGES.get(key, MESSAGES['api_error'])[language()].format(**values)
