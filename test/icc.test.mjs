import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { embedICC, extractICC } from '../build/preview/icc.js';

function profile(size=560) {
  const b=Buffer.alloc(size);b.writeUInt32BE(size);b.write('RGB ',16);b.write('acsp',36);return b;
}
function chunk(type,data) {
  const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);
  b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;
}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,0,4,10,20,0xff,0xda,0,2,11,22,33,0xff,0xd9]);

test('PNG ICC round trip replaces conflicting color chunks without changing compressed pixels',()=>{
  const tagged=embedICC(Buffer.concat([png.subarray(0,33),chunk('sRGB',Buffer.from([0])),png.subarray(33)]),profile(),'png');
  assert.deepEqual(extractICC(tagged,'png'),profile());
  assert.equal(tagged.includes(Buffer.from('PixInsight display\0', 'ascii')),true);
  // Strip just iCCP from output; the original PNG including its IDAT is unchanged.
  const iccpLength=tagged.readUInt32BE(33)+12;
  assert.deepEqual(Buffer.concat([tagged.subarray(0,33),tagged.subarray(33+iccpLength)]),png);
  assert.deepEqual(extractICC(embedICC(tagged,profile(600),'png'),'png'),profile(600));
});
test('JPEG ICC spans ordered APP2 chunks and preserves entropy-coded pixels',()=>{
  const p=profile(140000), tagged=embedICC(jpeg,p,'jpeg');
  assert.deepEqual(extractICC(tagged,'jpeg'),p);
  assert.deepEqual(tagged.subarray(0,8),jpeg.subarray(0,8));
  assert.ok(tagged.subarray(-jpeg.length+8).equals(jpeg.subarray(8)));
  const replaced=embedICC(tagged,profile(),'jpeg');
  assert.deepEqual(extractICC(replaced,'jpeg'),profile());
  assert.ok(replaced.length<tagged.length);
});
test('corrupt/truncated image containers and invalid profiles are rejected',()=>{
  const bad=Buffer.from(png);bad[45]^=1;
  assert.throws(()=>embedICC(bad,profile(),'png'),/CRC/);
  assert.throws(()=>embedICC(png.subarray(0,-2),profile(),'png'),/Incomplete|Truncated/);
  assert.throws(()=>embedICC(png,Buffer.alloc(128),'png'),/Invalid/);
  assert.throws(()=>extractICC(jpeg,'jpeg'),/Incomplete/);
  const tagged=embedICC(jpeg,profile(),'jpeg');tagged[24]=2;
  assert.throws(()=>extractICC(tagged,'jpeg'),/Incomplete/);
});
