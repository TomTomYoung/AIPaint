"""Browser integration checks. Requires Chromium and requirements-dev.txt."""
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from playwright.sync_api import sync_playwright
from browser_support import ROOT, serve, launch, restrict_network, wait_for_condition

class BrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = serve()
        cls.origin = cls.server.__enter__()
        cls.pw = sync_playwright().start()
        cls.browser = launch(cls.pw)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.__exit__(None, None, None)

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1440, 'height': 1000})
        restrict_network(self.context, self.origin)
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.on('dialog', lambda dialog: dialog.accept())
        self.page.goto(self.origin + '/AIPaint/')
        wait_for_condition(self.page, '() => !!window.paintAgent && window.paintAgent.getState().revision === 1')

    def tearDown(self):
        self.assertEqual(self.errors, [])
        self.context.close()

    def state(self):
        return self.page.evaluate('paintAgent.getState()')

    def test_01_pages_subpath_and_initial_state(self):
        self.assertEqual(self.page.title(), 'AIPaint — Pixel workspace')
        self.assertEqual(self.state()['width'], 128)
        self.assertFalse(self.state()['githubStored'])
        self.assertEqual(self.page.locator('#status').get_attribute('class'), 'status')

    def test_02_pointer_draw_undo_redo(self):
        box = self.page.locator('#canvas').bounding_box()
        self.page.mouse.move(box['x'] + 40, box['y'] + 40)
        self.page.mouse.down()
        self.page.mouse.move(box['x'] + 80, box['y'] + 80, steps=8)
        self.page.mouse.up()
        self.assertEqual(self.state()['revision'], 2)
        self.assertGreater(self.page.evaluate('paintAgent.composite().data.filter((x,i)=>i%4===3&&x>0).length'), 0)
        self.page.locator('#undo').click()
        self.assertEqual(self.state()['revision'], 3)
        self.assertEqual(self.page.evaluate('paintAgent.composite().data.some(x=>x>0)'), False)
        self.page.locator('#redo').click()
        self.assertEqual(self.state()['revision'], 4)

    def test_03_invalid_batch_is_atomic(self):
        self.page.locator('#commands').fill(json.dumps([{'type':'shape.rect','layerId':'ink','x':0,'y':0,'width':4,'height':4,'fill':'#FF0000FF'},{'type':'runScript'}]))
        self.page.locator('#apply-json').click()
        self.assertEqual(self.state()['revision'], 1)
        self.assertIn('UNKNOWN_COMMAND', self.page.locator('#status').inner_text())

    def test_04_project_roundtrip_preserves_layers(self):
        self.page.locator('#demo').click()
        wait_for_condition(self.page, '() => paintAgent.getState().layers.length === 2')
        before = self.page.evaluate('Array.from(paintAgent.composite().data)')
        project = self.page.evaluate('paintAgent.exportProject({documentId:paintAgent.getState().documentId, revision:paintAgent.getState().revision})')
        old_id = self.state()['documentId']
        self.page.locator('#open-project').set_input_files({'name':'project.paint.json','mimeType':'application/json','buffer':json.dumps(project).encode()})
        wait_for_condition(self.page, '() => paintAgent.getState().revision === 0')
        self.assertNotEqual(self.state()['documentId'], old_id)
        self.assertEqual(before, self.page.evaluate('Array.from(paintAgent.composite().data)'))

    def test_05_png_bytes_dimensions_and_transparency(self):
        self.page.locator('#demo').click()
        wait_for_condition(self.page, '() => paintAgent.getState().layers.length === 2')
        result = self.page.evaluate('''async () => {
          const a=paintAgent,s=a.getState(),im=await a.exportImage({documentId:s.documentId,revision:s.revision});
          const bmp=await createImageBitmap(im.blob),c=document.createElement('canvas'); c.width=bmp.width;c.height=bmp.height;
          const x=c.getContext('2d');x.drawImage(bmp,0,0);const data=x.getImageData(0,0,c.width,c.height).data,expected=a.composite().data;
          return {width:bmp.width,height:bmp.height,bytes:im.byteLength,hash:im.sha256,alpha:data[3],equal:data.every((v,i)=>v===expected[i])};
        }''')
        self.assertEqual((result['width'], result['height'], result['alpha']), (128,128,0))
        self.assertEqual(len(result['hash']),64)
        self.assertTrue(result['equal'])

    def test_06_stale_revision_and_publish_status(self):
        result = self.page.evaluate('''() => {
          const a=paintAgent,s=a.getState();a.applyBatch({documentId:s.documentId,expectedRevision:s.revision,batchId:'test-edit',commands:[{type:'pixel.set',layerId:'ink',x:1,y:1,color:'#FFFFFFFF'}]});
          let conflict,publish;try{a.undo({documentId:s.documentId,expectedRevision:s.revision})}catch(e){conflict=e.code}
          try{a.preparePublish()}catch(e){publish=e.code}return {conflict,publish};
        }''')
        self.assertEqual(result, {'conflict':'REVISION_CONFLICT','publish':'PUBLISH_UNAVAILABLE'})

    def test_07_json_tool_and_layer_controls(self):
        self.page.locator('#apply-json').click()
        self.assertEqual(self.state()['revision'],2)
        self.page.locator('#add-layer').click()
        self.assertEqual(len(self.state()['layers']),2)
        self.page.locator('#layers input[type=checkbox]').first.uncheck()
        self.assertEqual(self.state()['layers'][-1]['visible'],False)

    def test_08_old_autosave_not_overwritten_on_load(self):
        self.page.evaluate("localStorage.setItem('aipaint-project-v0.1', 'sentinel')")
        self.page.reload()
        self.page.wait_for_timeout(650)
        self.assertEqual(self.page.evaluate("localStorage.getItem('aipaint-project-v0.1')"),'sentinel')

    def test_09_job_failure_does_not_replace_active_document(self):
        job = json.loads((ROOT/'examples/slime.json').read_text())
        job['checks']['maxOpaqueColors']=1
        result = self.page.evaluate('''job => {
          const a=paintAgent,s=a.getState(); let code;
          try{a.runJob({job,replace:true,expectedDocumentId:s.documentId,expectedRevision:s.revision})}catch(e){code=e.code}
          return {code,unchanged:a.getState().documentId===s.documentId&&a.getState().revision===s.revision};
        }''', job)
        self.assertEqual(result,{'code':'CHECK_FAILED','unchanged':True})

    def test_10_mobile_and_screenshot(self):
        self.page.locator('#demo').click()
        wait_for_condition(self.page, '() => paintAgent.getState().layers.length === 2')
        folder = ROOT/'outputs'/'test';folder.mkdir(parents=True,exist_ok=True)
        self.page.screenshot(path=str(folder/'desktop.png'),full_page=True)
        self.page.set_viewport_size({'width':390,'height':844})
        self.assertTrue(self.page.locator('#canvas').is_visible())
        self.page.screenshot(path=str(folder/'mobile.png'),full_page=True)

if __name__ == '__main__':
    unittest.main(verbosity=2)
