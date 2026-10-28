export const THEME_KEY = 'cutroom.theme';

/** Runs before first paint (inlined in <head>) so the page never flashes the wrong theme. */
export const THEME_BOOT = `(function(){var t;try{t=localStorage.getItem('${THEME_KEY}')}catch(e){}if(t!=='light'&&t!=='dark'){t='dark'}document.documentElement.dataset.theme=t})()`;
