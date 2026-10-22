import {searchSurfaces} from './document-find';
self.onmessage=event=>{self.postMessage(searchSurfaces(event.data.surfaces,event.data.options));};
