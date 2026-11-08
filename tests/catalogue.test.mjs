import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogue, catalogueMetadataSource, composers, featuredSongs } from '../src/catalogue.ts';
import { top100SongIds } from '../src/top100-data.ts';

test('Tamil catalogue has hundreds of distinct factual references with preserved featured entries',()=>{
  assert.ok(catalogue.length>=400);
  assert.equal(new Set(catalogue.map(song=>song.id)).size,catalogue.length);
  assert.ok(featuredSongs.every(Boolean));
  assert.equal(new Set(catalogue.map(song=>song.composer)).size,composers.length);
  for(const song of catalogue){
    assert.ok(song.title&&song.film&&song.id);
    assert.ok(composers.includes(song.composer));
    assert.ok(Number.isInteger(song.year)&&song.year>=1970&&song.year<=2020);
    assert.equal(song.notationStatus,'reference');
    assert.ok(song.sourceUrl?.startsWith('https://'));
    assert.equal('notes' in song,false,'Reference metadata must not masquerade as licensed film notation');
    assert.equal('audio' in song,false);
    assert.equal('lyrics' in song,false);
  }
});

test('researched metadata carries CC0 provenance without granting music rights',()=>{
  assert.equal(catalogue.filter(song=>song.metadataLicense==='CC0-1.0').length,300);
  assert.match(JSON.stringify(catalogueMetadataSource),/52a6b87ab5d2f2beafd04f97dda65ac2583d5663/);
  assert.match(JSON.stringify(catalogueMetadataSource),/CC0/);
});


test('Top100 is a balanced editorial selection with every reference present exactly once',()=>{
  assert.equal(top100SongIds.length,100);
  assert.equal(new Set(top100SongIds).size,100);
  const selected=top100SongIds.map(id=>catalogue.find(song=>song.id===id));
  assert.ok(selected.every(Boolean));
  for(const composer of ['Ilaiyaraaja','A. R. Rahman','Yuvan Shankar Raja','Vidyasagar'])assert.equal(selected.filter(song=>song.composer===composer).length,25);
  assert.ok(selected.every(song=>song.notationStatus==='reference'));
});
