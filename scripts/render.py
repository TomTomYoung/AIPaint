"""Render a validated JSON job using the exact same browser app as the UI.

python scripts/render.py examples/slime.json --output outputs
No GitHub upload is performed. Existing asset revisions are never overwritten.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import tempfile
from playwright.sync_api import sync_playwright
from browser_support import ROOT, serve, launch, restrict_network, wait_for_condition

EXPORT = r'''async job => {
  const agent = window.paintAgent, s = agent.getState();
  const result = agent.runJob({job, replace: true, expectedDocumentId: s.documentId, expectedRevision: s.revision});
  const ref = {documentId: result.documentId, revision: result.revision};
  const image = await agent.exportImage(ref), preview = await agent.renderPreview({...ref, maxDimension: 512});
  const b64 = blob => new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject; reader.readAsDataURL(blob);
  });
  const project = agent.exportProject(ref), layers = {};
  for (const layer of project.layers) {
    const canvas = document.createElement('canvas'); canvas.width = project.width; canvas.height = project.height;
    const data = Uint8ClampedArray.from(atob(layer.pixels), c => c.charCodeAt(0));
    canvas.getContext('2d').putImageData(new ImageData(data, project.width, project.height), 0, 0);
    layers[layer.id] = canvas.toDataURL('image/png').split(',')[1];
  }
  const digest = await crypto.subtle.digest('SHA-256', agent.composite().data);
  return {image: await b64(image.blob), preview: await b64(preview.blob), layers, project, checks: result.checks,
    imageSHA256: image.sha256, rgbaSHA256: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join(''),
    capabilities: agent.getCapabilities()};
}'''

def sha(data):
    return hashlib.sha256(data).hexdigest()

def render(job_path: Path, output: Path):
    if job_path.stat().st_size > 4000000:
        raise ValueError('Job JSON exceeds 4 MB')
    job = json.loads(job_path.read_text(encoding='utf-8'))
    with serve() as origin, sync_playwright() as p:
        browser = launch(p)
        try:
            context = browser.new_context()
            restrict_network(context, origin)
            page = context.new_page()
            page.set_default_timeout(30000)
            page.goto(origin + '/AIPaint/')
            wait_for_condition(page, '() => !!window.paintAgent')
            result = page.evaluate(EXPORT, job)
            browser_version = browser.version
        finally:
            browser.close()
    # Identifiers have already passed the application's strict allowlist.
    dest = output.resolve() / job['output']['assetId'] / job['output']['revisionId']
    if dest.exists():
        raise FileExistsError(f'Refusing to overwrite an existing revision: {dest}')
    image = base64.b64decode(result['image'], validate=True)
    if image[:8] != b'\x89PNG\r\n\x1a\n' or sha(image) != result['imageSHA256']:
        raise ValueError('PNG transfer/hash validation failed')
    if struct.unpack('>II', image[16:24]) != (result['checks']['width'], result['checks']['height']):
        raise ValueError('PNG dimension validation failed')
    content = {
        'image.png': image,
        'preview.png': base64.b64decode(result['preview'], validate=True),
        'project.paint.json': json.dumps(result['project'], ensure_ascii=False).encode(),
        'commands.json': json.dumps(job['batches'], ensure_ascii=False, indent=2).encode(),
    }
    for layer_id, data in result['layers'].items():
        content[f'layers/{layer_id}.png'] = base64.b64decode(data, validate=True)
    source = b''.join(str(path.relative_to(ROOT)).encode() + b'\0' + path.read_bytes() for path in
                      sorted([ROOT / 'index.html', ROOT / 'style.css', *(ROOT / 'src').glob('*.js')]))
    manifest = {
        'schemaVersion': 'paint-manifest/0.1', 'jobId': job['jobId'],
        'assetId': job['output']['assetId'], 'revisionId': job['output']['revisionId'],
        'status': 'rendered', 'reviewStatus': 'candidate', 'githubStored': False,
        'checks': result['checks'], 'renderer': result['capabilities'],
        'browserVersion': browser_version, 'applicationSHA256': sha(source),
        'jobSHA256': sha(job_path.read_bytes()), 'rgbaSHA256': result['rgbaSHA256'],
        'files': {path: {'sha256': sha(data), 'bytes': len(data)} for path, data in content.items()},
    }
    content['manifest.json'] = json.dumps(manifest, ensure_ascii=False, indent=2).encode()
    dest.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.aipaint-', dir=dest.parent))
    try:
        for relative, data in content.items():
            target = staging / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        # Reserving the destination with mkdir prevents concurrent overwrites.
        dest.mkdir(exist_ok=False)
        try:
            for child in staging.iterdir():
                shutil.move(str(child), dest / child.name)
        except Exception:
            shutil.rmtree(dest)
            raise
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    for relative, data in content.items():
        if sha((dest / relative).read_bytes()) != sha(data):
            raise ValueError('Read-back verification failed')
    return {'status': 'rendered', 'githubStored': False, 'directory': str(dest), 'files': sorted(content)}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('job', type=Path)
    parser.add_argument('--output', type=Path, default=Path('outputs'))
    args = parser.parse_args()
    try:
        print(json.dumps(render(args.job, args.output), ensure_ascii=False, indent=2))
    except Exception as error:
        parser.exit(1, f'{type(error).__name__}: {error}\n')
