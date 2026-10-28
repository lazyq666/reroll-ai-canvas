"""Background image CLI using the same paired Agent connection as the MCP bridge."""
import argparse
import io
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from urllib.parse import quote
import uuid
import warnings

import httpx
from PIL import Image, UnidentifiedImageError
from bridge import Bridge, BridgeError
from reroll_cli_i18n import tr


class UsageError(ValueError):
    pass


class Formatter(argparse.HelpFormatter):
    def _format_usage(self, usage, actions, groups, prefix):
        return super()._format_usage(usage, actions, groups, tr('usage_prefix') if prefix is None else prefix)


class Parser(argparse.ArgumentParser):
    def __init__(self, *args, **kwargs):
        kwargs['formatter_class'] = Formatter
        super().__init__(*args, **kwargs)
        self._positionals.title = tr('arguments')
        self._optionals.title = tr('options')

    def error(self, message):
        raise UsageError()


def parser():
    result = Parser(prog='reroll', description=tr('description'), add_help=False, allow_abbrev=False)
    result.add_argument('-h', '--help', action='help', help=tr('help'))
    commands = result.add_subparsers(dest='command', parser_class=Parser, title=tr('commands'))
    for name in ('models', 'generate', 'result'):
        command = commands.add_parser(name, help=tr(name + '_help'), description=tr(name + '_help'), add_help=False, allow_abbrev=False)
        command.add_argument('-h', '--help', action='help', help=tr('help'))
        command.add_argument('--json', action='store_true', help=tr('json_help'))
        if name != 'models':
            command.add_argument('--output', default='./reroll-output', help=tr('output_help'))
        if name == 'generate':
            command.add_argument('prompt', nargs='?', help=tr('prompt_help'))
            command.add_argument('--provider', help=tr('provider_help'))
            command.add_argument('--model', help=tr('model_help'))
            command.add_argument('--image', action='append', default=[], help=tr('image_help'))
            command.add_argument('--ratio', help=tr('ratio_help'))
            command.add_argument('--resolution', help=tr('resolution_help'))
            command.add_argument('--request-id', help=tr('request_help'))
        elif name == 'result':
            command.add_argument('run_id', nargs='?', help=tr('run_help'))
    return result


def empty_result():
    return {'status':'failed', 'request_id':None, 'run_id':None, 'provider_id':None, 'model':None,
        'operation':None, 'settings':{'requested_ratio':None,'ratio':None,'requested_resolution':None,'resolution':None},
        'inputs':[], 'outputs':[], 'error':None}


def prepare_directory(value):
    try:
        directory = Path(value).expanduser().resolve()
        directory.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix='.reroll-check-', dir=directory)
        os.close(fd)
        Path(temporary).unlink()
        return directory
    except (OSError, ValueError):
        raise BridgeError('output_unwritable') from None


def image_info(source):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(source) as image:
                image.verify()
            source.seek(0)
            with Image.open(source) as image:
                image.load()
                width, height = image.size
                kind = image.format
        if width <= 0 or height <= 0 or not kind:
            raise ValueError()
        return width, height, kind
    except (OSError, ValueError, SyntaxError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise BridgeError('invalid_image') from None


def read_images(paths, limits):
    images = []
    for index, value in enumerate(paths):
        try:
            path = Path(value).expanduser().resolve(strict=True)
            if not path.is_file():
                raise BridgeError('invalid_image', {'index':index + 1})
            maximum = limits.get('maximum_bytes')
            if maximum is not None and path.stat().st_size > maximum:
                raise BridgeError('image_too_large', {'index':index + 1, 'maximum_bytes':maximum})
            extensions = limits.get('extensions')
            if extensions and path.suffix.lower() not in extensions:
                raise BridgeError('unsupported_image_type', {'index':index + 1, 'extensions':extensions})
            with path.open('rb') as source:
                data = source.read(maximum + 1 if maximum is not None else -1)
            if maximum is not None and len(data) > maximum:
                raise BridgeError('image_too_large', {'index':index + 1, 'maximum_bytes':maximum})
            width, height, kind = image_info(io.BytesIO(data))
            images.append({'name':path.name,'data':data,'width':width,'height':height,'format':kind})
        except (OSError, ValueError) as error:
            if isinstance(error, BridgeError):
                raise
            raise BridgeError('invalid_image', {'index':index + 1}) from None
    return images


def capability(bridge, provider, model, operation):
    return bridge.request('GET', 'models/' + quote(provider, safe='') + '/' + quote(model, safe=''), params={'operation':operation})


def validate_parameter(value, rule, code, required_code, *, normalize=False):
    if value is None:
        if rule and rule.get('values') != [] and rule.get('required') and rule.get('default') in (None,''):
            raise BridgeError(required_code, {'options':rule.get('values',[])})
        return None
    options = (rule or {}).get('values', [])
    if normalize:
        matches = [item for item in options if isinstance(item,str) and item.casefold() == value.casefold()]
        if matches:
            return matches[0]
    elif value in options:
        return value
    raise BridgeError(code, {'options':options})


def validate_generate(args, cap, images):
    maximum_prompt = cap.get('authoring',{}).get('prompt_maximum_characters',100000)
    if len(args.prompt) > maximum_prompt:
        raise BridgeError('prompt_too_long',{'maximum':maximum_prompt})
    rules = cap.get('parameters',{})
    bounds = cap.get('inputs',{}).get('image',{})
    if len(images) > bounds.get('maximum',0) or (images and len(images) < bounds.get('minimum',0)):
        raise BridgeError('invalid_reference_count', {'minimum':bounds.get('minimum',0),'maximum':bounds.get('maximum',0)})
    if len(images) > 1 and (not args.ratio or args.ratio == 'auto'):
        raise BridgeError('explicit_ratio_required')
    if args.ratio == 'auto':
        if len(images) != 1:
            raise BridgeError('invalid_auto_ratio')
    else:
        validate_parameter(args.ratio, rules.get('aspect_ratio'), 'invalid_ratio', 'ratio_required')
    return validate_parameter(args.resolution, rules.get('resolution_tier'), 'invalid_resolution', 'resolution_required', normalize=True)


def list_models(bridge):
    result = bridge.request('GET','models')
    models = []
    for original in result.get('models',[]):
        if original.get('kind') != 'image':
            continue
        item = dict(original)
        operations = {}
        for operation in ('image.generate','image.edit'):
            try:
                operations[operation] = capability(bridge,item['provider_id'],item['model'],operation)
            except BridgeError as error:
                if error.code not in ('model_unavailable','unsupported_operation','model_operation_unavailable','image_operation_unsupported'):
                    raise
        item['operations'] = operations
        models.append(item)
    return {'models':models, **{key:value for key,value in result.items() if key != 'models'}}


def adopt_result(result, payload):
    if not isinstance(payload,dict) or not payload.get('run_id') or not isinstance(payload.get('status'),str):
        raise BridgeError('invalid_response')
    for key in result:
        if key in payload:
            result[key] = payload[key]


def download(bridge, result, directory, deadline, clock):
    outputs = result.get('outputs')
    if not isinstance(outputs,list) or len(outputs) != 1:
        raise BridgeError('invalid_response')
    output = outputs[0]
    run_id = str(result['run_id'])
    expected = '/api/agent/v1/image-runs/' + quote(run_id,safe='') + '/outputs/0'
    url = output.get('download_url','')
    if url != expected or not bridge.valid_download_url(url):
        raise BridgeError('invalid_download_url')
    temporary = None
    final = None
    try:
        if clock() >= deadline:
            raise TimeoutError()
        fd, name = tempfile.mkstemp(prefix='.reroll-download-', suffix='.part', dir=directory)
        temporary = Path(name)
        with os.fdopen(fd,'wb') as stream, bridge.client.stream('GET',url,timeout=max(0.01,min(60,deadline-clock()))) as response:
            if not response.is_success:
                response.read()
                try:
                    error = response.json()
                except ValueError:
                    error = {}
                code = error.get('code','download_failed') if isinstance(error,dict) else 'download_failed'
                raise BridgeError('authorization_revoked' if code == 'unauthorized' else code)
            for chunk in response.iter_bytes():
                if clock() >= deadline:
                    raise TimeoutError()
                stream.write(chunk)
            stream.flush()
            os.fsync(stream.fileno())
        with temporary.open('rb') as source:
            width,height,kind = image_info(source)
        suffix = {'JPEG':'.jpg','PNG':'.png','WEBP':'.webp','GIF':'.gif','TIFF':'.tiff','BMP':'.bmp','AVIF':'.avif'}.get(kind)
        if suffix is None:
            suffix = next((ext for ext,fmt in Image.registered_extensions().items() if fmt == kind), None)
        if suffix is None:
            raise BridgeError('download_failed')
        stem = Path(str(output.get('name') or 'image').replace('\\','/')).stem
        stem = re.sub(r'[\x00-\x1f<>:"/\\|?*]','_',stem).strip(' .')[:120] or 'image'
        for number in range(100000):
            target = directory / (stem + (f' ({number})' if number else '') + suffix)
            try:
                # Exclusive creation works on Windows and POSIX and never overwrites.
                with target.open('xb') as destination, temporary.open('rb') as source:
                    final = target
                    while chunk := source.read(1024 * 1024):
                        destination.write(chunk)
                    destination.flush()
                    os.fsync(destination.fileno())
                break
            except FileExistsError:
                continue
        else:
            raise BridgeError('download_failed')
        with final.open('rb') as source:
            source.read(1)
        if clock() >= deadline:
            raise TimeoutError()
        return [{'path':str(final),'width':width,'height':height}]
    except (OSError,httpx.TransportError,BridgeError,TimeoutError,KeyboardInterrupt) as error:
        if final:
            final.unlink(missing_ok=True)
        if isinstance(error,(TimeoutError,KeyboardInterrupt)):
            raise
        if isinstance(error,BridgeError) and error.code != 'invalid_image':
            raise
        raise BridgeError('download_failed') from None
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


def clean_details(value, token=''):
    if isinstance(value,dict):
        return {str(key):clean_details(item,token) for key,item in value.items() if not any(part in str(key).lower() for part in ('token','secret','password','authorization','api_key','instruction'))}
    if isinstance(value,list):
        return [clean_details(item,token) for item in value]
    if isinstance(value,str):
        text = value.replace(token,'<REDACTED>') if token else value
        return re.sub(r'(?:reroll_agent_|sk-)[A-Za-z0-9_-]+','<REDACTED>',text)
    if value is None or isinstance(value,(bool,int,float)):
        return value
    return None


def main(argv=None, *, bridge_factory=Bridge, clock=time.monotonic, sleep=time.sleep, wait_seconds=900):
    argv = list(sys.argv[1:] if argv is None else argv)
    json_mode = '--json' in argv
    result = empty_result()
    bridge = None
    url = os.environ.get('REROLL_URL','http://127.0.0.1:3000')
    submitting = False
    try:
        args, unknown = parser().parse_known_args(argv)
        if unknown or not args.command:
            raise UsageError()
        if args.command == 'generate':
            if args.prompt is None or not args.provider or not args.model:
                raise UsageError()
            result.update(request_id=args.request_id or 'req_' + uuid.uuid4().hex, provider_id=args.provider, model=args.model, operation='image.edit' if args.image else 'image.generate')
            result['settings'].update(requested_ratio=args.ratio,requested_resolution=args.resolution)
            if not args.prompt.strip():
                raise BridgeError('invalid_prompt')
            if not 1 <= len(result['request_id']) <= 160 or not result['request_id'].isprintable():
                raise BridgeError('invalid_request_id')
        elif args.command == 'result':
            if not args.run_id:
                raise UsageError()
            result['run_id'] = args.run_id
        directory = prepare_directory(args.output) if args.command != 'models' else None
        bridge = bridge_factory(url,token=os.environ.get('REROLL_AGENT_TOKEN',''),client_name=os.environ.get('REROLL_CLIENT_NAME','Reroll CLI'),credential_directory=os.environ.get('REROLL_CREDENTIAL_DIR'))
        if args.command == 'models':
            payload = list_models(bridge)
            print(json.dumps(payload,ensure_ascii=False))
            return 0
        bridge.authorize()
        deadline = None
        if args.command == 'generate':
            existing = None
            if args.request_id:
                try:
                    existing = bridge.request('GET','image-runs/by-request',params={'request_id':args.request_id})
                except BridgeError as error:
                    if error.code != 'run_not_found':
                        raise
            references = []
            if existing is not None:
                if not isinstance(existing, dict) or not existing.get('run_id'):
                    raise BridgeError('invalid_response')
                result['run_id'] = existing['run_id']
                # Agent uploads use content SHA-256 as their public media identity.
                # Reconcile the exact original input before consulting today's
                # capabilities: accepted Runs retain their frozen settings.
                images = read_images(args.image,{})
                references = [{'media_id':hashlib.sha256(image['data']).hexdigest(),'name':image['name']} for image in images]
            else:
                catalog = bridge.request('GET','models')
                if not any(item.get('provider_id') == args.provider and item.get('model') == args.model and item.get('kind') == 'image' for item in catalog.get('models',[])):
                    raise BridgeError('model_unavailable')
                cap = capability(bridge,args.provider,args.model,result['operation'])
                validate_generate(args,cap,args.image)
                images = read_images(args.image,catalog.get('media_upload',{}))
                for image in images:
                    uploaded = bridge.request('POST','media',files={'file':(image['name'],io.BytesIO(image['data']),Image.MIME.get(image['format'],'application/octet-stream'))})
                    references.append({'media_id':uploaded['media_id'],'name':image['name']})
            body = {'request_id':result['request_id'],'prompt':args.prompt,'provider_id':args.provider,'model':args.model,'images':references}
            if args.ratio is not None:
                body['ratio'] = args.ratio
            if args.resolution is not None:
                body['resolution'] = args.resolution
            deadline = clock() + wait_seconds
            submitting = True
            payload = bridge.request('POST','image-runs',body=body,key=result['request_id'],deadline=deadline,clock=clock)
            adopt_result(result,payload)
            submitting = False
        else:
            deadline = clock() + wait_seconds
            adopt_result(result,bridge.request('GET','image-runs/' + quote(args.run_id,safe=''),deadline=deadline,clock=clock))
        announced = False
        while result['status'] not in ('succeeded','failed','canceled','cancelled','discarded'):
            if clock() >= deadline:
                raise TimeoutError()
            if not announced:
                print(tr('waiting',run_id=result['run_id']),file=sys.stderr)
                announced = True
            sleep(min(1,max(0,deadline-clock())))
            adopt_result(result,bridge.request('GET','image-runs/' + quote(str(result['run_id']),safe=''),deadline=deadline,clock=clock))
        if result['status'] != 'succeeded':
            raw = result.get('error') or {}
            raise BridgeError(raw.get('code','generation_failed'),raw.get('details',{}))
        result['outputs'] = download(bridge,result,directory,deadline,clock)
        result['error'] = None
        exit_code = 0
    except UsageError:
        result['error'] = {'code':'usage_error','message':tr('usage_error'),'details':{}}
        exit_code = 2
    except TimeoutError:
        result['status'] = 'pending' if result['run_id'] else 'unknown'
        result['error'] = {'code':result['status'],'message':tr(result['status'],run_id=result['run_id']),'details':{}}
        exit_code = 3 if result['run_id'] else 4
    except KeyboardInterrupt:
        result['status'] = 'pending' if result['run_id'] else 'unknown' if submitting else 'failed'
        result['error'] = {'code':'interrupted','message':tr('interrupted'),'details':{}}
        exit_code = 130
    except (BridgeError,httpx.TransportError,httpx.InvalidURL,OSError,ValueError,KeyError,TypeError) as error:
        code = error.code if isinstance(error,BridgeError) else 'server_unreachable' if isinstance(error,httpx.TransportError) else 'invalid_server_url' if isinstance(error,httpx.InvalidURL) or bridge is None and isinstance(error,ValueError) else 'invalid_response'
        details = clean_details(error.details,bridge.token if bridge else '') if isinstance(error,BridgeError) else {}
        if submitting and code in ('server_unreachable','invalid_response','api_error'):
            result['status'] = 'pending' if result['run_id'] else 'unknown'
            result['error'] = {'code':result['status'],'message':tr(result['status'],run_id=result['run_id']),'details':{'cause':code}}
            exit_code = 3 if result['run_id'] else 4
        else:
            result['status'] = 'failed'
            result['error'] = {'code':code,'message':tr(code,url=bridge.url if bridge else url,run_id=result['run_id'],code=details.get('code','')),'details':details}
            exit_code = 1
    if json_mode:
        print(json.dumps(result,ensure_ascii=False))
    elif exit_code == 0:
        for output in result['outputs']:
            print(tr('saved',path=output['path']))
    else:
        print(result['error']['message'],file=sys.stderr)
        print(json.dumps(result,ensure_ascii=False))
    return exit_code


if __name__ == '__main__':
    raise SystemExit(main())
