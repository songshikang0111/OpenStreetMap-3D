// Static export's public bridge. It bundles the existing SDK and its actual
// style registry once; project modules share its engine imports through chunks.
export {createCityViewer} from '../sdk/index.js';
export {getStyle,registerStyle,loadProjectStyle,resolveStyleSelection} from './index.js';
