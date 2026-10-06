import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DEFAULT_NEEDS } from '../scripts/constants.js';
import { needIcon, needIconPath } from '../scripts/ui/need-icons.js';
import { CONTROL_ART, controlIcon, controlIconClass } from '../scripts/ui/control-icons.js';

test('default needs use their own artwork, while saved custom fonts and images remain intact', () => {
  for (const need of DEFAULT_NEEDS) {
    assert.ok(needIcon(need).includes(`src="${needIconPath(need.id)}"`), need.id);
  }
  const hunger = DEFAULT_NEEDS.find(n => n.id === 'hunger');
  assert.match(needIcon({ ...hunger, icon: 'fa-dragon' }), /<i .*fas fa-dragon/);
  assert.match(needIcon({ ...hunger, custom: true }), /src="modules\/mortal-needs\/assets\/icons\/hunger.svg"/);
  assert.match(needIcon({ ...hunger, custom: true, icon: 'fa-dragon' }), /<i .*fas fa-dragon/);
  assert.match(needIcon({ id: 'custom-hunger', custom: true, icon: 'fa-utensils' }), /<i .*fas fa-utensils/);
  for (const iconType of ['image', 'img']) {
    assert.match(needIcon({ ...hunger, iconType, icon: 'worlds/example/custom.svg' }), /src="worlds\/example\/custom.svg"/);
  }
  assert.match(needIcon({ id: 'unknown', icon: 'javascript:alert(1)', iconType: 'img' }), /icons\/seal.svg/);
  assert.match(needIcon({ ...hunger, icon: 'fa-times" onclick="alert(1)' }), /icons\/hunger.svg/);
});

test('saved built-in needs marked custom still use the approved default illustrations', () => {
  // A saved built-in need can have custom rules while retaining its default icon.
  const saved = { id: 'hunger', icon: 'fa-utensils', iconType: 'fa', custom: true };
  assert.ok(needIcon(saved).includes(`src="${needIconPath('hunger')}"`));
  for (const config of DEFAULT_NEEDS) {
    assert.ok(needIcon({ ...config, custom: true }).includes(`src="${needIconPath(config.id)}"`));
  }
});

test('every approved SVG is byte-identical and included in the runtime release', () => {
  const art = JSON.parse(readFileSync(new URL('../tools/icon-artwork.json', import.meta.url)));
  const shipped = JSON.parse(readFileSync(new URL('../tools/release-files.json', import.meta.url)));
  assert.equal(art.assets.length, 88);
  for (const asset of art.assets) {
    const bytes = readFileSync(new URL(`../${asset.path}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, asset.id);
    assert.ok(shipped.includes(asset.path), asset.path);
    assert.doesNotMatch(bytes.toString(), /<script\b|<image\b|<foreignObject\b|\son\w+=/i);
  }
  assert.ok(shipped.every(file => !file.startsWith('design/')));
});

test('controls opt into module art without replacing arbitrary font icons', () => {
  const css = readFileSync(new URL('../styles/icons.css', import.meta.url), 'utf8');
  assert.equal(Object.keys(CONTROL_ART).length, 87);
  for (const [fa, asset] of Object.entries(CONTROL_ART)) {
    assert.equal(controlIconClass(`fas ${fa}`), `mn-icon ${fa}`);
    assert.ok(css.includes(`.mn-icon.${fa} { --mn-icon-art: url("../assets/icons/${asset}.svg"); }`), fa);
    assert.match(controlIcon(fa), /aria-hidden="true"/);
  }
  assert.equal(controlIconClass('fa-dragon'), 'fas fa-dragon');
  assert.equal(controlIconClass('<script>'), 'mn-icon fa-question');
  assert.ok(!controlIcon('fa-save', '" onclick="alert(1)').includes(' onclick="'));
});
