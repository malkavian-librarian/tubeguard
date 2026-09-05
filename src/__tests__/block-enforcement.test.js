import {expect,test,vi} from 'vitest';
import {init,scanDocument} from '../content/blocker.js';
test('blocks direct playback silently and supports handle aliases',async()=>{
  document.body.innerHTML='<div id="owner"><div id="channel-name"><a href="/@owner">Owner</a></div></div><div id="movie_player"><video></video></div>';
  const video=document.querySelector('video');video.pause=vi.fn();
  init({channels:['@owner']});scanDocument();
  expect(video.pause).toHaveBeenCalled();
  expect(document.querySelector('#movie_player').style.display).toBe('none');
  await Promise.resolve();expect(document.querySelector('#movie_player')).toBeNull();
});
